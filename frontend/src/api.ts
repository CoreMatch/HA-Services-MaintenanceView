// 与后端代理层（internal/models/orchestration.go）一一对齐的类型定义。
// 上游形状以 HA-Services-Deployer 编排端点实际实现为准；本文件只做镜像，
// 不臆测字段。

export type SessionStatus = {
  auth_required: boolean;
  authenticated: boolean;
};

export type DeployManifestEntry = {
  project: string;
  kind: string; // service | external | plugin
  display_name: string;
  group: string;
  service_version: string;
  manager: string; // tinyvisor | aapanel | manual | plugin | ""(external)
  source_path: string;
};

export type DeployManifests = {
  count: number;
  projects: DeployManifestEntry[];
  errors: string[];
};

export type DeployValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type DeployProjectStatus = {
  project: string;
  kind: string;
  group: string;
  manager: string;
  foreign: boolean;
  declared_version: string;
  active_version?: string;
  tinyvisor_state?: string;
  healthy?: boolean;
  detail?: string;
};

export type DeployStatusReport = {
  generated_at: string;
  tinyvisor_reachable: boolean;
  projects: DeployProjectStatus[];
};

export type RunOptions = {
  projects?: string[];
  group?: string;
  dry_run?: boolean;
  auto_rollback_on_fail?: boolean;
};

export type RollbackRequest = {
  project: string;
  to: string;
  cascade: boolean;
};

export type RunStep = {
  name: string;
  ok: boolean;
  detail?: string;
};

// outcome 取值：pending | up-to-date | deployed | rolled-back | reachable |
// failed | skipped | foreign | plugin | dry-run
export type RunProjectResult = {
  project: string;
  outcome: string;
  detail?: string;
  declared_version: string;
  active_version?: string;
  steps?: RunStep[];
  started_at: string;
  finished_at: string;
};

export type CheckResult = {
  project?: string;
  name: string;
  level?: string; // blocker | warning
  ok: boolean;
  detail: string;
};

export type PreflightReport = {
  checked_at: string;
  mode: string; // deploy | rollback
  scope: string[];
  results: CheckResult[];
  blockers: CheckResult[];
  warnings: CheckResult[];
};

// state 取值：running | done | failed；type：deploy | rollback
export type Run = {
  id: string;
  type: string;
  state: string;
  options: RunOptions;
  order: string[];
  results: Record<string, RunProjectResult>;
  preflight?: PreflightReport;
  notes?: string[];
  started_at: string;
  finished_at?: string;
};

export type RunSummary = {
  id: string;
  type: string;
  state: string;
  started_at: string;
  finished_at?: string;
  outcomes: Record<string, number>;
};

export type RunsList = {
  runs: RunSummary[];
};

export type ManagerGateRejection = {
  project: string;
  reason: string;
};

// 后端失败响应可能携带的 data 段形态（分项错误 / 前置检查报告 / 闸门拒绝）。
export type UpstreamErrorData = {
  errors?: string[];
  preflight?: PreflightReport;
  rejections?: ManagerGateRejection[];
  // 初始化向导：逐项字段人话错误（必填缺失当场拦截）。
  field_errors?: { field: string; message: string }[];
};

export type ApiFailure = {
  status: number;
  message: string;
  code?: string;
  upstream_status?: number;
  data?: UpstreamErrorData;
};

export class ApiError extends Error {
  failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

// requestEnvelope 调用本进程 /api/*：成功返回 data 段；失败抛出 ApiError，
// 保留后端翻译后的 message 与上游 data 段（分项错误必须读得到）。
export async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  let body: {
    success?: boolean;
    message?: string;
    code?: string;
    upstream_status?: number;
    data?: unknown;
  };
  try {
    body = await response.json();
  } catch {
    throw new ApiError({ status: response.status, message: `响应不是合法 JSON (HTTP ${response.status})` });
  }

  if (!response.ok || body.success === false) {
    throw new ApiError({
      status: response.status,
      message: body.message || `请求失败 (HTTP ${response.status})`,
      code: body.code,
      upstream_status: body.upstream_status,
      data: body.data as UpstreamErrorData | undefined,
    });
  }
  return body.data as T;
}

// 上游 Go 端 nil slice 会序列化成 JSON null（如校验无错误时的 errors）；
// 界面一律按空数组消费，归一化集中在这一层。
function normalizeValidation(v: DeployValidation): DeployValidation {
  return { ...v, errors: v.errors ?? [], warnings: v.warnings ?? [] };
}

function normalizeManifests(m: DeployManifests): DeployManifests {
  return { ...m, projects: m.projects ?? [], errors: m.errors ?? [] };
}

function normalizePreflight(p?: PreflightReport): PreflightReport | undefined {
  if (!p) {
    return undefined;
  }
  return {
    ...p,
    scope: p.scope ?? [],
    results: p.results ?? [],
    blockers: p.blockers ?? [],
    warnings: p.warnings ?? [],
  };
}

function normalizeRun(run: Run): Run {
  return {
    ...run,
    order: run.order ?? [],
    results: run.results ?? {},
    notes: run.notes ?? [],
    preflight: normalizePreflight(run.preflight),
  };
}

function normalizeSummary(summary: RunSummary): RunSummary {
  return { ...summary, outcomes: summary.outcomes ?? {} };
}

// ---- 首次运行初始化（向导）----

export type BootstrapInfraInstance = {
  kind: string;
  mode: string; // container | external | absent
  container_name?: string;
  compose_service?: string;
  image?: string;
  host_port?: number;
  container_port?: number;
  baremetal_address?: string;
  compose_address?: string;
  data_volume?: string;
  healthy: boolean;
  detail?: string;
};

export type BootstrapInfra = {
  mysql: BootstrapInfraInstance;
  redis: BootstrapInfraInstance;
};

export type BootstrapStatus = {
  state_exists: boolean;
  secrets: Record<string, string>;
  signing_key_fingerprint?: string;
  artifacts: { env_file: boolean; signing_private_key: boolean; signing_public_key: boolean };
  deploy_token_configured: boolean;
  templates: string[];
  infra: BootstrapInfra;
  defaults: {
    client_ids: Record<string, string>;
    db_names: Record<string, string>;
    app_db_user: string;
    config_files: Record<string, string>;
    baremetal_outputs: Record<string, string>;
  };
  maintenance_view: { mode: string; address?: string; pid?: number; healthy?: boolean; detail?: string };
};

export type PlanItem = { step: string; action: string; target: string; detail: string };

export type BootstrapPlan = { items: PlanItem[]; secrets: Record<string, string> };

export type BootstrapStep = { name: string; status: string; detail?: string; updated_at: string };

export type BootstrapRun = {
  id: string;
  state: string; // running | done | failed
  dry_run: boolean;
  steps: Record<string, BootstrapStep>;
  step_order: string[];
  secrets?: Record<string, string>;
  notes?: string[];
  started_at: string;
  finished_at?: string;
};

export const api = {
  session: () => requestEnvelope<SessionStatus>("/api/session"),
  login: (token: string) =>
    requestEnvelope<{ auth_required: boolean }>("/api/session/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  logout: () => requestEnvelope<never>("/api/session/logout", { method: "POST" }),

  orchestrationManifests: async () => normalizeManifests(await requestEnvelope<DeployManifests>("/api/orchestration/manifest")),
  orchestrationValidation: async () => normalizeValidation(await requestEnvelope<DeployValidation>("/api/orchestration/validation")),
  orchestrationStatus: () => requestEnvelope<DeployStatusReport>("/api/orchestration/status"),
  orchestrationRuns: async () => {
    const list = await requestEnvelope<RunsList>("/api/orchestration/runs");
    return { runs: (list.runs ?? []).map(normalizeSummary) };
  },
  orchestrationRun: async (id: string) =>
    normalizeRun(await requestEnvelope<Run>(`/api/orchestration/runs/${encodeURIComponent(id)}`)),
  triggerDeploy: async (options: RunOptions) =>
    normalizeRun(
      await requestEnvelope<Run>("/api/orchestration/deploy", {
        method: "POST",
        body: JSON.stringify(options),
      })
    ),
  triggerRollback: async (request: RollbackRequest) =>
    normalizeRun(
      await requestEnvelope<Run>("/api/orchestration/rollback", {
        method: "POST",
        body: JSON.stringify(request),
      })
    ),

  // 首次运行初始化（向导）。
  bootstrapStatus: () => requestEnvelope<BootstrapStatus>("/api/bootstrap/status"),
  bootstrapInfra: () => requestEnvelope<BootstrapInfra>("/api/bootstrap/infra"),
  bootstrapInfraMySQL: (body: unknown) =>
    requestEnvelope<BootstrapInfraInstance>("/api/bootstrap/infra/mysql", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  bootstrapInfraRedis: (body: unknown) =>
    requestEnvelope<BootstrapInfraInstance>("/api/bootstrap/infra/redis", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  bootstrapPlan: (inputs: unknown) =>
    requestEnvelope<BootstrapPlan>("/api/bootstrap/plan", {
      method: "POST",
      body: JSON.stringify(inputs),
    }),
  bootstrapRun: (inputs: unknown) =>
    requestEnvelope<BootstrapRun>("/api/bootstrap/run", {
      method: "POST",
      body: JSON.stringify(inputs),
    }),
  bootstrapRunById: (id: string) =>
    requestEnvelope<BootstrapRun>(`/api/bootstrap/runs/${encodeURIComponent(id)}`),
};

// 只有 manager == tinyvisor 的 service 项目可由本面板部署/回滚。
export function isDeployable(entry: { kind?: string; manager?: string }): boolean {
  return entry.manager === "tinyvisor" && (entry.kind ?? "service") !== "external";
}

export function managerLabel(manager: string, kind?: string): string {
  if (kind === "external" || manager === "") return "外部依赖";
  if (kind === "plugin" || manager === "plugin") return "插件产物(只登记)";
  if (manager === "tinyvisor") return "Tinyvisor 管理";
  if (manager === "aapanel") return "宝塔面板管理";
  if (manager === "manual") return "人工管理";
  return `${manager} 管理`;
}
