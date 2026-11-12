// 首次使用向导的步骤定义与持久化状态。
//
// 设计边界（作者要求）：
//   - 部署路径显式单选：一次部署只走一条路径（裸金属 / 容器）；
//   - 步骤 + 人填的输入全部持久化（localStorage），刷新/重开断点续跑；
//     后端运行记录（bootstrap runs / deploy runs）的续跑由服务端负责，
//     前端只恢复"人这一侧"的状态；
//   - 每步可回退、可跳过（跳过留痕），并附"为什么需要这一步"。

export type DeployPath = "baremetal" | "container";

export type StepId =
  | "path"
  | "selfcheck"
  | "bootstrap"
  | "source"
  | "preflight"
  | "execute"
  | "health";

export const STEP_ORDER: StepId[] = [
  "path",
  "selfcheck",
  "bootstrap",
  "source",
  "preflight",
  "execute",
  "health",
];

export const STEP_META: Record<StepId, { title: string; why: string }> = {
  path: {
    title: "选择部署路径",
    why: "裸金属与容器是两条互斥的链路：裸金属由 Cupbearer 驱动 Tinyvisor 做版本目录+软链切换；容器由 compose 模板承载，Cupbearer 只做一键触发。配置渲染、基础设施连接形态、执行入口都随路径不同，所以必须先选定、且一次部署只走一条。",
  },
  selfcheck: {
    title: "环境与依赖自检",
    why: "部署需要 Cupbearer 编排已启用、清单可装载、Tinyvisor 可达、基础设施在场。这一步把问题一次查全，避免走到后面才逐个踩雷。",
  },
  bootstrap: {
    title: "密钥与初始化",
    why: "平台的全部密钥、数据库、签名密钥与配置渲染由后端幂等生成/推导（Cupbearer bootstrap 层）。这一步之后才有可供服务启动的配置与基础设施；重复运行只补齐缺失项，绝不覆盖已有值。",
  },
  source: {
    title: "产物来源",
    why: "部署 = 把产物放到目标机器上。每个项目在清单里声明产物来源（local_path / ci_release / grail；容器路径为镜像引用）。来源的前置条件不满足时，部署会在预检/执行阶段失败，所以先在这里核对。",
  },
  preflight: {
    title: "预检",
    why: "Cupbearer 在运行开局前把能查的问题一次查全（目录/软链可写、端口占用、Tinyvisor 可达、产物在场、磁盘空间、依赖可达）。阻断项会直接拒绝运行——先看到它们，比点了执行再失败省事。",
  },
  execute: {
    title: "执行",
    why: "真正触发部署：裸金属按项目逐个 产物落盘→版本切换→重启→健康判定；容器路径一键拉起整个栈。建议先演练（dry-run）看一遍计划。",
  },
  health: {
    title: "健康确认",
    why: "部署完成的标志不是'命令返回了'，而是声明版本=活跃版本、进程活着、健康探测通过。这一步给出终局核对，失败的项目会在这里显形。",
  },
};

// 向导持久化状态（人这一侧）；后端运行记录的续跑不依赖它。
export type WizardState = {
  step: StepId;
  path: DeployPath | null;
  skipped: StepId[];
  // bootstrap 步骤的人填输入（刷新不丢）。
  bootstrapInputs: {
    urls: Record<string, string>;
    adminPassword: string;
    bmRoot: string;
    bmOutputs: Record<string, string>;
  };
  updatedAt: string;
};

const STORAGE_KEY = "mv-wizard-state-v1";

export function defaultWizardState(): WizardState {
  return {
    step: "path",
    path: null,
    skipped: [],
    bootstrapInputs: { urls: {}, adminPassword: "", bmRoot: "", bmOutputs: {} },
    updatedAt: new Date().toISOString(),
  };
}

export function loadWizardState(): WizardState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultWizardState();
    }
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    const base = defaultWizardState();
    return {
      ...base,
      ...parsed,
      bootstrapInputs: { ...base.bootstrapInputs, ...(parsed.bootstrapInputs ?? {}) },
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      step: STEP_ORDER.includes(parsed.step as StepId) ? (parsed.step as StepId) : "path",
    };
  } catch {
    return defaultWizardState();
  }
}

export function saveWizardState(state: WizardState): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() })
    );
  } catch {
    // 存储不可用（隐私模式等）：向导仍可用，只是不续跑。不静默吞掉
    // 运行状态——后端记录仍在。
  }
}

export function clearWizardState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上：忽略。
  }
}
