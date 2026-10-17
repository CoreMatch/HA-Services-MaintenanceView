package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"HA-Services-MaintenanceView/internal/deployer"
	"HA-Services-MaintenanceView/internal/models"
	"HA-Services-MaintenanceView/internal/state"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg *models.Config, client *deployer.Client, store *state.Store) *gin.Engine {
	router := gin.Default()
	handler := NewHandler(cfg, client, store)

	router.GET("/healthz", handler.Healthz)

	api := router.Group("/api")
	{
		api.GET("/healthz", handler.Healthz)
		api.GET("/config", handler.GetConfig)
		api.GET("/projects", handler.GetProjects)
		api.PUT("/projects/:name/deployment", handler.SaveProjectDeployment)
		api.POST("/projects/:name/precheck", handler.RunProjectPrecheck)
		api.GET("/deployer/healthz", handler.GetDeployerHealthz)
		api.GET("/deployer/manifest", handler.GetDeployerManifest)
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
