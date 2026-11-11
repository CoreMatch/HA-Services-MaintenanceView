package server

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
)

// 首次运行初始化向导的代理层：浏览器只调用本进程，部署凭据由本进程注入
// 出站请求（X-Deploy-Token），绝不下发到前端。上游为 HA-Services-Deployer
// 的 /api/v1/deploy/bootstrap/*（契约 ha-services-deployer.yaml v1.3.0）。
// 风格与编排代理（handlers_orchestration.go）一致：原样透传 data 段 +
// 类型化错误翻译。

var bootstrapRunIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// readBootstrapInputs 原样读取向导提交的统一输入 JSON（不在本层解析字段：
// 字段校验是 Deployer 的职责，分项人话错误经 400 的 data 段透传回界面）。
func readBootstrapInputs(c *gin.Context) (json.RawMessage, bool) {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取输入失败：" + err.Error()})
		return nil, false
	}
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	if !json.Valid(raw) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "输入不是合法 JSON"})
		return nil, false
	}
	return raw, true
}

// GetBootstrapStatus 透传初始化层现状与向导元数据。
func (h *Handler) GetBootstrapStatus(c *gin.Context) {
	raw, uerr := h.client.BootstrapStatusRaw(c.Request.Context())
	writeRawPassthrough(c, "bootstrap status fetched", raw, uerr)
}

// GetBootstrapInfra 透传共享 MySQL/Redis 现状（两种链路地址形态可见）。
func (h *Handler) GetBootstrapInfra(c *gin.Context) {
	raw, uerr := h.client.BootstrapInfraRaw(c.Request.Context())
	writeRawPassthrough(c, "infra status fetched", raw, uerr)
}

// PostBootstrapInfraMySQL 一键拉起/接管 MySQL（等真能用才返回）。
func (h *Handler) PostBootstrapInfraMySQL(c *gin.Context) {
	body, ok := readBootstrapInputs(c)
	if !ok {
		return
	}
	raw, uerr := h.client.BootstrapInfraMySQL(c.Request.Context(), json.RawMessage(body))
	writeRawPassthrough(c, "mysql ensured", raw, uerr)
}

// PostBootstrapInfraRedis 一键拉起/接管 Redis（等真能用才返回）。
func (h *Handler) PostBootstrapInfraRedis(c *gin.Context) {
	body, ok := readBootstrapInputs(c)
	if !ok {
		return
	}
	raw, uerr := h.client.BootstrapInfraRedis(c.Request.Context(), json.RawMessage(body))
	writeRawPassthrough(c, "redis ensured", raw, uerr)
}

// PostBootstrapPlan 透传 dry-run 计划（缺值时上游 400 携带分项人话错误）。
func (h *Handler) PostBootstrapPlan(c *gin.Context) {
	body, ok := readBootstrapInputs(c)
	if !ok {
		return
	}
	raw, uerr := h.client.BootstrapPlan(c.Request.Context(), json.RawMessage(body))
	writeRawPassthrough(c, "bootstrap plan computed", raw, uerr)
}

// PostBootstrapRun 触发一键初始化运行（异步；重跑即续跑）。
func (h *Handler) PostBootstrapRun(c *gin.Context) {
	body, ok := readBootstrapInputs(c)
	if !ok {
		return
	}
	raw, uerr := h.client.BootstrapRun(c.Request.Context(), json.RawMessage(body))
	writeRawPassthrough(c, "bootstrap run started", raw, uerr)
}

// GetBootstrapRuns 透传初始化运行历史。
func (h *Handler) GetBootstrapRuns(c *gin.Context) {
	raw, uerr := h.client.BootstrapRunsRaw(c.Request.Context())
	writeRawPassthrough(c, "bootstrap runs fetched", raw, uerr)
}

// GetBootstrapRun 透传单条初始化运行记录（逐步进度，值均掩码）。
func (h *Handler) GetBootstrapRun(c *gin.Context) {
	id := c.Param("id")
	if !bootstrapRunIDPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid run id"})
		return
	}
	raw, uerr := h.client.BootstrapRunRaw(c.Request.Context(), id)
	writeRawPassthrough(c, "bootstrap run fetched", raw, uerr)
}
