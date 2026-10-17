package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"HA-Services-MaintenanceView/internal/deployer"
	"HA-Services-MaintenanceView/internal/models"
	"HA-Services-MaintenanceView/internal/state"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	cfg    *models.Config
	client *deployer.Client
	store  *state.Store
}

func NewHandler(cfg *models.Config, client *deployer.Client, store *state.Store) *Handler {
	return &Handler{
		cfg:    cfg,
		client: client,
		store:  store,
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

func (h *Handler) GetProjects(c *gin.Context) {
	projects, generatedAt, err := h.buildProjectViews(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "failed to load project list",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "projects loaded",
		"data": gin.H{
			"generated_at": generatedAt,
			"projects":     projects,
		},
	})
}

func (h *Handler) SaveProjectDeployment(c *gin.Context) {
	projectName := c.Param("name")

	var input models.ProjectDeployment
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid deployment payload",
			"error":   err.Error(),
		})
		return
	}

	deployDir := strings.TrimSpace(input.DeployDir)
	if deployDir == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "deploy_dir is required",
		})
		return
	}

	remote, err := h.client.Projects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "failed to validate project against deployer",
			"error":   err.Error(),
		})
		return
	}

	if !hasProject(remote.Projects, projectName) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "project not found in deployer list",
		})
		return
	}

	settings, err := h.store.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "failed to load project settings",
			"error":   err.Error(),
		})
		return
	}

	settings.Projects[projectName] = models.ProjectDeployment{DeployDir: deployDir}
	if err := h.store.Save(settings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "failed to save project settings",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "deployment path saved",
		"data": gin.H{
			"name":       projectName,
			"deploy_dir": deployDir,
		},
	})
}

func (h *Handler) RunProjectPrecheck(c *gin.Context) {
	projectName := c.Param("name")

	var input models.UpdatePrecheckRequest
	_ = c.ShouldBindJSON(&input)

	remote, err := h.client.Projects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "failed to load deployer projects",
			"error":   err.Error(),
		})
		return
	}

	project, artifact, err := selectProjectArtifact(remote.Projects, projectName, input.ArtifactID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "failed to run precheck",
			"error":   err.Error(),
		})
		return
	}

	settings, err := h.store.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "failed to load project settings",
			"error":   err.Error(),
		})
		return
	}

	deployDir := strings.TrimSpace(settings.Projects[project.Name].DeployDir)
	if deployDir == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "deploy_dir is not configured for this project",
		})
		return
	}

	result, err := runPrecheck(project.Name, deployDir, artifact)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "precheck failed",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "precheck completed",
		"data":    result,
	})
}

func (h *Handler) buildProjectViews(ctx context.Context) ([]models.ProjectView, string, error) {
	remote, err := h.client.Projects(ctx)
	if err != nil {
		return nil, "", err
	}

	settings, err := h.store.Load()
	if err != nil {
		return nil, "", err
	}

	projects := make([]models.ProjectView, 0, len(remote.Projects))
	for _, project := range remote.Projects {
		view := models.ProjectView{
			Name:        project.Name,
			DisplayName: project.DisplayName,
			Channel:     project.Channel,
			Version:     project.Version,
			PublishedAt: project.PublishedAt,
			DeployDir:   settings.Projects[project.Name].DeployDir,
			Artifacts:   make([]models.ProjectArtifact, 0, len(project.Artifacts)),
		}

		for _, artifact := range project.Artifacts {
			view.Artifacts = append(view.Artifacts, models.ProjectArtifact{
				ID:           artifact.ID,
				FileName:     artifact.FileName,
				DownloadPath: artifact.DownloadPath,
				DownloadURL:  buildDownloadURL(h.cfg.Deployer.BaseURL, project.Name, artifact.DownloadPath),
				SHA256:       artifact.SHA256,
				SizeBytes:    artifact.SizeBytes,
				OS:           artifact.OS,
				Arch:         artifact.Arch,
			})
		}

		projects = append(projects, view)
	}

	return projects, remote.GeneratedAt, nil
}

func hasProject(projects []models.RemoteProject, name string) bool {
	for _, project := range projects {
		if project.Name == name {
			return true
		}
	}
	return false
}

func selectProjectArtifact(projects []models.RemoteProject, projectName, artifactID string) (*models.RemoteProject, *models.RemoteArtifact, error) {
	for _, project := range projects {
		if project.Name != projectName {
			continue
		}
		if len(project.Artifacts) == 0 {
			return nil, nil, fmt.Errorf("project %q does not expose binary artifacts", projectName)
		}

		if strings.TrimSpace(artifactID) == "" {
			artifact := project.Artifacts[0]
			return &project, &artifact, nil
		}

		for _, artifact := range project.Artifacts {
			if artifact.ID == artifactID {
				artifactCopy := artifact
				return &project, &artifactCopy, nil
			}
		}

		return nil, nil, fmt.Errorf("artifact %q not found for project %q", artifactID, projectName)
	}

	return nil, nil, fmt.Errorf("project %q not found", projectName)
}

func buildDownloadURL(baseURL, projectName, downloadPath string) string {
	return strings.TrimRight(baseURL, "/") + "/api/v1/artifacts/" + projectName + "/" + strings.TrimLeft(downloadPath, "/")
}

func runPrecheck(projectName, deployDir string, artifact *models.RemoteArtifact) (*models.UpdatePrecheckResult, error) {
	result := &models.UpdatePrecheckResult{
		ProjectName: projectName,
		DeployDir:   deployDir,
		ArtifactID:  artifact.ID,
	}

	dirInfo, err := os.Stat(deployDir)
	if err != nil {
		if os.IsNotExist(err) {
			if err := os.MkdirAll(deployDir, 0o777); err != nil {
				return nil, err
			}
			result.DirectoryCreated = true
		} else {
			return nil, err
		}
	} else {
		result.DirectoryModeBefore = formatPerm(dirInfo.Mode().Perm())
	}

	if err := os.Chmod(deployDir, 0o777); err != nil {
		return nil, err
	}
	result.DirectoryModeAfter = formatPerm(0o777)

	executablePath := filepath.Join(deployDir, artifact.FileName)
	result.ExecutablePath = executablePath

	fileInfo, err := os.Stat(executablePath)
	if err != nil {
		if os.IsNotExist(err) {
			result.Message = "directory is ready and set to 777; executable does not exist yet"
			return result, nil
		}
		return nil, err
	}

	result.FileExists = true
	result.FileModeBefore = formatPerm(fileInfo.Mode().Perm())
	if err := os.Chmod(executablePath, 0o777); err != nil {
		return nil, err
	}
	result.FileModeAfter = formatPerm(0o777)
	result.Message = "directory and executable permissions are ready"

	return result, nil
}

func formatPerm(mode os.FileMode) string {
	return fmt.Sprintf("%03o", mode.Perm())
}
