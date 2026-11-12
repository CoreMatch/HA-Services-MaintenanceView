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
} from "../api";
import type { DbPolicy, DeployPath, WizardState } from "./state";

// 第 3 步：密钥与初始化。完全复用 Cupbearer bootstrap 层的幂等能力
//（plan/run，重跑即续跑）——本组件不另写一套。与旧单页表单的区别：
//   - 渲染目标由第 1 步的部署路径单选决定（不再双勾选）；
//   - 人填的输入经向导状态持久化（刷新/重开不丢）；
//   - 既有库/账号冲突的处置（skip/reuse/takeover）在这里显式选择，
//     探测结论与运行结果都可见（契约 1.6.0）。

export type BootstrapInputsState = WizardState["bootstrapInputs"];

// 三种处置的展示定义。默认 skip：最保守——不动任何既有对象；
// 探测不到冲突时该选择不生效（照常创建），所以默认它不会挡住首次初始化。
const DB_POLICIES: {
  id: DbPolicy;
  name: string;
  summary: string;
  destructive: boolean;
}[] = [
  {
    id: "skip",
    name: "跳过（保留现状）",
    summary:
      "不建库、不改账号，databases 步整体不动，只补其余步骤。最保守：不动任何既有对象；探测不到冲突时此选择不生效（照常创建）。",
    destructive: false,
  },
  {
    id: "reuse",
    name: "沿用（不改口令）",
    summary:
      "保留既有账号的口令，你需要提供它的当前口令；验证通过后收编进本次状态继续。不改任何既有对象，但要求你确实掌握现口令。",
    destructive: false,
  },
  {
    id: "takeover",
    name: "接管（改口令）",
    summary:
      "把既有账号的口令改为本次生成的凭据再继续。破坏性最大：依赖该账号既有口令的其他系统会失联，只在确认可以统一改口令时选。",
    destructive: true,
  },
];

type PublicUrlField = {
  key: string;
  label: string;
  // 属于哪个服务 / 什么场景用到 / 本地演练怎么填（向导里逐项展示）。
  service: string;
  usage: string;
  localHint: string;
  // 本机默认值：回环 + 该服务在配置模板里的默认端口。空字段会被预填成它；
  // 人改过/已持久化的值绝不覆盖（另有一键"恢复默认"显式重置）。
  // 留空 = 本机无此默认（显示占位提示，不拿假地址充数）。
  defaultUrl: string;
  placeholder: string;
};

// 六个对外地址的本机默认值，一律 = 回环 + 配置模板默认端口，不编造数字。
// 端口的单一事实源（改动须同步这里与 knowledge/0008 的记载）：
//   HA-Cupbearer/internal/bootstrap/render.go 变量字典 ——
//   HRPAUTH_PORT=2778、YGG_PORT=2770、HASKINPROXY_PORT=2702、
//   WINNERPROXY_PORT=2777、MAINTENANCEVIEW_PORT=2771、WEBUI_PORT=8080；
//   与 HA-Cupbearer/deploy/.env.example、deploy/docker-compose.yml 的默认一致。
// 生产部署把这些换成真实域名（可带反向代理路径，如 YGG 挂在 /yggdrasil-api）。
const PUBLIC_URL_FIELDS: PublicUrlField[] = [
  {
    key: "hrpauth",
    label: "HRPAuth 对外地址",
    service: "HRPAuth（账号 / 认证服务）",
    usage: "OAuth issuer 与令牌签发、各服务经此校验身份",
    localHint: "本机直连 2778 端口",
    defaultUrl: "http://127.0.0.1:2778",
    placeholder: "生产填真实域名，如 https://ha.example.com",
  },
  {
    key: "frontend",
    label: "账号门户前端地址",
    service: "账号门户前端（WebUI，可选）",
    usage: "玩家/用户访问的账号页；OAuth 登录回调落在这里（/oauth/callback）",
    localHint: "本机 WebUI 默认 8080（compose 以 --profile webui 启用）",
    defaultUrl: "http://127.0.0.1:8080",
    placeholder: "生产填真实域名，如 https://auth.example.com",
  },
  {
    key: "ygg",
    label: "Yggdrasil-API 对外地址",
    service: "Yggdrasil-API（YGG，会话 / 中继 API）",
    usage: "客户端 / SDK 访问的会话与中继接口",
    localHint: "本机直连 2770 端口（生产经反代挂域名路径时形如 /yggdrasil-api）",
    defaultUrl: "http://127.0.0.1:2770",
    placeholder: "生产填真实域名，如 https://ha.example.com/yggdrasil-api",
  },
  {
    key: "haskinproxy",
    label: "HASkinProxy 对外地址",
    service: "HASkinProxy（皮肤代理）",
    usage: "皮肤 / 材质资源的对外代理入口",
    localHint: "本机直连 2702 端口",
    defaultUrl: "http://127.0.0.1:2702",
    placeholder: "生产填真实域名，如 https://skin-proxy.example.com",
  },
  {
    key: "winnerproxy",
    label: "WinnerProxy 对外地址",
    service: "WinnerProxy（胜出 / 结果代理）",
    usage: "对外结果与胜出回调代理",
    localHint: "本机直连 2777 端口",
    defaultUrl: "http://127.0.0.1:2777",
    placeholder: "生产填真实域名，如 https://winner-proxy.example.com",
  },
  {
    key: "maintenanceview",
    label: "运维面板对外地址",
    service: "MaintenanceView（本运维面板）",
    usage: "面板自身的对外访问地址（public_base_url）",
    localHint: "模板默认 2771（裸金属生产实测端口，18081 系历史笔误已废）；演练环境按其实际端口填",
    defaultUrl: "http://127.0.0.1:2771",
    placeholder: "生产填真实域名，如 https://maintenance.example.com",
  },
];

// 判定一个对外地址的形态：空 / 非法 / 本机回环（演练）/ 公网域名。
// 回环 + 端口是合法的本地演练形态，与公网域名走不同分支——别让"本地能跑"
// 的人被域名格式校验挡住。
function classifyUrl(value: string): "empty" | "invalid" | "local" | "public" {
  const s = value.trim();
  if (!s) return "empty";
  if (!/^https?:\/\/.+/i.test(s)) return "invalid";
  try {
    const host = new URL(s).hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0") {
      return "local";
    }
    return "public";
  } catch {
    return "invalid";
  }
}

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
    <Panel className="flex-1 min-w-[320px] p-5">
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
      <Inset className="mt-3 space-y-1 px-4 py-3 text-sm text-ink-muted">
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

export default function BootstrapStep({
  path,
  inputs,
  onInputsChange,
  onDone,
}: {
  path: DeployPath | null;
  inputs: BootstrapInputsState;
  onInputsChange: (next: BootstrapInputsState) => void;
  onDone: (done: boolean) => void;
}) {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [infra, setInfra] = useState<BootstrapInfra | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});
  const [policyError, setPolicyError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [plan, setPlan] = useState<BootstrapPlan | null>(null);
  const [run, setRun] = useState<BootstrapRun | null>(null);
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchingMysql, setLaunchingMysql] = useState(false);
  const [launchingRedis, setLaunchingRedis] = useState(false);
  const pollRef = useRef<number | null>(null);

  const targets = useMemo(
    () => ({ container: path === "container", baremetal: path === "baremetal" }),
    [path]
  );

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [st, inf] = await Promise.all([api.bootstrapStatus(), api.bootstrapInfra()]);
      setStatus(st);
      setInfra(inf);
      // 输出路径预填：后端按清单推导优先；已有的人填值不覆盖。
      const files = st.defaults?.config_files ?? {};
      const outputs = st.defaults?.baremetal_outputs ?? {};
      // 对外地址预填：仅对空字段填入本机默认值（回环 + 模板默认端口）；
      // 已持久化 / 人改过的值一律不覆盖。与 bmOutputs 同一次提交，避免
      // 两次 onInputsChange 各自基于旧快照互相覆盖。
      onInputsChange({
        ...inputs,
        bmOutputs: (() => {
          const next = { ...inputs.bmOutputs };
          for (const svc of Object.keys(files)) {
            if (!(svc in next) || !next[svc]) next[svc] = outputs[svc] ?? "";
          }
          return next;
        })(),
        urls: (() => {
          const next = { ...inputs.urls };
          for (const f of PUBLIC_URL_FIELDS) {
            if ((!(f.key in next) || !next[f.key]?.trim()) && f.defaultUrl) {
              next[f.key] = f.defaultUrl;
            }
          }
          return next;
        })(),
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    for (const [svc, outputPath] of Object.entries(inputs.bmOutputs)) {
      if (outputPath.trim()) outputs[svc] = outputPath.trim();
    }
    const urls: Record<string, string> = {};
    for (const f of PUBLIC_URL_FIELDS) {
      urls[f.key] = inputs.urls[f.key] ?? "";
    }
    const infra: Record<string, unknown> = { launch: inputs.launchAllowed };
    if (inputs.mysqlHostPort.trim()) infra.mysql_host_port = Number(inputs.mysqlHostPort.trim());
    if (inputs.redisHostPort.trim()) infra.redis_host_port = Number(inputs.redisHostPort.trim());
    const database: Record<string, unknown> = {};
    if (inputs.adminHost.trim()) database.admin_host = inputs.adminHost.trim();
    if (inputs.adminPort.trim()) database.admin_port = Number(inputs.adminPort.trim());
    if (inputs.adminUser.trim()) database.admin_user = inputs.adminUser.trim();
    if (inputs.adminPassword.trim()) database.admin_password = inputs.adminPassword.trim();
    if (inputs.dbPolicy) database.policy = inputs.dbPolicy;
    if (inputs.dbPolicy === "reuse" && inputs.existingPassword.trim()) {
      database.existing_password = inputs.existingPassword.trim();
    }
    return {
      targets,
      infra,
      database,
      public_urls: urls,
      paths: { baremetal_outputs: outputs },
    };
  }

  // 一键恢复默认：把六个对外地址显式重置为本机默认值（回环 + 模板默认端口）。
  // 与"仅填空"的自动预填不同，这是人的显式动作，会覆盖当前值。
  function restoreDefaultUrls() {
    const next: Record<string, string> = {};
    for (const f of PUBLIC_URL_FIELDS) next[f.key] = f.defaultUrl;
    onInputsChange({ ...inputs, urls: next });
    setUrlErrors({});
  }

  function validateLocally(): boolean {
    const errs: Record<string, string> = {};
    for (const f of PUBLIC_URL_FIELDS) {
      // 回环 + 端口（本地演练）与公网域名都合法，分支不同；只拦空值与非法格式。
      switch (classifyUrl(inputs.urls[f.key] ?? "")) {
        case "empty":
          errs[f.key] = "必填：客户端/玩家要访问这个对外地址，空着服务起不来（本地演练可用已预填的回环地址）";
          break;
        case "invalid":
          errs[f.key] = "需要带协议的完整 URL；本机演练形如 http://127.0.0.1:2778，生产形如 https://ha.example.com";
          break;
        default:
          break; // local / public 均合法
      }
    }
    setUrlErrors(errs);
    setPolicyError(
      inputs.dbPolicy === "reuse" && !inputs.existingPassword.trim()
        ? "选择沿用（reuse）时必须提供既有账号的当前口令"
        : ""
    );
    return Object.keys(errs).length === 0 && !(inputs.dbPolicy === "reuse" && !inputs.existingPassword.trim());
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
      setPlan(await api.bootstrapPlan(buildInputs()));
    } catch (err) {
      const fe = extractFieldErrors(err);
      if (fe.length) setFieldErrors(fe);
      else setActionError(err instanceof Error ? err.message : String(err));
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
          onDone(r.state === "done");
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
      if (fe.length) setFieldErrors(fe);
      else setActionError(err instanceof Error ? err.message : String(err));
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

  function fillFromRoot() {
    const root = inputs.bmRoot.trim().replace(/\/+$/, "");
    if (!root || !status) return;
    const files = status.defaults?.config_files ?? {};
    const next = { ...inputs.bmOutputs };
    for (const [svc, file] of Object.entries(files)) {
      if (!next[svc]?.trim()) {
        next[svc] = `${root}/${svc}/${file || "config.yaml"}`;
      }
    }
    onInputsChange({ ...inputs, bmOutputs: next });
  }

  const running = run?.state === "running";
  const secretEntries = useMemo(() => Object.entries(status?.secrets ?? {}), [status]);
  const configFiles = status?.defaults?.config_files ?? {};

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
          Cupbearer 尚未配置部署凭据（deploy token）：预览可用，但一键执行会被后端拒绝（fail-closed）。
        </Banner>
      ) : null}

      <section>
        <h3 className="mb-2 text-lg font-semibold text-ink">基础设施（MySQL / Redis）</h3>
        <p className="mb-3 text-sm text-ink-muted">
          当前路径为{path === "container" ? "容器" : "裸金属"}
          ：基础设施按所选路径的连接形态使用。已存在就接管复用，不会重复起；缺失时一键拉起并等待真正可用。
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

      <section>
        <h3 className="mb-2 text-lg font-semibold text-ink">既有数据库的处置</h3>
        <p className="mb-3 text-sm text-ink-muted">
          初始化前会先探测目标库与应用账号是否已存在、本次凭据能否验证。只有当"应用账号已存在且口令不一致"
          （例如在这台机器上重新初始化、上次初始化中断后重来）时，下面的选择才生效；探测不到冲突时一律照常创建，
          选什么都不破坏。冲突已探测到而未做选择时，运行会明确失败、不改动任何数据库对象。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {DB_POLICIES.map((option) => {
            const selected = inputs.dbPolicy === option.id;
            return (
              <Panel
                key={option.id}
                className={`cursor-pointer p-5 transition-colors ${selected ? "border-accent" : "hover:bg-raised"}`}
                onClick={() => onInputsChange({ ...inputs, dbPolicy: option.id })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onInputsChange({ ...inputs, dbPolicy: option.id });
                  }
                }}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-block h-4 w-4 rounded-full border ${selected ? "border-accent bg-accent" : "border-edge-strong"}`}
                  />
                  <span className="font-semibold text-ink">{option.name}</span>
                  {selected ? <Badge tone="accent">已选择</Badge> : null}
                  {option.destructive ? <Badge tone="danger">破坏性</Badge> : null}
                </div>
                <p className="text-sm leading-relaxed text-ink-muted">{option.summary}</p>
              </Panel>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-ink-faint">
          默认预选"跳过"的理由：它是唯一不动任何既有对象的选择；首次初始化（无冲突）时它不生效、照常建库，
          所以不会挡住新人，也不会替人做破坏性决定。
        </p>
        {inputs.dbPolicy === "reuse" ? (
          <div className="mt-3 max-w-xl">
            <Field label="既有账号的当前口令（沿用必填；先验证、后收编进状态，绝不回显）">
              <Input
                type="password"
                value={inputs.existingPassword}
                onChange={(e) => onInputsChange({ ...inputs, existingPassword: e.target.value })}
                placeholder="既有应用账号的当前口令"
              />
            </Field>
          </div>
        ) : null}
        {policyError ? <div className="mt-2 text-sm text-danger">{policyError}</div> : null}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink">对外地址（只有你知道）</h3>
          <Button variant="outline" size="sm" onClick={restoreDefaultUrls}>
            恢复默认（回环 + 模板端口）
          </Button>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          其余一切（全部密钥、库与账号、内部地址、签名密钥）都由后端自动生成/推导，无需填写。
          下面六项已预填本机默认值——回环 + 各服务在配置模板里的默认端口（来源：Cupbearer
          deploy/.env.example 与渲染模板，见向导说明）；生产部署请改成真实域名。
          预填只补空字段，你改过的值不会被覆盖；回环 + 端口是合法的本地演练形态。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PUBLIC_URL_FIELDS.map((f) => {
            const kind = classifyUrl(inputs.urls[f.key] ?? "");
            return (
              <Field key={f.key} label={f.label}>
                <Input
                  value={inputs.urls[f.key] ?? ""}
                  placeholder={f.defaultUrl ? f.placeholder : "本机无此默认——不适用可留空，生产按实填写"}
                  onChange={(e) => onInputsChange({ ...inputs, urls: { ...inputs.urls, [f.key]: e.target.value } })}
                />
                <div className="mt-1 text-xs text-ink-faint">
                  {f.service} · {f.usage}
                </div>
                <div className="text-xs text-ink-faint">本地演练：{f.localHint}</div>
                {!urlErrors[f.key] && kind === "local" ? (
                  <div className="mt-1 text-xs text-ink-muted">本地演练地址（回环），生产请换真实域名</div>
                ) : null}
                {urlErrors[f.key] ? <div className="mt-1 text-sm text-danger">{urlErrors[f.key]}</div> : null}
              </Field>
            );
          })}
        </div>

        <Collapsible className="mt-4">
          <CollapsibleTrigger className="text-sm text-ink-muted hover:text-ink">
            高级（接管外部 MySQL / 覆盖默认值，通常不用填）
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Inset className="mt-2 space-y-3 px-4 py-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="MySQL 管理口地址（接管外部实例时填；留空 = 127.0.0.1）">
                  <Input
                    value={inputs.adminHost}
                    onChange={(e) => onInputsChange({ ...inputs, adminHost: e.target.value })}
                    placeholder="127.0.0.1"
                  />
                </Field>
                <Field label="MySQL 管理口端口（留空 = 3306）">
                  <Input
                    value={inputs.adminPort}
                    onChange={(e) => onInputsChange({ ...inputs, adminPort: e.target.value })}
                    placeholder="3306"
                  />
                </Field>
                <Field label="MySQL 管理账号（留空 = root）">
                  <Input
                    value={inputs.adminUser}
                    onChange={(e) => onInputsChange({ ...inputs, adminUser: e.target.value })}
                    placeholder="root"
                  />
                </Field>
                <Field label="MySQL 管理口令（接管已有实例时必填；一键拉起则留空自动生成）">
                  <Input
                    type="password"
                    value={inputs.adminPassword}
                    onChange={(e) => onInputsChange({ ...inputs, adminPassword: e.target.value })}
                    placeholder="留空 = 自动生成并一键拉起"
                  />
                </Field>
                <Field label="MySQL 宿主发布端口（探测/拉起用；留空 = 3306）">
                  <Input
                    value={inputs.mysqlHostPort}
                    onChange={(e) => onInputsChange({ ...inputs, mysqlHostPort: e.target.value })}
                    placeholder="3306"
                  />
                </Field>
                <Field label="Redis 宿主发布端口（探测/接管用；留空 = 6379）">
                  <Input
                    value={inputs.redisHostPort}
                    onChange={(e) => onInputsChange({ ...inputs, redisHostPort: e.target.value })}
                    placeholder="6379"
                  />
                </Field>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={inputs.launchAllowed}
                  onChange={(e) => onInputsChange({ ...inputs, launchAllowed: e.target.checked })}
                  className="h-4 w-4 accent-[var(--ha-accent)]"
                />
                <span>
                  探测不到时允许一键拉起受管容器
                  <span className="block text-sm text-ink-faint">
                    关闭后只接管已有实例：探测不到 MySQL/Redis 会直接报缺，不会新建容器
                  </span>
                </span>
              </label>
              <p className="text-sm text-ink-faint">
                库名、应用账号、客户端 id、内部地址等默认值由后端按生态约定推导；如需覆盖请直接调用
                Cupbearer 的 /api/v1/deploy/bootstrap/run 提交完整输入。
              </p>
            </Inset>
          </CollapsibleContent>
        </Collapsible>
      </section>

      {targets.baremetal ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">裸金属配置渲染输出</h3>
          <p className="mb-3 text-sm text-ink-muted">
            deploy/config 模板将渲染到下列路径（已存在的文件绝不覆盖）。清单在场时后端已按
            "安装根+配置文件名"预填；也可以填一个根目录批量补齐空行。
          </p>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[320px] flex-1">
              <Field label="输出根目录（批量填充用，例如 /www/wwwroot）">
                <Input
                  value={inputs.bmRoot}
                  onChange={(e) => onInputsChange({ ...inputs, bmRoot: e.target.value })}
                  placeholder="/www/wwwroot"
                />
              </Field>
            </div>
            <Button variant="outline" size="sm" onClick={fillFromRoot} disabled={!inputs.bmRoot.trim()}>
              填充空行
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Object.keys(configFiles)
              .sort()
              .map((svc) => (
                <Field key={svc} label={`${svc}（${configFiles[svc] || "config.yaml"}）`}>
                  <Input
                    value={inputs.bmOutputs[svc] ?? ""}
                    onChange={(e) => onInputsChange({ ...inputs, bmOutputs: { ...inputs.bmOutputs, [svc]: e.target.value } })}
                    placeholder={`例如 /www/wwwroot/${svc}/${configFiles[svc] || "config.yaml"}`}
                  />
                </Field>
              ))}
          </div>
        </section>
      ) : null}

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
        <span className="text-sm text-ink-faint">
          当前处置：{DB_POLICIES.find((p) => p.id === inputs.dbPolicy)?.name ?? "未选择"}
          {inputs.dbPolicy === "reuse" ? "（需提供既有口令）" : ""}
        </span>
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

      {plan ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">预览（dry-run，未落盘）</h3>
          <Panel className="p-5">
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

      {run ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">
            初始化运行 {run.id}{" "}
            {run.state === "running" ? (
              <Badge tone="info">进行中</Badge>
            ) : run.state === "done" ? (
              <Badge tone="ok">完成</Badge>
            ) : (
              <Badge tone="danger">失败（可重跑续跑）</Badge>
            )}
          </h3>
          <Panel className="p-5">
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
              <Inset className="mt-3 space-y-1 px-4 py-3 text-sm text-ink-muted">
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

      {status && secretEntries.length > 0 ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">当前已生成的机密（指纹）</h3>
          <Panel className="p-5">
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
