import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Banner, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ha/ui";
import { api } from "./api";
import PathStep from "./wizard/PathStep";
import SelfCheckStep from "./wizard/SelfCheckStep";
import BootstrapStep from "./wizard/BootstrapStep";
import SourceStep from "./wizard/SourceStep";
import PreflightStep from "./wizard/PreflightStep";
import ExecuteStep from "./wizard/ExecuteStep";
import HealthStep from "./wizard/HealthStep";
import {
  STEP_META,
  STEP_ORDER,
  clearWizardState,
  defaultWizardState,
  loadWizardState,
  saveWizardState,
  type StepId,
  type WizardState,
} from "./wizard/state";

// 首次使用向导：一条主线把空白环境带到"服务跑起来"。
//   选部署路径 → 环境自检 → 密钥与初始化（复用 Cupbearer bootstrap 的
//   幂等能力）→ 产物来源 → 预检 → 执行 → 健康确认。
// 每步可回退、可跳过（留痕）、能看到"为什么需要这一步"；步骤与人填的
// 输入持久化在 localStorage，刷新/重开断点续跑（后端运行记录的续跑由
// 服务端负责，见 knowledge/0008 与 Cupbearer knowledge/0016）。
// 高级用户直连入口保留在"编排操作"页签，向导不替代它。

export default function WizardView() {
  const [state, setState] = useState<WizardState>(() => loadWizardState());
  const [resumed] = useState(() => {
    const loaded = loadWizardState();
    return loaded.step !== "path" || loaded.path !== null || loaded.skipped.length > 0;
  });
  const [selfCheckPassed, setSelfCheckPassed] = useState<boolean | null>(null);
  const [bootstrapDone, setBootstrapDone] = useState<boolean | null>(null);
  const [preflightPassed, setPreflightPassed] = useState<boolean | null>(null);
  const [executeOk, setExecuteOk] = useState<boolean | null>(null);

  // 持久化：步骤与输入变化即落 localStorage（续跑依据）。
  useEffect(() => {
    saveWizardState(state);
  }, [state]);

  // 重开时若后端已初始化完成，bootstrap 步直接记为已达成。
  useEffect(() => {
    api
      .bootstrapStatus()
      .then((status) => setBootstrapDone(status.state_exists))
      .catch(() => setBootstrapDone(null));
  }, []);

  const stepIndex = STEP_ORDER.indexOf(state.step);

  const patch = useCallback((partial: Partial<WizardState>) => {
    setState((cur) => ({ ...cur, ...partial }));
  }, []);

  function goTo(step: StepId) {
    patch({ step });
  }

  function next() {
    if (stepIndex < STEP_ORDER.length - 1) {
      goTo(STEP_ORDER[stepIndex + 1]);
    }
  }

  function prev() {
    if (stepIndex > 0) {
      goTo(STEP_ORDER[stepIndex - 1]);
    }
  }

  function skip() {
    if (!state.skipped.includes(state.step)) {
      patch({ skipped: [...state.skipped, state.step] });
    }
    next();
  }

  function restart() {
    clearWizardState();
    setState(defaultWizardState());
    setSelfCheckPassed(null);
    setBootstrapDone(null);
    setPreflightPassed(null);
    setExecuteOk(null);
  }

  // 每步的"下一步"门槛：未达成时只能跳过（跳过留痕，问题会在后面再现）。
  const gatePassed = useMemo(() => {
    switch (state.step) {
      case "path":
        return state.path !== null;
      case "selfcheck":
        return selfCheckPassed === true;
      case "bootstrap":
        return bootstrapDone === true;
      case "source":
        return true; // 信息核对步：不强制
      case "preflight":
        return preflightPassed === true;
      case "execute":
        return executeOk === true;
      case "health":
        return true;
      default:
        return false;
    }
  }, [state.step, state.path, selfCheckPassed, bootstrapDone, preflightPassed, executeOk]);

  function stepMark(id: StepId): "done" | "current" | "skipped" | "todo" {
    const idx = STEP_ORDER.indexOf(id);
    if (id === state.step) return "current";
    if (state.skipped.includes(id)) return "skipped";
    if (idx < stepIndex) return "done";
    return "todo";
  }

  const meta = STEP_META[state.step];

  return (
    <div className="space-y-6">
      {resumed ? (
        <Banner tone="info">
          <div>
            已从上次进度恢复（当前步骤：{meta.title}）。后端运行记录本来就是断点续跑的；这里恢复的是你填过的输入与所在步骤。
          </div>
          <Button variant="ghost" size="sm" onClick={restart}>
            重新开始
          </Button>
        </Banner>
      ) : null}

      {/* 步骤条 */}
      <nav className="flex flex-wrap gap-2">
        {STEP_ORDER.map((id, index) => {
          const mark = stepMark(id);
          const tone =
            mark === "current"
              ? "border-accent bg-panel text-ink"
              : mark === "done"
                ? "border-ok/40 text-ok"
                : mark === "skipped"
                  ? "border-warn/40 text-warn"
                  : "border-edge text-ink-faint";
          return (
            <button
              key={id}
              type="button"
              onClick={() => goTo(id)}
              className={`rounded-md border px-4 py-2 text-sm font-semibold transition-colors ${tone}`}
            >
              {index + 1}. {STEP_META[id].title}
              {mark === "skipped" ? "（已跳过）" : ""}
              {mark === "done" ? " ✓" : ""}
            </button>
          );
        })}
      </nav>

      {/* 当前步骤 */}
      <section className="rounded-lg border border-edge bg-panel p-8">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-ink">
            {stepIndex + 1}. {meta.title}
          </h2>
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="text-sm text-ink-faint hover:text-ink">
              为什么需要这一步？
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{meta.why}</p>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {state.step === "path" ? (
          <PathStep path={state.path} onChoose={(path) => patch({ path })} />
        ) : null}
        {state.step === "selfcheck" ? (
          <SelfCheckStep path={state.path} onResult={setSelfCheckPassed} />
        ) : null}
        {state.step === "bootstrap" ? (
          <BootstrapStep
            path={state.path}
            inputs={state.bootstrapInputs}
            onInputsChange={(bootstrapInputs) => patch({ bootstrapInputs })}
            onDone={setBootstrapDone}
          />
        ) : null}
        {state.step === "source" ? <SourceStep path={state.path} /> : null}
        {state.step === "preflight" ? <PreflightStep onResult={setPreflightPassed} /> : null}
        {state.step === "execute" ? <ExecuteStep path={state.path} onResult={setExecuteOk} /> : null}
        {state.step === "health" ? <HealthStep path={state.path} /> : null}
      </section>

      {/* 导航 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={prev} disabled={stepIndex === 0}>
          ← 上一步
        </Button>
        <div className="flex items-center gap-3">
          {state.step !== "path" && state.step !== "health" ? (
            <Button variant="ghost" onClick={skip}>
              跳过这一步
            </Button>
          ) : null}
          {state.step === "health" ? (
            <Button variant="primary" onClick={restart}>
              完成，重新开始向导
            </Button>
          ) : (
            <Button variant="primary" onClick={next} disabled={!gatePassed && !state.skipped.includes(state.step)}>
              下一步 →
            </Button>
          )}
        </div>
      </div>
      {!gatePassed && state.step !== "health" ? (
        <p className="text-right text-sm text-ink-faint">
          本步尚未达成"下一步"条件：达成后按钮亮起；也可以跳过（跳过会留痕，被绕过的问题会在后续步骤再次出现）。
        </p>
      ) : null}

      {state.skipped.length > 0 ? (
        <div className="text-sm text-ink-faint">
          已跳过的步骤：
          {state.skipped.map((id) => (
            <Badge key={id} tone="warn" className="ml-2">
              {STEP_META[id].title}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="text-sm text-ink-faint">
        需要逐项目精细操作（单独回滚、运行历史、请求日志）？切到"编排操作"页签——那是保留的高级直连入口。
      </p>
    </div>
  );
}
