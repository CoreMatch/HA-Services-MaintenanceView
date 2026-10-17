package server

import (
	"net/http"
	"time"

	"HA-Services-MaintenanceView/internal/deployer"
	"HA-Services-MaintenanceView/internal/models"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	cfg    *models.Config
	client *deployer.Client
}

func NewHandler(cfg *models.Config, client *deployer.Client) *Handler {
	return &Handler{
		cfg:    cfg,
		client: client,
	}
}

func (h *Handler) Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "ok",
		"data": gin.H{
			"service": "ha-services-maintenance-view",
			"time":    time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (h *Handler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "config loaded",
		"data":    h.cfg,
	})
}

func (h *Handler) GetDeployerHealthz(c *gin.Context) {
	data, err := h.client.Healthz(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "failed to reach deployer health endpoint",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "deployer health fetched",
		"data":    data,
	})
}

func (h *Handler) GetDeployerManifest(c *gin.Context) {
	data, err := h.client.Manifest(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "failed to reach deployer manifest endpoint",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "deployer manifest fetched",
		"data":    data,
	})
}
