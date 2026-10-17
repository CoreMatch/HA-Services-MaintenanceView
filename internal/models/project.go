package models

type RemoteProjectsEnvelope struct {
	GeneratedAt string          `json:"generated_at"`
	Projects    []RemoteProject `json:"projects"`
}

type RemoteProject struct {
	Name        string           `json:"name"`
	DisplayName string           `json:"display_name,omitempty"`
	Channel     string           `json:"channel,omitempty"`
	Version     string           `json:"version"`
	PublishedAt string           `json:"published_at,omitempty"`
	Artifacts   []RemoteArtifact `json:"artifacts"`
}

type RemoteArtifact struct {
	ID           string `json:"id"`
	Role         string `json:"role"`
	OS           string `json:"os,omitempty"`
	Arch         string `json:"arch,omitempty"`
	FileName     string `json:"file_name"`
	DownloadPath string `json:"download_path"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"size_bytes"`
}

type ProjectSettings struct {
	Projects map[string]ProjectDeployment `json:"projects"`
}

type ProjectDeployment struct {
	DeployDir string `json:"deploy_dir"`
	Port      int    `json:"port,omitempty"`
}

type ProjectView struct {
	Name             string              `json:"name"`
	DisplayName      string              `json:"display_name,omitempty"`
	Channel          string              `json:"channel,omitempty"`
	Version          string              `json:"version"`
	PublishedAt      string              `json:"published_at,omitempty"`
	DeployDir        string              `json:"deploy_dir,omitempty"`
	Port             int                 `json:"port,omitempty"`
	DefaultPort      int                 `json:"default_port,omitempty"`
	InitSupported    bool                `json:"init_supported"`
	ConfigFileName   string              `json:"config_file_name,omitempty"`
	InitDependencies []ProjectDependency `json:"init_dependencies,omitempty"`
	Artifacts        []ProjectArtifact   `json:"artifacts"`
}

type ProjectArtifact struct {
	ID           string `json:"id"`
	FileName     string `json:"file_name"`
	DownloadPath string `json:"download_path"`
	DownloadURL  string `json:"download_url"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"size_bytes"`
	OS           string `json:"os,omitempty"`
	Arch         string `json:"arch,omitempty"`
}

type ProjectDependency struct {
	Name   string   `json:"name"`
	Fields []string `json:"fields"`
}

type UpdatePrecheckRequest struct {
	ArtifactID string `json:"artifact_id"`
}

type UpdatePrecheckResult struct {
	ProjectName         string `json:"project_name"`
	DeployDir           string `json:"deploy_dir"`
	ArtifactID          string `json:"artifact_id"`
	ExecutablePath      string `json:"executable_path"`
	DirectoryCreated    bool   `json:"directory_created"`
	DirectoryModeBefore string `json:"directory_mode_before,omitempty"`
	DirectoryModeAfter  string `json:"directory_mode_after"`
	FileExists          bool   `json:"file_exists"`
	FileModeBefore      string `json:"file_mode_before,omitempty"`
	FileModeAfter       string `json:"file_mode_after,omitempty"`
	Message             string `json:"message"`
}

type ProjectInitializationRequest struct {
	ArtifactID string `json:"artifact_id"`
}

type ProjectInitializationChange struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

type ProjectInitializationResult struct {
	ProjectName     string                        `json:"project_name"`
	ArtifactID      string                        `json:"artifact_id"`
	DeployDir       string                        `json:"deploy_dir"`
	Port            int                           `json:"port"`
	ExecutablePath  string                        `json:"executable_path"`
	ConfigPath      string                        `json:"config_path"`
	ConfigGenerated bool                          `json:"config_generated"`
	Changes         []ProjectInitializationChange `json:"changes"`
	DependencyPorts map[string]int                `json:"dependency_ports,omitempty"`
	Message         string                        `json:"message"`
}
