package models

type Config struct {
	Server   ServerConfig   `yaml:"server" json:"server"`
	Deployer DeployerConfig `yaml:"deployer" json:"deployer"`
}

type ServerConfig struct {
	Listen        string `yaml:"listen" json:"listen"`
	PublicBaseURL string `yaml:"public_base_url" json:"public_base_url"`
	FrontendDist  string `yaml:"frontend_dist" json:"frontend_dist"`
}

type DeployerConfig struct {
	BaseURL string `yaml:"base_url" json:"base_url"`
}

func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Listen:        ":18081",
			PublicBaseURL: "http://127.0.0.1:18081",
			FrontendDist:  "./frontend/dist",
		},
		Deployer: DeployerConfig{
			BaseURL: "http://127.0.0.1:18080",
		},
	}
}
