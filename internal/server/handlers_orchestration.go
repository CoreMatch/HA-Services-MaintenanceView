package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"

	"HA-Services-MaintenanceView/internal/cupbearer"
	"HA-Services-MaintenanceView/internal/models"
	"github.com/gin-gonic/gin"
)

// 本文件实现编排操作面的代理层：浏览器只调用本进程，部署凭据由本进程
// 注入出站请求（X-Deploy-Token），绝不下发到前端。风格对齐
// MatchCoreArena-MaintenanceView knowledge 0008（后端持令牌 + 请求日志 +
// 类型化错误翻译）。
//
// 上游端点与 HA-Cupbearer 实际实现对齐（/api/v1/deploy/*，
// 2026-11-08 对账）；形状见 internal/models/orchestration.go。

var runIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// writeRawPassthrough 把上游 data 段原样放进本服务信封透传。
func writeRawPassthrough(c *gin.Context, message string, raw json.RawMessage, uerr *cupbearer.UpstreamError) {
	if uerr != nil {
		writeUpstreamError(c, uerr)
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", mustEnvelope(message, raw))
}

// mustEnvelope 组装 {success, message, data} 信封；raw 已是 JSON 值。
func mustEnvelope(message string, raw json.RawMessage) []byte {
	out, err := json.Marshal(gin.H{
		"success": true,
		"message": message,
		"data":    json.RawMessage(raw),
	})
	if err != nil {
		return []byte(`{"success":false,"message":"internal envelope error"}`)
	}
	return out
}

// writeUpstreamError 把上游失败翻译成可读响应：
// 传输失败 → 502；其余按上游状态码透传，保留错误码与上游 data 段
//（如"校验失败拒绝运行"时的分项错误）。
func writeUpstreamError(c *gin.Context, uerr *cupbearer.UpstreamError) {
	if uerr == nil {
		return
	}

	if uerr.Transport {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "无法连接 Cupbearer：" + uerr.Message,
		})
		return
	}

	payload := gin.H{
		"success":         false,
		"message":         translateCupbearerError(uerr),
		"code":            uerr.Code,
		"upstream_status": uerr.Status,
	}
	if len(uerr.Data) > 0 {
		payload["data"] = json.RawMessage(uerr.Data)
	}
	c.JSON(uerr.Status, payload)
}

// translateCupbearerError 把上游类型化错误翻译成可读消息，保留原码。
// 未列出的回落到信封原文（不吞细节）。
func translateCupbearerError(uerr *cupbearer.UpstreamError) string {
	switch uerr.Status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Sprintf("Cupbearer 拒绝了请求：部署凭据缺失或无效（检查 MaintenanceView 配置 cupbearer.token）(HTTP %d)", uerr.Status)
	case http.StatusNotFound:
		return fmt.Sprintf("Cupbearer 上没有该资源：运行记录不存在，或该 Cupbearer 版本尚未启用编排端点 (HTTP %d)", uerr.Status)
	case http.StatusServiceUnavailable:
		return fmt.Sprintf("Cupbearer 编排不可用：%s (HTTP %d)", uerr.Message, uerr.Status)
	case http.StatusConflict:
		return fmt.Sprintf("Cupbearer 拒绝了本次触发：%s (HTTP %d)", uerr.Message, uerr.Status)
	}
	if uerr.Message == "" {
		return fmt.Sprintf("Cupbearer 请求失败 (HTTP %d)", uerr.Status)
	}
	return fmt.Sprintf("%s (HTTP %d)", uerr.Message, uerr.Status)
}

// GetOrchestrationManifest 透传 Cupbearer 聚合 Manifest 视图。
func (h *Handler) GetOrchestrationManifest(c *gin.Context) {
	raw, uerr := h.client.DeployManifestsRaw(c.Request.Context())
	writeRawPassthrough(c, "deploy manifests fetched", raw, uerr)
}

// GetOrchestrationValidation 透传聚合校验结论（分项错误为字符串列表）。
func (h *Handler) GetOrchestrationValidation(c *gin.Context) {
	raw, uerr := h.client.DeployValidateRaw(c.Request.Context())
	writeRawPassthrough(c, "deploy validation fetched", raw, uerr)
}

// GetOrchestrationStatus 透传项目状态总览。
func (h *Handler) GetOrchestrationStatus(c *gin.Context) {
	raw, uerr := h.client.DeployStatusRaw(c.Request.Context())
	writeRawPassthrough(c, "deploy status fetched", raw, uerr)
}

// GetOrchestrationRuns 透传运行历史。
func (h *Handler) GetOrchestrationRuns(c *gin.Context) {
	raw, uerr := h.client.DeployRunsRaw(c.Request.Context())
	writeRawPassthrough(c, "deploy runs fetched", raw, uerr)
}

// GetOrchestrationRun 透传单次运行的逐项进度。
func (h *Handler) GetOrchestrationRun(c *gin.Context) {
	id := c.Param("id")
	if !runIDPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid run id",
		})
		return
	}
	raw, uerr := h.client.DeployRunRaw(c.Request.Context(), id)
	writeRawPassthrough(c, "deploy run fetched", raw, uerr)
}

// TriggerDeploy 触发部署：先过 manager 闸门，再由服务端注入凭据转发。
// 上游直接返回运行快照（202）。
func (h *Handler) TriggerDeploy(c *gin.Context) {
	var input models.RunOptions
	if err := c.ShouldBindJSON(&input); err != nil {
		// 与上游一致：空体 = 全量部署。
		input = models.RunOptions{}
	}

	if rejected := h.gateManagedProjects(c, input.Projects); rejected {
		return
	}

	if !h.client.TokenConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "本实例未配置部署凭据（cupbearer.token），无法触发部署",
		})
		return
	}

	raw, uerr := h.client.TriggerDeploy(c.Request.Context(), input)
	if uerr != nil {
		writeUpstreamError(c, uerr)
		return
	}

	c.Data(http.StatusAccepted, "application/json; charset=utf-8", mustEnvelope("deploy run started", raw))
}

// TriggerRollback 触发回滚（单项目 + 可选级联）：同样先过 manager 闸门。
func (h *Handler) TriggerRollback(c *gin.Context) {
	var input models.RollbackRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid rollback payload",
		})
		return
	}
	if input.Project == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "project is required",
		})
		return
	}

	if rejected := h.gateManagedProjects(c, []string{input.Project}); rejected {
		return
	}

	if !h.client.TokenConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "本实例未配置部署凭据（cupbearer.token），无法触发回滚",
		})
		return
	}

	raw, uerr := h.client.TriggerRollback(c.Request.Context(), input)
	if uerr != nil {
		writeUpstreamError(c, uerr)
		return
	}

	c.Data(http.StatusAccepted, "application/json; charset=utf-8", mustEnvelope("rollback run started", raw))
}

// gateManagedProjects 对显式列出的项目做 manager 闸门：
// 只有 manager == tinyvisor 的项目允许部署/回滚；aapanel/manual（面板或
// 人工管理）与 external（外部依赖）一律拒绝——状态必须说实话，不能给
// 操作员看似可用的入口。Projects 为空（= 全量）时由 Cupbearer 侧的
// foreign 只读语义兜底。已拒绝时写入 409 响应并返回 true。
func (h *Handler) gateManagedProjects(c *gin.Context, projects []string) bool {
	if len(projects) == 0 {
		return false
	}

	manifests, uerr := h.client.DeployManifests(c.Request.Context())
	if uerr != nil {
		writeUpstreamError(c, uerr)
		return true
	}

	type entry struct {
		manager string
		kind    string
	}
	known := make(map[string]entry, len(manifests.Projects))
	for _, project := range manifests.Projects {
		known[project.Project] = entry{manager: project.Manager, kind: project.Kind}
	}

	type rejection struct {
		Project string `json:"project"`
		Reason  string `json:"reason"`
	}
	rejections := make([]rejection, 0)
	for _, name := range projects {
		info, exists := known[name]
		if !exists {
			rejections = append(rejections, rejection{
				Project: name,
				Reason:  "项目未在编排 Manifest 中声明",
			})
			continue
		}
		if info.manager == models.ManagerTinyvisor {
			continue
		}
		reason := fmt.Sprintf("该项目进程由 %s 管理（非本系统管辖），不可在此部署或回滚", info.manager)
		if info.kind == "external" || info.manager == "" {
			reason = "该项目为外部依赖（无进程生命周期），不存在部署或回滚动作"
		}
		rejections = append(rejections, rejection{Project: name, Reason: reason})
	}

	if len(rejections) > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "部分项目不属于本系统管辖，操作被拒绝",
			"data":    gin.H{"rejections": rejections},
		})
		return true
	}
	return false
}

// GetRequestLog 返回代理请求日志（最新在前）。
func (h *Handler) GetRequestLog(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "request log fetched",
		"data": gin.H{
			"entries": h.requestLog.Entries(),
		},
	})
}
