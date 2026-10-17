package models

type Config struct {
	Version  string         `yaml:"version" json:"version"`
	Server   ServerConfig   `yaml:"server" json:"server"`
	Deployer DeployerConfig `yaml:"deployer" json:"deployer"`
	State    StateConfig    `yaml:"state" json:"state"`
}

type ServerConfig struct {
	Listen        string `yaml:"listen" json:"listen"`
	PublicBaseURL string `yaml:"public_base_url" json:"public_base_url"`
	FrontendDist  string `yaml:"frontend_dist" json:"frontend_dist"`
}

type DeployerConfig struct {
	BaseURL string `yaml:"base_url" json:"base_url"`
}

type StateConfig struct {
	ProjectsPath string `yaml:"projects_path" json:"projects_path"`
}

func DefaultConfig() *Config {
	return &Config{
		Version: "1",
		Server: ServerConfig{
			Listen:        ":2771",
			PublicBaseURL: "http://127.0.0.1:2771",
			FrontendDist:  "./frontend/dist",
		},
		Deployer: DeployerConfig{
			BaseURL: "http://127.0.0.1:18080",
		},
		State: StateConfig{
			ProjectsPath: "./data/projects.json",
		},
	}
}
