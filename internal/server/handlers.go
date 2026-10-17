package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
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
	if input.Port < 0 || input.Port > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "port must be between 1 and 65535",
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
	if _, ok := getBootstrapSpec(projectName); ok && input.Port <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "port is required for initialization",
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
	if input.Port > 0 {
		if err := validateUniquePort(projectName, input.Port, remote.Projects, settings); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "invalid port assignment",
				"error":   err.Error(),
			})
			return
		}
	}

	settings.Projects[projectName] = models.ProjectDeployment{
		DeployDir: deployDir,
		Port:      input.Port,
	}
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
		"message": "deployment settings saved",
		"data": gin.H{
			"name":       projectName,
			"deploy_dir": deployDir,
			"port":       input.Port,
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

func (h *Handler) InitializeProject(c *gin.Context) {
	projectName := c.Param("name")

	var input models.ProjectInitializationRequest
	_ = c.ShouldBindJSON(&input)

	spec, ok := getBootstrapSpec(projectName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "initialization is not supported for this project yet",
		})
		return
	}

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
			"message": "failed to initialize project",
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

	deployment := settings.Projects[project.Name]
	deployDir := strings.TrimSpace(deployment.DeployDir)
	if deployDir == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "deploy_dir is not configured for this project",
		})
		return
	}

	if deployment.Port <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "port is not configured for this project",
		})
		return
	}

	if err := validateUniquePort(project.Name, deployment.Port, remote.Projects, settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid port assignment",
			"error":   err.Error(),
		})
		return
	}

	if _, err := runPrecheck(project.Name, deployDir, artifact); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "precheck failed before initialization",
			"error":   err.Error(),
		})
		return
	}

	dependencyPorts, err := collectDependencyPorts(spec, settings)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "dependency ports are incomplete",
			"error":   err.Error(),
		})
		return
	}

	result, err := initializeProjectConfig(project.Name, deployDir, artifact, spec, deployment.Port, dependencyPorts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "project initialization failed",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "project initialization completed",
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
		spec, supported := getBootstrapSpec(project.Name)
		view := models.ProjectView{
			Name:           project.Name,
			DisplayName:    project.DisplayName,
			Channel:        project.Channel,
			Version:        project.Version,
			PublishedAt:    project.PublishedAt,
			DeployDir:      settings.Projects[project.Name].DeployDir,
			Port:           settings.Projects[project.Name].Port,
			InitSupported:  supported,
			Artifacts:      make([]models.ProjectArtifact, 0, len(project.Artifacts)),
			DefaultPort:    spec.DefaultPort,
			ConfigFileName: spec.ConfigFileName,
		}
		if supported {
			view.InitDependencies = make([]models.ProjectDependency, 0, len(spec.Dependencies))
			for _, dependency := range spec.Dependencies {
				view.InitDependencies = append(view.InitDependencies, models.ProjectDependency{
					Name:   dependency.ProjectName,
					Fields: slices.Clone(dependency.FieldPaths),
				})
			}
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

func validateUniquePort(projectName string, port int, remoteProjects []models.RemoteProject, settings *models.ProjectSettings) error {
	if port <= 0 {
		return nil
	}

	knownProjects := make(map[string]struct{}, len(remoteProjects))
	for _, project := range remoteProjects {
		knownProjects[project.Name] = struct{}{}
	}

	for name, deployment := range settings.Projects {
		if name == projectName || deployment.Port <= 0 {
			continue
		}
		if _, ok := knownProjects[name]; !ok {
			continue
		}
		if deployment.Port == port {
			return fmt.Errorf("port %d is already assigned to project %q", port, name)
		}
	}

	return nil
}

func collectDependencyPorts(spec bootstrapSpec, settings *models.ProjectSettings) (map[string]int, error) {
	ports := make(map[string]int, len(spec.Dependencies))
	for _, dependency := range spec.Dependencies {
		port := settings.Projects[dependency.ProjectName].Port
		if port <= 0 {
			return nil, fmt.Errorf("project %q needs the port of %q to be saved first", dependency.ProjectName, dependency.ProjectName)
		}
		ports[dependency.ProjectName] = port
	}
	return ports, nil
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
