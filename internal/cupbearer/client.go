package cupbearer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"HA-Services-MaintenanceView/internal/models"
)

// RequestRecorder 记录每一次对 Cupbearer 的代理调用（元数据级，
// 绝不记录请求头/凭据/请求体）。形态对齐 MatchCoreArena-MaintenanceView
// knowledge 0008 的请求日志环形缓冲。
type RequestRecorder interface {
	Record(method, path string, status int, code string, ok bool)
}

// UpstreamError 是一次失败的 Cupbearer 调用：
// Transport=true 表示根本没拿到 HTTP 响应（网络/解析失败），
// 否则 Status/Code/Message 来自上游响应；Data 保留上游错误信封里的
// data 段（如校验分项错误），供代理层原样透传。
type UpstreamError struct {
	Transport bool
	Status    int
	Code      string
	Message   string
	Data      json.RawMessage
}

func (e *UpstreamError) Error() string {
	if e.Transport {
		return fmt.Sprintf("cupbearer unreachable: %s", e.Message)
	}
	return fmt.Sprintf("cupbearer returned HTTP %d (code %s): %s", e.Status, e.Code, e.Message)
}

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	recorder   RequestRecorder
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SetToken 配置 Cupbearer 变更端点的部署凭据。凭据只存在于服务端，
// 仅用于出站请求头，绝不出现在任何日志或响应中。
func (c *Client) SetToken(token string) {
	c.token = token
}

// TokenConfigured 报告是否已配置部署凭据（只暴露布尔状态）。
func (c *Client) TokenConfigured() bool {
	return strings.TrimSpace(c.token) != ""
}

// SetRecorder 挂接请求日志记录器。
func (c *Client) SetRecorder(recorder RequestRecorder) {
	c.recorder = recorder
}

func (c *Client) Healthz(ctx context.Context) (map[string]any, error) {
	return c.getEnvelope(ctx, "/api/v1/healthz")
}

func (c *Client) Manifest(ctx context.Context) (map[string]any, error) {
	return c.getEnvelope(ctx, "/api/v1/manifest")
}

func (c *Client) Projects(ctx context.Context) (*models.RemoteProjectsEnvelope, error) {
	var payload models.RemoteProjectsEnvelope
	if err := c.getData(ctx, "/api/v1/projects", &payload); err != nil {
		return nil, err
	}
	if payload.Projects == nil {
		payload.Projects = []models.RemoteProject{}
	}
	return &payload, nil
}

// --- 编排端点（与 Cupbearer 实际实现对齐：/api/v1/deploy/*，
// 变更端点认 X-Deploy-Token 请求头） ---

// DeployManifestsRaw 透传聚合 Manifest 视图的 data 段原始 JSON。
func (c *Client) DeployManifestsRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/manifests", nil, false)
}

// DeployManifests 解析聚合 Manifest 视图（供 manager 闸门等内部判断）。
func (c *Client) DeployManifests(ctx context.Context) (*models.DeployManifests, *UpstreamError) {
	raw, uerr := c.DeployManifestsRaw(ctx)
	if uerr != nil {
		return nil, uerr
	}
	var manifests models.DeployManifests
	if err := json.Unmarshal(raw, &manifests); err != nil {
		return nil, &UpstreamError{Transport: true, Message: "invalid manifests payload from cupbearer: " + err.Error()}
	}
	return &manifests, nil
}

func (c *Client) DeployValidateRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/validate", nil, false)
}

// DeployPreflightRaw 透传只读前置检查报告；scope 为可选的
// "?projects=...&group=..." 查询串（已编码，空串 = 全量）。
func (c *Client) DeployPreflightRaw(ctx context.Context, scope string) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/preflight"+scope, nil, false)
}

func (c *Client) DeployStatusRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/status", nil, false)
}

func (c *Client) DeployRunsRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/runs", nil, false)
}

func (c *Client) DeployRunRaw(ctx context.Context, id string) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/runs/"+id, nil, false)
}

// TriggerDeploy 触发部署运行，返回运行快照原始 JSON（上游直接回 Run 对象）。
func (c *Client) TriggerDeploy(ctx context.Context, opts models.RunOptions) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/run", opts, true)
}

// TriggerRollback 触发回滚运行（单项目 + 可选级联），返回运行快照原始 JSON。
func (c *Client) TriggerRollback(ctx context.Context, req models.RollbackRequest) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/rollback", req, true)
}

// TriggerContainerDeploy 触发容器路径一键触发（compose override + up -d），
// 返回运行快照原始 JSON（运行类型 container-trigger）。
func (c *Client) TriggerContainerDeploy(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/container/trigger", struct{}{}, true)
}

// --- 首次运行初始化（向导）端点：/api/v1/deploy/bootstrap/* ---

// BootstrapStatusRaw 透传初始化层现状与向导元数据（只读）。
func (c *Client) BootstrapStatusRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/bootstrap/status", nil, false)
}

// BootstrapInfraRaw 透传共享 MySQL/Redis 基础设施现状（只读探测）。
func (c *Client) BootstrapInfraRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/bootstrap/infra", nil, false)
}

// BootstrapInfraMySQL 一键确保 MySQL 可用（等真能查询才返回，长耗时）。
func (c *Client) BootstrapInfraMySQL(ctx context.Context, body any) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/bootstrap/infra/mysql", body, true)
}

// BootstrapInfraRedis 一键确保 Redis 可用（等真能 PING 才返回，长耗时）。
func (c *Client) BootstrapInfraRedis(ctx context.Context, body any) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/bootstrap/infra/redis", body, true)
}

// BootstrapCredentialHints 计算凭据预填提示（契约 1.7.0；只读，仅可追溯
// 且验证通过的凭据回显明文，回显在上游记审计）。
func (c *Client) BootstrapCredentialHints(ctx context.Context, body any) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/bootstrap/credential-hints", body, true)
}

// BootstrapPlan 透传 dry-run 计划（校验缺值，上游 400 携带分项人话错误）。
func (c *Client) BootstrapPlan(ctx context.Context, inputs any) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/bootstrap/plan", inputs, true)
}

// BootstrapRun 触发一键初始化运行（异步），返回运行快照原始 JSON。
func (c *Client) BootstrapRun(ctx context.Context, inputs any) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodPost, "/api/v1/deploy/bootstrap/run", inputs, true)
}

// BootstrapRunsRaw 透传初始化运行历史。
func (c *Client) BootstrapRunsRaw(ctx context.Context) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/bootstrap/runs", nil, false)
}

// BootstrapRunRaw 透传单条初始化运行记录（断点续跑的可见面）。
func (c *Client) BootstrapRunRaw(ctx context.Context, id string) (json.RawMessage, *UpstreamError) {
	return c.doRaw(ctx, http.MethodGet, "/api/v1/deploy/bootstrap/runs/"+id, nil, false)
}

// doRaw 发送请求并返回标准信封中的 data 段原始 JSON。
// withAuth 为 true 时注入部署凭据（X-Deploy-Token）；未配置则 fail-closed。
func (c *Client) doRaw(ctx context.Context, method, path string, body any, withAuth bool) (json.RawMessage, *UpstreamError) {
	if withAuth && !c.TokenConfigured() {
		return nil, &UpstreamError{Transport: true, Message: "deploy token is not configured on this maintenance view"}
	}

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, &UpstreamError{Transport: true, Message: err.Error()}
		}
		reader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, &UpstreamError{Transport: true, Message: err.Error()}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if withAuth {
		req.Header.Set("X-Deploy-Token", c.token)
	}

	// 触发类调用允许上游做更久的计划/预检。基础设施一键端点要等
	// MySQL/Redis 真正就绪（拉镜像+首次初始化），给足 5 分钟。
	httpClient := c.httpClient
	if method == http.MethodPost {
		timeout := 30 * time.Second
		if strings.HasPrefix(path, "/api/v1/deploy/bootstrap/infra/") {
			timeout = 5 * time.Minute
		}
		httpClient = &http.Client{Timeout: timeout}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		c.record(method, path, 0, "", false)
		return nil, &UpstreamError{Transport: true, Message: err.Error()}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		c.record(method, path, resp.StatusCode, "", false)
		return nil, &UpstreamError{Transport: true, Message: err.Error()}
	}

	code, message, ok := parseEnvelope(raw)
	c.record(method, path, resp.StatusCode, code, ok && resp.StatusCode < http.StatusBadRequest)

	if resp.StatusCode >= http.StatusBadRequest {
		if message == "" {
			message = strings.TrimSpace(string(raw))
		}
		uerr := &UpstreamError{Status: resp.StatusCode, Code: code, Message: message}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(raw, &envelope); err == nil && len(envelope.Data) > 0 {
			uerr.Data = envelope.Data
		}
		return nil, uerr
	}
	if !ok {
		return nil, &UpstreamError{Status: resp.StatusCode, Code: code, Message: message}
	}

	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Data == nil {
		return nil, &UpstreamError{Transport: true, Message: "cupbearer response missing data field"}
	}
	return envelope.Data, nil
}

// parseEnvelope 尽力解析 {success, message, code} 信封；解析失败返回零值。
func parseEnvelope(raw []byte) (code, message string, ok bool) {
	var envelope struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Code    string `json:"code"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", "", true
	}
	msg := envelope.Message
	if msg == "" {
		msg = envelope.Error
	}
	return envelope.Code, msg, envelope.Success
}

func (c *Client) record(method, path string, status int, code string, ok bool) {
	if c.recorder != nil {
		c.recorder.Record(method, path, status, code, ok)
	}
}

// getEnvelope 保留历史行为：返回完整信封（含 success/message/data），
// 供 /api/cupbearer/* 透传端点原样使用。
func (c *Client) getEnvelope(ctx context.Context, path string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.record(http.MethodGet, path, 0, "", false)
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.record(http.MethodGet, path, resp.StatusCode, "", false)
		return nil, err
	}

	code, _, ok := parseEnvelope(body)
	c.record(http.MethodGet, path, resp.StatusCode, code, ok && resp.StatusCode < http.StatusBadRequest)

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("cupbearer request failed: %s", strings.TrimSpace(string(body)))
	}

	var envelope map[string]any
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, err
	}

	return envelope, nil
}

func (c *Client) getData(ctx context.Context, path string, target any) error {
	envelope, err := c.getEnvelope(ctx, path)
	if err != nil {
		return err
	}

	data, ok := envelope["data"]
	if !ok {
		return fmt.Errorf("cupbearer response missing data field")
	}

	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}

	return json.Unmarshal(raw, target)
}
