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

// DeployerConfig 描述上游 Deployer 的连接方式。
// Token 是 Deployer 变更端点（部署/回滚）的部署凭据，即既有的运维身份：
//   - 服务端代理变更请求时注入 X-Deploy-Token 请求头转发，绝不下发到浏览器；
//   - 面板登录会话复用它做验证（作者决策：不为面板另起账号体系）；
//   - json 标签为 "-"，保证任何 JSON 序列化（含 /api/config）都不回显。
//
// 留空时保持历史行为：免登录、变更代理 fail-closed（503）。
type DeployerConfig struct {
	BaseURL string `yaml:"base_url" json:"base_url"`
	Token   string `yaml:"token" json:"-"`
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
