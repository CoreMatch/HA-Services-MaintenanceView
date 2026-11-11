package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"HA-Services-MaintenanceView/internal/cupbearer"
	"HA-Services-MaintenanceView/internal/models"
	"HA-Services-MaintenanceView/internal/state"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg *models.Config, client *cupbearer.Client, store *state.Store, sessions *SessionStore, requestLog *RequestLog) *gin.Engine {
	router := gin.Default()
	handler := NewHandler(cfg, client, store, sessions, requestLog)

	router.GET("/healthz", handler.Healthz)

	api := router.Group("/api")
	{
		// 会话端点必须在鉴权中间件之前注册：
		// 登录本身不能要求已有会话，/api/session 供前端判断是否需要登录。
		api.GET("/healthz", handler.Healthz)
		api.GET("/session", handler.SessionStatus)
		api.POST("/session/login", handler.SessionLogin)
		api.POST("/session/logout", handler.SessionLogout)

		// 其后注册的路由全部受会话门保护（auth.operator_token 为空时放行，
		// 保持历史行为）。
		api.Use(handler.authMiddleware())

		api.GET("/config", handler.GetConfig)
		api.GET("/projects", handler.GetProjects)
		api.PUT("/projects/:name/deployment", handler.SaveProjectDeployment)
		api.POST("/projects/:name/precheck", handler.RunProjectPrecheck)
		api.POST("/projects/:name/initialize", handler.InitializeProject)
		api.GET("/cupbearer/healthz", handler.GetCupbearerHealthz)
		api.GET("/cupbearer/manifest", handler.GetCupbearerManifest)
		api.GET("/request-log", handler.GetRequestLog)

		orchestration := api.Group("/orchestration")
		{
			orchestration.GET("/manifest", handler.GetOrchestrationManifest)
			orchestration.GET("/validation", handler.GetOrchestrationValidation)
			orchestration.GET("/status", handler.GetOrchestrationStatus)
			orchestration.GET("/runs", handler.GetOrchestrationRuns)
			orchestration.GET("/runs/:id", handler.GetOrchestrationRun)
			orchestration.POST("/deploy", handler.TriggerDeploy)
			orchestration.POST("/rollback", handler.TriggerRollback)
		}

		// 首次运行初始化向导（一键开荒）：透传 Cupbearer bootstrap 层。
		bootstrap := api.Group("/bootstrap")
		{
			bootstrap.GET("/status", handler.GetBootstrapStatus)
			bootstrap.GET("/infra", handler.GetBootstrapInfra)
			bootstrap.POST("/infra/mysql", handler.PostBootstrapInfraMySQL)
			bootstrap.POST("/infra/redis", handler.PostBootstrapInfraRedis)
			bootstrap.POST("/plan", handler.PostBootstrapPlan)
			bootstrap.POST("/run", handler.PostBootstrapRun)
			bootstrap.GET("/runs", handler.GetBootstrapRuns)
			bootstrap.GET("/runs/:id", handler.GetBootstrapRun)
		}
	}

	router.NoRoute(func(c *gin.Context) {
		requestedPath := strings.TrimPrefix(filepath.Clean(c.Request.URL.Path), "/")
		candidatePath := filepath.Join(cfg.Server.FrontendDist, requestedPath)
		if requestedPath != "" {
			if info, err := os.Stat(candidatePath); err == nil && !info.IsDir() {
				c.File(candidatePath)
				return
			}
		}

		indexPath := filepath.Join(cfg.Server.FrontendDist, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			c.File(indexPath)
			return
		}

		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "frontend build not found",
			"hint":    "run npm install && npm run build in HA-Services-MaintenanceView/frontend",
		})
	})

	return router
}
