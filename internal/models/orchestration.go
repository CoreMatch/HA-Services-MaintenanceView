package models

// 本文件定义编排代理层使用的数据形状，与 HA-Services-Deployer 编排端点
// 的实际实现对齐（internal/server/handlers_deploy.go、internal/orchestrator、
// internal/manifest，2026-11-08 对账）。上游若再演进，只改本文件与
// internal/deployer/client.go 两处。

// Manager 取值（manifest.ProcessSpec.Manager）：
//   - tinyvisor — 编排器可驱动（唯一可部署/回滚的类别）；
//   - aapanel   — 宝塔面板管理，只读（foreign）；
//   - manual    — 人工管理，只读（foreign）；
//   - external 类项目（kind=external）无进程，manager 为空。
const ManagerTinyvisor = "tinyvisor"

// DeployManifests 是 GET /api/v1/deploy/manifests 的 data 段。
type DeployManifests struct {
	Count    int                   `json:"count"`
	Projects []DeployManifestEntry `json:"projects"`
	Errors   []string              `json:"errors"`
}

type DeployManifestEntry struct {
	Project        string `json:"project"`
	Kind           string `json:"kind"` // service | external
	DisplayName    string `json:"display_name"`
	Group          string `json:"group"`
	ServiceVersion string `json:"service_version"`
	Manager        string `json:"manager"`
	SourcePath     string `json:"source_path"`
}

// DeployValidation 是 GET /api/v1/deploy/validate 的 data 段。
// 校验错误与警告都是字符串列表（上游聚合校验报告）。
type DeployValidation struct {
	OK       bool     `json:"ok"`
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

// DeployStatusReport 是 GET /api/v1/deploy/status 的 data 段。
type DeployStatusReport struct {
	GeneratedAt        string                 `json:"generated_at"`
	TinyvisorReachable bool                   `json:"tinyvisor_reachable"`
	Projects           []DeployProjectStatus  `json:"projects"`
}

type DeployProjectStatus struct {
	Project         string `json:"project"`
	Kind            string `json:"kind"`
	Group           string `json:"group"`
	Manager         string `json:"manager"`
	Foreign         bool   `json:"foreign"`
	DeclaredVersion string `json:"declared_version"`
	ActiveVersion   string `json:"active_version,omitempty"`
	TinyvisorState  string `json:"tinyvisor_state,omitempty"`
	Healthy         *bool  `json:"healthy,omitempty"`
	Detail          string `json:"detail,omitempty"`
}

// RunOptions 是 POST /api/v1/deploy/run 的请求体；空体 = 全量部署。
type RunOptions struct {
	Projects           []string `json:"projects,omitempty"`
	Group              string   `json:"group,omitempty"`
	DryRun             bool     `json:"dry_run,omitempty"`
	AutoRollbackOnFail *bool    `json:"auto_rollback_on_fail,omitempty"`
}

// RollbackRequest 是 POST /api/v1/deploy/rollback 的请求体（单项目）。
type RollbackRequest struct {
	Project string `json:"project"`
	To      string `json:"to"`
	Cascade bool   `json:"cascade"`
}

// Run 相关形状（orchestrator.Run 的 JSON 面）。

type RunStep struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// Outcome 取值：pending | up-to-date | deployed | rolled-back | reachable |
// failed | skipped | foreign | dry-run。
type RunProjectResult struct {
	Project         string    `json:"project"`
	Outcome         string    `json:"outcome"`
	Detail          string    `json:"detail,omitempty"`
	DeclaredVersion string    `json:"declared_version"`
	ActiveVersion   string    `json:"active_version,omitempty"`
	Steps           []RunStep `json:"steps,omitempty"`
	StartedAt       string    `json:"started_at"`
	FinishedAt      string    `json:"finished_at"`
}

// Run.State 取值：running | done | failed；Type：deploy | rollback。
type Run struct {
	ID      string                      `json:"id"`
	Type    string                      `json:"type"`
	State   string                      `json:"state"`
	Options RunOptions                  `json:"options"`
	Order   []string                    `json:"order"`
	Results map[string]RunProjectResult `json:"results"`
	// Preflight 留存本次运行开局时放行（无阻断项）的前置检查报告；
	// 被阻断的运行根本不会开始，其报告随 400 拒绝响应的 data.preflight 返回。
	Preflight *PreflightReport `json:"preflight,omitempty"`
	// Notes 是本次运行的异常事件记录（如 state.json 损坏后的恢复动作），
	// 失败与降级必须可见，不得静默。
	Notes      []string `json:"notes,omitempty"`
	StartedAt  string   `json:"started_at"`
	FinishedAt string   `json:"finished_at,omitempty"`
}

// CheckLevel 取值：blocker | warning。
type CheckResult struct {
	Project string `json:"project,omitempty"`
	Name    string `json:"name"`
	Level   string `json:"level,omitempty"`
	OK      bool   `json:"ok"`
	Detail  string `json:"detail"`
}

// PreflightReport 是前置检查报告（Run.Preflight 与 400 拒绝响应
// data.preflight 共用同一形状）。
type PreflightReport struct {
	CheckedAt string        `json:"checked_at"`
	Mode      string        `json:"mode"` // deploy | rollback
	Scope     []string      `json:"scope"`
	Results   []CheckResult `json:"results"`
	Blockers  []CheckResult `json:"blockers"`
	Warnings  []CheckResult `json:"warnings"`
}

type RunSummary struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	State      string         `json:"state"`
	StartedAt  string         `json:"started_at"`
	FinishedAt string         `json:"finished_at,omitempty"`
	Outcomes   map[string]int `json:"outcomes"`
}

type RunsList struct {
	Runs []RunSummary `json:"runs"`
}
