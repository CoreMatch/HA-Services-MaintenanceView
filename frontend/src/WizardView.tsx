import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  Inset,
  Input,
  Panel,
  Spinner,
  type BadgeTone,
} from "@ha/ui";
import {
  api,
  ApiError,
  type BootstrapInfra,
  type BootstrapInfraInstance,
  type BootstrapPlan,
  type BootstrapRun,
  type BootstrapStatus,
} from "./api";

// 一键开荒初始化向导：把一台全新机器变成可运行的 HA 平台。
// 设计（作者边界）：
//   - 能自动推导/生成的一律不让用户填——全部密钥、库名、客户端 id、内部
//     地址都由后端推导；向导只问"域名/对外地址"这类只有人知道的东西；
//   - MySQL/Redis 基础设施按所选部署路径各自成立：缺了就一键拉起，已有就接管；
//   - 幂等 + 断点续跑：重跑不覆盖已有值，中途失败可从上次继续；
//   - 生成值只显示掩码/指纹，绝不回显明文。

type PublicUrlState = {
  hrpauth: string;
  frontend: string;
  ygg: string;
  haskinproxy: string;
  winnerproxy: string;
  maintenanceview: string;
};

const PUBLIC_URL_FIELDS: { key: keyof PublicUrlState; label: string; placeholder: string }[] = [
  { key: "hrpauth", label: "HRPAuth 对外地址", placeholder: "https://ha.example.com" },
  { key: "frontend", label: "账号门户前端地址", placeholder: "https://auth.example.com" },
  { key: "ygg", label: "Yggdrasil-API 对外地址", placeholder: "https://ha.example.com/yggdrasil-api" },
  { key: "haskinproxy", label: "HASkinProxy 对外地址", placeholder: "https://skin-proxy.example.com" },
  { key: "winnerproxy", label: "WinnerProxy 对外地址", placeholder: "https://winner-proxy.example.com" },
  { key: "maintenanceview", label: "运维面板对外地址", placeholder: "https://maintenance.example.com" },
];

function actionTone(action: string): BadgeTone {
  switch (action) {
    case "generate":
    case "write":
    case "execute":
    case "merge":
      return "info";
    case "reuse":
    case "skip-exists":
      return "ok";
    case "warn-drift":
      return "warn";
    case "blocker":
      return "danger";
    default:
      return "neutral";
  }
}

function stepTone(status: string): BadgeTone {
  switch (status) {
    case "ok":
      return "ok";
    case "skipped":
      return "neutral";
    case "warn":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function InfraCard({
  inst,
  busy,
  onLaunch,
}: {
  inst: BootstrapInfraInstance;
  busy: boolean;
  onLaunch: () => void;
}) {
  const name = inst.kind === "mysql" ? "MySQL" : "Redis";
  const modeBadge =
    inst.mode === "container" ? (
      <Badge tone="ok">受管容器</Badge>
    ) : inst.mode === "external" ? (
      <Badge tone="info">接管复用</Badge>
    ) : (
      <Badge tone="warn">未检测到</Badge>
    );
  return (
    <Panel className="flex-1 min-w-[320px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink">{name}</span>
          {modeBadge}
          {inst.mode !== "absent" ? (
            inst.healthy ? (
              <Badge tone="ok">健康</Badge>
            ) : (
              <Badge tone="warn">未确认健康</Badge>
            )
          ) : null}
        </div>
        {inst.mode === "absent" ? (
          <Button size="sm" variant="primary" onClick={onLaunch} disabled={busy}>
            {busy ? <Spinner size={14} /> : null}一键拉起
          </Button>
        ) : null}
      </div>
      <Inset className="mt-3 space-y-1 text-sm text-ink-muted">
        {inst.mode !== "absent" ? (
          <>
            <div>
              裸金属链路连：<code className="text-ink">{inst.baremetal_address}</code>
            </div>
            <div>
              容器链路连：<code className="text-ink">{inst.compose_address}</code>
            </div>
            {inst.image ? <div>镜像：{inst.image}</div> : null}
            {inst.data_volume ? <div>数据卷：{inst.data_volume}（容器删了数据不丢）</div> : null}
          </>
        ) : (
          <div>尚未可用。点"一键拉起"自动生成凭据、拉起容器并等待真正可用；所选部署路径按对应形态连接。</div>
        )}
        {inst.detail ? <div className="text-ink-faint">{inst.detail}</div> : null}
      </Inset>
    </Panel>
  );
}

export default function WizardView() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [infra, setInfra] = useState<BootstrapInfra | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [urls, setUrls] = useState<PublicUrlState>({
    hrpauth: "",
    frontend: "",
    ygg: "",
    haskinproxy: "",
    winnerproxy: "",
    maintenanceview: "",
  });
  const [targets, setTargets] = useState({ container: true, baremetal: true });
  const [adminPassword, setAdminPassword] = useState("");
  // 裸金属渲染输出：根目录 + 逐服务路径（后端按清单预填，可就地改）。
  const [bmRoot, setBmRoot] = useState("");
  const [bmOutputs, setBmOutputs] = useState<Record<string, string>>({});
  const [bmConfigFiles, setBmConfigFiles] = useState<Record<string, string>>({});
  const [launchingMysql, setLaunchingMysql] = useState(false);
  const [launchingRedis, setLaunchingRedis] = useState(false);

  const [urlErrors, setUrlErrors] = useState<Partial<Record<keyof PublicUrlState, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [plan, setPlan] = useState<BootstrapPlan | null>(null);
  const [run, setRun] = useState<BootstrapRun | null>(null);
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [st, inf] = await Promise.all([api.bootstrapStatus(), api.bootstrapInfra()]);
      setStatus(st);
      setInfra(inf);
      const files = st.defaults?.config_files ?? {};
      const outputs = st.defaults?.baremetal_outputs ?? {};
      setBmConfigFiles(files);
      // 预填：后端按清单推导的输出路径优先；其余服务给空行等人填。
      setBmOutputs((cur) => {
        const next = { ...cur };
        for (const svc of Object.keys(files)) {
          if (!(svc in next)) next[svc] = outputs[svc] ?? "";
        }
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  function buildInputs() {
    const outputs: Record<string, string> = {};
    for (const [svc, path] of Object.entries(bmOutputs)) {
      if (path.trim()) outputs[svc] = path.trim();
    }
    return {
      targets: { container: targets.container, baremetal: targets.baremetal },
      infra: { launch: true },
      database: adminPassword.trim() ? { admin_password: adminPassword.trim() } : {},
      public_urls: { ...urls },
      paths: { baremetal_outputs: outputs },
    };
  }

  // 用根目录批量填充空的输出路径：<根>/<服务>/<配置文件名>。
  function fillFromRoot() {
    const root = bmRoot.trim().replace(/\/+$/, "");
    if (!root) return;
    setBmOutputs((cur) => {
      const next = { ...cur };
      for (const [svc, file] of Object.entries(bmConfigFiles)) {
        if (!next[svc]?.trim()) {
          next[svc] = `${root}/${svc}/${file || "config.yaml"}`;
        }
      }
      return next;
    });
  }

  // 当场拦截：对外地址必填。返回是否通过。
  function validateLocally(): boolean {
    const errs: Partial<Record<keyof PublicUrlState, string>> = {};
    for (const f of PUBLIC_URL_FIELDS) {
      const v = urls[f.key].trim();
      if (!v) {
        errs[f.key] = "必填：客户端/玩家要访问这个对外地址，空着服务起不来";
      } else if (!/^https?:\/\/.+/i.test(v)) {
        errs[f.key] = "需要带协议的完整 URL，例如 https://ha.example.com";
      }
    }
    setUrlErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function extractFieldErrors(err: unknown): { field: string; message: string }[] {
    if (err instanceof ApiError) {
      return err.failure.data?.field_errors ?? [];
    }
    return [];
  }

  async function doPlan() {
    setActionError(null);
    setFieldErrors([]);
    setPlan(null);
    if (!validateLocally()) return;
    setBusy("plan");
    try {
      const p = await api.bootstrapPlan(buildInputs());
      setPlan(p);
    } catch (err) {
      const fe = extractFieldErrors(err);
      if (fe.length) {
        setFieldErrors(fe);
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  function pollRun(id: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await api.bootstrapRunById(id);
        setRun(r);
        if (r.state !== "running" && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          void loadAll();
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setActionError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
  }

  async function doRun() {
    setActionError(null);
    setFieldErrors([]);
    if (!validateLocally()) return;
    setBusy("run");
    try {
      const r = await api.bootstrapRun(buildInputs());
      setRun(r);
      pollRun(r.id);
    } catch (err) {
      const fe = extractFieldErrors(err);
      if (fe.length) {
        setFieldErrors(fe);
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function launchInfra(kind: "mysql" | "redis") {
    setActionError(null);
    if (kind === "mysql") setLaunchingMysql(true);
    else setLaunchingRedis(true);
    try {
      if (kind === "mysql") await api.bootstrapInfraMySQL({});
      else await api.bootstrapInfraRedis({});
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (kind === "mysql") setLaunchingMysql(false);
      else setLaunchingRedis(false);
    }
  }

  const running = run?.state === "running";
  const secretEntries = useMemo(() => Object.entries(status?.secrets ?? {}), [status]);

  return (
    <div className="space-y-6">
      {loadError ? (
        <Banner tone="danger">
          <div>
            <div className="font-semibold">无法读取初始化状态</div>
            <div className="mt-1">{loadError}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadAll()}>
            重试
          </Button>
        </Banner>
      ) : null}

      {status && !status.deploy_token_configured ? (
        <Banner tone="warn">
          Deployer 尚未配置部署凭据（deploy token）：预览可用，但一键执行会被后端拒绝（fail-closed）。
        </Banner>
      ) : null}

      {/* 基础设施 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-ink">基础设施（MySQL / Redis）</h2>
        <p className="mb-3 text-sm text-ink-muted">
          基础设施按所选部署路径各自成立：裸金属编排连宿主地址+端口，容器编排连服务名+容器口。
          已存在就接管复用，不会重复起；缺失时一键拉起并等待真正可用。
        </p>
        {infra ? (
          <div className="flex flex-wrap gap-4">
            <InfraCard inst={infra.mysql} busy={launchingMysql} onLaunch={() => void launchInfra("mysql")} />
            <InfraCard inst={infra.redis} busy={launchingRedis} onLaunch={() => void launchInfra("redis")} />
          </div>
        ) : (
          <Spinner size={20} />
        )}
      </section>

      {/* 必须由人提供的输入 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-ink">对外地址（只有你知道）</h2>
        <p className="mb-3 text-sm text-ink-muted">
          其余一切（全部密钥、库与账号、内部地址、签名密钥）都由后端自动生成/推导，无需填写。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PUBLIC_URL_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                value={urls[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setUrls((cur) => ({ ...cur, [f.key]: e.target.value }))}
              />
              {urlErrors[f.key] ? <div className="mt-1 text-sm text-danger">{urlErrors[f.key]}</div> : null}
            </Field>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={targets.container}
              onChange={(e) => setTargets((t) => ({ ...t, container: e.target.checked }))}
            />
            容器编排（生成 .env + 签名密钥）
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={targets.baremetal}
              onChange={(e) => setTargets((t) => ({ ...t, baremetal: e.target.checked }))}
            />
            裸金属编排（渲染服务配置）
          </label>
        </div>

        <Collapsible className="mt-4">
          <CollapsibleTrigger>高级（接管外部 MySQL / 覆盖默认值，通常不用填）</CollapsibleTrigger>
          <CollapsibleContent>
            <Inset className="mt-2 space-y-3">
              <Field label="外部 MySQL 管理口令（仅当接管已有 MySQL 时需要；一键拉起则留空自动生成）">
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="留空 = 自动生成并一键拉起"
                />
              </Field>
              <p className="text-sm text-ink-faint">
                库名、应用账号、客户端 id、内部地址等默认值由后端按生态约定推导；如需覆盖请直接调用
                Deployer 的 /api/v1/deploy/bootstrap/run 提交完整输入。
              </p>
            </Inset>
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* 裸金属渲染输出（裸金属目标必给；后端按清单预填，可就地改） */}
      {targets.baremetal ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">裸金属配置渲染输出</h2>
          <p className="mb-3 text-sm text-ink-muted">
            选中裸金属编排时，deploy/config 模板将渲染到下列路径（已存在的文件绝不覆盖）。
            清单在场时后端已按"安装根+配置文件名"预填；也可以填一个根目录批量补齐空行。
          </p>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[320px] flex-1">
              <Field label="输出根目录（批量填充用，例如 /www/wwwroot）">
                <Input
                  value={bmRoot}
                  onChange={(e) => setBmRoot(e.target.value)}
                  placeholder="/www/wwwroot"
                />
              </Field>
            </div>
            <Button variant="outline" size="sm" onClick={fillFromRoot} disabled={!bmRoot.trim()}>
              填充空行
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Object.keys(bmConfigFiles)
              .sort()
              .map((svc) => (
                <Field key={svc} label={`${svc}（${bmConfigFiles[svc] || "config.yaml"}）`}>
                  <Input
                    value={bmOutputs[svc] ?? ""}
                    onChange={(e) =>
                      setBmOutputs((cur) => ({ ...cur, [svc]: e.target.value }))
                    }
                    placeholder={`例如 /www/wwwroot/${svc}/${bmConfigFiles[svc] || "config.yaml"}`}
                  />
                </Field>
              ))}
          </div>
        </section>
      ) : null}

      {/* 操作 */}
      <section className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void doPlan()} disabled={busy !== null}>
          {busy === "plan" ? <Spinner size={14} /> : null}预览（不落盘）
        </Button>
        <Button variant="primary" onClick={() => void doRun()} disabled={busy !== null || running}>
          {busy === "run" || running ? <Spinner size={14} /> : null}
          {running ? "初始化进行中…" : "一键初始化"}
        </Button>
        {run && run.state !== "running" ? (
          <Button variant="outline" onClick={() => void doRun()}>
            重跑（从断点继续）
          </Button>
        ) : null}
      </section>

      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      {fieldErrors.length > 0 ? (
        <Banner tone="danger">
          <div className="font-semibold">以下必填项缺失或不合法，请修正后重试：</div>
          <ul className="mt-1 list-disc pl-5">
            {fieldErrors.map((e) => (
              <li key={e.field}>
                <code>{e.field}</code>：{e.message}
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {/* 预览 */}
      {plan ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">预览（dry-run，未落盘）</h2>
          <Panel>
            <div className="space-y-2">
              {plan.items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge tone={actionTone(item.action)}>{item.action}</Badge>
                  <span className="text-ink-faint">[{item.step}]</span>
                  <span className="text-ink">{item.target}</span>
                  <span className="text-ink-muted">{item.detail}</span>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      {/* 运行进度 */}
      {run ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">
            初始化运行 {run.id}{" "}
            {run.state === "running" ? (
              <Badge tone="info">进行中</Badge>
            ) : run.state === "done" ? (
              <Badge tone="ok">完成</Badge>
            ) : (
              <Badge tone="danger">失败（可重跑续跑）</Badge>
            )}
          </h2>
          <Panel>
            <div className="space-y-3">
              {(run.step_order ?? []).map((name) => {
                const step = run.steps?.[name];
                if (!step) return null;
                return (
                  <div key={name} className="flex items-start gap-2 text-sm">
                    <Badge tone={stepTone(step.status)}>{step.status}</Badge>
                    <span className="font-semibold text-ink">{name}</span>
                    <span className="text-ink-muted">{step.detail}</span>
                  </div>
                );
              })}
            </div>
            {run.notes && run.notes.length > 0 ? (
              <Inset className="mt-3 space-y-1 text-sm text-ink-muted">
                {run.notes.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </Inset>
            ) : null}
            {run.secrets && Object.keys(run.secrets).length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 text-sm font-semibold text-ink">生成的机密值（仅指纹，绝不回显明文）</div>
                <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                  {Object.entries(run.secrets).map(([k, v]) => (
                    <div key={k} className="text-xs text-ink-muted">
                      <code className="text-ink">{k}</code> = {v}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </section>
      ) : null}

      {/* 现状：已生成的机密指纹 */}
      {status && secretEntries.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">当前已生成的机密（指纹）</h2>
          <Panel>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              {secretEntries.map(([k, v]) => (
                <div key={k} className="text-xs text-ink-muted">
                  <code className="text-ink">{k}</code> = {v}
                </div>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
