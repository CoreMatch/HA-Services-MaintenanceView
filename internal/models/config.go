package models

type Config struct {
	Version   string          `yaml:"version" json:"version"`
	Server    ServerConfig    `yaml:"server" json:"server"`
	Cupbearer CupbearerConfig `yaml:"cupbearer" json:"cupbearer"`
	State     StateConfig     `yaml:"state" json:"state"`
}

type ServerConfig struct {
	Listen        string `yaml:"listen" json:"listen"`
	PublicBaseURL string `yaml:"public_base_url" json:"public_base_url"`
	FrontendDist  string `yaml:"frontend_dist" json:"frontend_dist"`
	// LoopbackSession 为 true 时：来自回环地址的请求免登录（会话门放行）。
	// 仅用于 Cupbearer 自动拉起的受管形态——面板被钉在 127.0.0.1，回环信任
	// 与既有"SSH 隧道即本人访问"的运维约定同级；部署凭据仍由服务端持有并
	// 转发，浏览器永远接触不到。独立部署形态默认 false（零回归）。
	// 回环判定依赖 Context.ClientIP()，其安全性由下方 TrustedProxies 保证。
	LoopbackSession bool `yaml:"loopback_session" json:"loopback_session"`
	// TrustedProxies 显式列出可信反向代理的来源（IP 或 CIDR）。默认空 =
	// 不信任任何代理：ClientIP() 一律取直连远端地址，伪造
	// X-Forwarded-For: 127.0.0.1 无法冒充回环绕过登录门。仅当面板真的置于
	// 反代之后时才配置；此时反代必须用真实客户端 IP 覆写 X-Forwarded-For，
	// 且防火墙只放行代理来源，否则等价于把伪造权交给任何能直连的人。
	TrustedProxies []string `yaml:"trusted_proxies" json:"trusted_proxies"`
	// CookieSecure 控制会话 Cookie 的 Secure 位。默认 false 兼容本机 HTTP；
	// 面板经 HTTPS 对外暴露时必须置 true（否则 Cookie 可能经明文链路泄露）。
	CookieSecure bool `yaml:"cookie_secure" json:"cookie_secure"`
}

// CupbearerConfig 描述上游 HA-Cupbearer 的连接方式。
// Token 是 Cupbearer 变更端点（部署/回滚）的部署凭据，即既有的运维身份：
//   - 服务端代理变更请求时注入 X-Deploy-Token 请求头转发，绝不下发到浏览器；
//   - 面板登录会话复用它做验证（作者决策：不为面板另起账号体系）；
//   - json 标签为 "-"，保证任何 JSON 序列化（含 /api/config）都不回显。
//
// 留空时保持历史行为：免登录、变更代理 fail-closed（503）。
// 历史配置段名 deployer 由 config.Load 兼容映射到本段（见 internal/config）。
type CupbearerConfig struct {
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
			// 2771 = MV 裸金属生产端口（与 config.example.yaml、deploy-manifest
			// 一致）；历史容器模板/代码默认曾误写 18081，已统一到 2771。
			Listen:        ":2771",
			PublicBaseURL: "http://127.0.0.1:2771",
			FrontendDist:  "./frontend/dist",
			// 安全默认：不信任任何代理（ClientIP 取直连远端），Cookie 不带
			// Secure（兼容本机 HTTP）。二者均为可配置项，见 ServerConfig。
			TrustedProxies: nil,
			CookieSecure:   false,
		},
		Cupbearer: CupbearerConfig{
			BaseURL: "http://127.0.0.1:18080",
		},
		State: StateConfig{
			ProjectsPath: "./data/projects.json",
		},
	}
}
