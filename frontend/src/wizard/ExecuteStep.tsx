import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Banner, Button, Inset, Panel, Spinner, type BadgeTone } from "@ha/ui";
import { api, ApiError, isDeployable, type DeployManifests, type Run, type UpstreamErrorData } from "../api";
import type { DeployPath } from "./state";

// 第 6 步：执行。裸金属 = 勾选项目触发部署运行（建议先演练）；
// 容器 = 一键触发整栈。运行快照经轮询推进到终态；失败给出分项与
// 可执行建议，不只丢错误码。

const OUTCOME_LABELS: Record<string, string> = {
  pending: "等待中",
  "up-to-date": "已是最新",
  deployed: "已部署",
  "rolled-back": "已回滚",
  reachable: "依赖可达",
  failed: "失败",
  skipped: "跳过",
  foreign: "非管辖(只读)",
  plugin: "插件(只登记)",
  "dry-run": "演练",
};

function outcomeTone(outcome: string): BadgeTone {
  switch (outcome) {
    case "deployed":
    case "rolled-back":
    case "up-to-date":
    case "reachable":
      return "ok";
    case "failed":
      return "danger";
    case "dry-run":
      return "info";
    case "foreign":
    case "skipped":
    case "plugin":
      return "warn";
    default:
      return "neutral";
  }
}

function failureGuidance(data: UpstreamErrorData | undefined, message: string): string {
  if (data?.preflight && data.preflight.blockers.length > 0) {
    return "这是预检阻断：回到上一步看分项与处理方式。";
  }
  if (data?.errors && data.errors.length > 0) {
    return "这是清单校验拒绝：回到第 4 步看分项错误。";
  }
  if (message.includes("run already in progress")) {
    return "已有一次运行在进行：等它结束（运行记录页可见），或到高级界面跟踪。";
  }
  return "修正后重新触发；运行记录会保留本次失败现场。";
}

export default function ExecuteStep({
  path,
  onResult,
}: {
  path: DeployPath | null;
  onResult: (ok: boolean) => void;
}) {
  const [manifests, setManifests] = useState<DeployManifests | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [autoRollback, setAutoRollback] = useState(true);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; data?: UpstreamErrorData; upstream?: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .orchestrationManifests()
      .then(setManifests)
      .catch(() => setManifests(null));
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const deployable = useMemo(
    () => (manifests?.projects ?? []).filter((entry) => isDeployable(entry)),
    [manifests]
  );

  const pollRun = useCallback(
    (id: string) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await api.orchestrationRun(id);
          setRun(r);
          if (r.state !== "running" && pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
            const results = Object.values(r.results ?? {});
            const failed = results.some((res) => res.outcome === "failed");
            onResult(r.state === "done" && !failed);
          }
        } catch (err) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setError({ message: err instanceof Error ? err.message : String(err) });
        }
      }, 2000);
    },
    [onResult]
  );

  async function trigger() {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const started =
        path === "container"
          ? await api.triggerContainerDeploy()
          : await api.triggerDeploy({
              projects: selection.length > 0 ? selection : undefined,
              dry_run: dryRun || undefined,
              auto_rollback_on_fail: autoRollback,
            });
      setRun(started);
      pollRun(started.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, data: err.failure.data, upstream: err.failure.upstream_status });
      } else {
        setError({ message: err instanceof Error ? err.message : String(err) });
      }
      onResult(false);
    } finally {
      setBusy(false);
    }
  }

  const running = run?.state === "running";
  const orderedResults = useMemo(() => {
    if (!run) return [];
    const seen = new Set<string>();
    const ordered: [string, Run["results"][string]][] = [];
    for (const name of run.order ?? []) {
      const result = run.results?.[name];
      if (result) {
        ordered.push([name, result]);
        seen.add(name);
      }
    }
    for (const [name, result] of Object.entries(run.results ?? {})) {
      if (!seen.has(name)) ordered.push([name, result]);
    }
    return ordered;
  }, [run]);

  return (
    <div className="space-y-5">
      {path === "container" ? (
        <Banner tone="info">
          容器路径：Cupbearer 按各项目清单已发布的镜像引用生成 compose override 并执行
          <code> docker compose up -d</code>
          ，结果如实回报为一次 container-trigger 运行。清单缺引用、模板缺服务会记入运行备注，不静默。
        </Banner>
      ) : (
        <section>
          <h3 className="mb-2 text-base font-semibold text-ink">项目范围（不勾选 = 全量）</h3>
          {deployable.length === 0 ? (
            <div className="text-sm text-ink-muted">
              没有可部署的项目（只有 manager=tinyvisor 的 service 项目可部署）。先在第 4 步补齐清单。
            </div>
          ) : (
            <div className="space-y-2">
              {deployable.map((entry) => {
                const checked = selection.includes(entry.project);
                return (
                  <label
                    key={entry.project}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-edge px-4 py-3 hover:bg-raised"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy || running}
                        onChange={() =>
                          setSelection((cur) =>
                            checked ? cur.filter((p) => p !== entry.project) : [...cur, entry.project]
                          )
                        }
                        className="h-4 w-4 accent-[var(--ha-accent)]"
                      />
                      <span className="font-mono text-ink">{entry.project}</span>
                      <span className="text-sm text-ink-faint">{entry.display_name}</span>
                    </span>
                    <span className="font-mono text-sm text-ink-faint">
                      {entry.service_version}
                      {entry.artifact_source ? ` · ${entry.artifact_source}` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-8">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={dryRun}
                disabled={busy || running}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4 accent-[var(--ha-accent)]"
              />
              <span>
                演练模式（dry-run）
                <span className="block text-sm text-ink-faint">只输出计划与预检报告，不落盘不重启——第一次务必先演练</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={autoRollback}
                disabled={busy || running}
                onChange={(e) => setAutoRollback(e.target.checked)}
                className="h-4 w-4 accent-[var(--ha-accent)]"
              />
              <span>
                健康判定失败时自动回滚
                <span className="block text-sm text-ink-faint">默认开启；关闭后失败只记录不回退</span>
              </span>
            </label>
          </div>
        </section>
      )}

      <section>
        <Button variant="primary" onClick={() => void trigger()} disabled={busy || running}>
          {busy || running ? <Spinner size={16} /> : null}
          {running
            ? "运行中…"
            : path === "container"
              ? "一键触发容器栈"
              : dryRun
                ? "开始演练"
                : "开始部署"}
        </Button>
      </section>

      {error ? (
        <Banner tone="danger">
          <div>
            <div className="font-semibold">
              触发被拒绝{error.upstream ? `（上游 HTTP ${error.upstream}）` : ""}
            </div>
            <div className="mt-1">{error.message}</div>
            {error.data?.errors && error.data.errors.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-sm">
                {error.data.errors.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            ) : null}
            {error.data?.preflight ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-sm">
                {error.data.preflight.blockers.map((blocker, index) => (
                  <li key={index}>
                    {blocker.project ? `${blocker.project} · ` : ""}
                    {blocker.name}：{blocker.detail}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 text-sm">{failureGuidance(error.data, error.message)}</div>
          </div>
        </Banner>
      ) : null}

      {run ? (
        <Panel className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-ink">{run.id}</span>
            {run.state === "running" ? (
              <Badge tone="accent">
                <Spinner size={12} /> 运行中
              </Badge>
            ) : run.state === "done" ? (
              <Badge tone="ok">完成</Badge>
            ) : (
              <Badge tone="danger">失败</Badge>
            )}
            {run.options.dry_run ? <Badge tone="info">dry-run</Badge> : null}
          </div>
          {run.notes && run.notes.length > 0 ? (
            <Inset className="mb-3 px-4 py-3 text-sm text-warn">
              {run.notes.map((note, index) => (
                <div key={index}>{note}</div>
              ))}
            </Inset>
          ) : null}
          <div className="space-y-3">
            {orderedResults.map(([name, result]) => (
              <Inset key={name} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-ink">{name}</span>
                  <Badge tone={outcomeTone(result.outcome)}>{OUTCOME_LABELS[result.outcome] ?? result.outcome}</Badge>
                  {result.active_version ? (
                    <span className="font-mono text-sm text-ink-faint">
                      {result.declared_version} → {result.active_version}
                    </span>
                  ) : null}
                </div>
                {result.detail ? <div className="mt-1 font-mono text-sm text-ink-muted">{result.detail}</div> : null}
                {result.steps && result.steps.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {result.steps.map((step, index) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <span className={step.ok ? "text-ok" : "text-danger"}>{step.ok ? "✓" : "✗"}</span>
                        <span className="font-mono text-ink-muted">{step.name}</span>
                        {step.detail ? (
                          <span className="break-all font-mono text-ink-faint">— {step.detail}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </Inset>
            ))}
            {orderedResults.length === 0 && running ? (
              <div className="text-sm text-ink-faint">运行刚启动，尚无逐项结果…</div>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
