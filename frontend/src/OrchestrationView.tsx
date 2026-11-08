import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  ErrorState,
  Field,
  Inset,
  Input,
  Panel,
  Spinner,
  Stat,
  Table,
  Td,
  Th,
  type BadgeTone,
} from "@ha/ui";
import {
  api,
  ApiError,
  isDeployable,
  managerLabel,
  type ApiFailure,
  type DeployManifestEntry,
  type DeployManifests,
  type DeployProjectStatus,
  type DeployStatusReport,
  type DeployValidation,
  type PreflightReport,
  type Run,
  type RunProjectResult,
  type RunSummary,
} from "./api";

// 编排操作区：项目状态总览、Manifest 校验结果、单次运行逐项进度、
// 部署与回滚入口。所有数据经本进程代理（/api/orchestration/*），
// 部署凭据由服务端持有，浏览器不接触。

const GO_ZERO_TIME = "0001-01-01T00:00:00Z";

function formatTime(value?: string): string {
  if (!value || value === GO_ZERO_TIME) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

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
      return "warn";
    default:
      return "neutral";
  }
}

const OUTCOME_LABELS: Record<string, string> = {
  pending: "等待中",
  "up-to-date": "已是最新",
  deployed: "已部署",
  "rolled-back": "已回滚",
  reachable: "依赖可达",
  failed: "失败",
  skipped: "跳过",
  foreign: "非管辖(只读)",
  "dry-run": "演练",
};

function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

function runStateBadge(state: string) {
  if (state === "running") {
    return (
      <Badge tone="accent">
        <Spinner size={12} /> 运行中
      </Badge>
    );
  }
  if (state === "done") {
    return <Badge tone="ok">完成</Badge>;
  }
  if (state === "failed") {
    return <Badge tone="danger">失败</Badge>;
  }
  return <Badge tone="neutral">{state}</Badge>;
}

function managerBadge(entry: { manager: string; kind?: string; foreign?: boolean }) {
  if (entry.foreign || (entry.kind !== "external" && entry.manager !== "tinyvisor" && entry.manager !== "")) {
    return <Badge tone="warn">非本系统管辖 · {managerLabel(entry.manager, entry.kind)}</Badge>;
  }
  if (entry.kind === "external" || entry.manager === "") {
    return <Badge tone="neutral">外部依赖</Badge>;
  }
  return <Badge tone="accent">{managerLabel(entry.manager, entry.kind)}</Badge>;
}

function failureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ErrorPayload 渲染后端失败响应里的分项内容：校验分项错误（字符串列表）、
// 前置检查报告（阻断项/警告项）、manager 闸门拒绝清单。
function ErrorPayload({ failure }: { failure: ApiFailure }) {
  const data = failure.data;
  const hasErrors = data?.errors && data.errors.length > 0;
  const hasPreflight = Boolean(data?.preflight);
  const hasRejections = data?.rejections && data.rejections.length > 0;
  if (!hasErrors && !hasPreflight && !hasRejections) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3">
      {hasErrors ? (
        <Inset className="px-5 py-4">
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            校验分项错误
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {data!.errors!.map((line, index) => (
              <li key={index} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </Inset>
      ) : null}
      {hasRejections ? (
        <Inset className="px-5 py-4">
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            被拒绝的项目
          </div>
          <ul className="space-y-1 text-sm">
            {data!.rejections!.map((rejection) => (
              <li key={rejection.project}>
                <span className="font-mono text-ink">{rejection.project}</span>
                <span className="text-warn"> — {rejection.reason}</span>
              </li>
            ))}
          </ul>
        </Inset>
      ) : null}
      {hasPreflight ? <PreflightDetails report={data!.preflight!} /> : null}
    </div>
  );
}

function CheckRows({ title, rows, tone }: { title: string; rows: PreflightReport["results"]; tone: "danger" | "warn" }) {
  if (rows.length === 0) {
    return null;
  }
  const toneClass = tone === "danger" ? "text-danger" : "text-warn";
  return (
    <div>
      <div className={`mb-2 text-sm font-semibold uppercase tracking-wide ${toneClass}`}>{title}</div>
      <ul className="space-y-1.5">
        {rows.map((row, index) => (
          <li key={index} className="text-sm leading-relaxed">
            <span className="font-mono text-ink">{row.project ? `${row.project} · ` : ""}{row.name}</span>
            <span className={`block font-mono text-sm ${toneClass}`}>{row.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreflightDetails({ report }: { report: PreflightReport }) {
  return (
    <Inset className="space-y-3 px-5 py-4">
      <div className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
        前置检查报告（{report.mode === "rollback" ? "回滚" : "部署"} · {formatTime(report.checked_at)}
        {report.scope && report.scope.length > 0 ? ` · 范围: ${report.scope.join(", ")}` : " · 全量"}）
      </div>
      <CheckRows title={`阻断项（${report.blockers.length}）`} rows={report.blockers} tone="danger" />
      <CheckRows title={`警告项（${report.warnings.length}）`} rows={report.warnings} tone="warn" />
      {report.blockers.length === 0 && report.warnings.length === 0 ? (
        <div className="text-sm text-ink-faint">所有检查项均通过。</div>
      ) : null}
    </Inset>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <ErrorState message={message} onRetry={onRetry} retryLabel="重试" />;
}

export default function OrchestrationView() {
  const [manifests, setManifests] = useState<DeployManifests | null>(null);
  const [manifestsError, setManifestsError] = useState<string | null>(null);
  const [validation, setValidation] = useState<DeployValidation | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<DeployStatusReport | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<Run | null>(null);
  const [runDetailError, setRunDetailError] = useState<string | null>(null);

  const [deployOpen, setDeployOpen] = useState(false);
  const [deploySelection, setDeploySelection] = useState<string[]>([]);
  const [deployDryRun, setDeployDryRun] = useState(false);
  const [deployAutoRollback, setDeployAutoRollback] = useState(true);

  const [rollbackProject, setRollbackProject] = useState<string | null>(null);
  const [rollbackTo, setRollbackTo] = useState("");
  const [rollbackCascade, setRollbackCascade] = useState(false);

  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerFailure, setTriggerFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadManifests = useCallback(async () => {
    setManifestsError(null);
    try {
      setManifests(await api.orchestrationManifests());
    } catch (err) {
      setManifests(null);
      setManifestsError(failureMessage(err));
    }
  }, []);

  const loadValidation = useCallback(async () => {
    setValidationError(null);
    try {
      setValidation(await api.orchestrationValidation());
    } catch (err) {
      setValidation(null);
      setValidationError(failureMessage(err));
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      setStatus(await api.orchestrationStatus());
    } catch (err) {
      setStatus(null);
      setStatusError(failureMessage(err));
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setRunsError(null);
    try {
      const list = await api.orchestrationRuns();
      setRuns(list.runs ?? []);
    } catch (err) {
      setRuns([]);
      setRunsError(failureMessage(err));
    }
  }, []);

  const loadRunDetail = useCallback(async (id: string) => {
    setRunDetailError(null);
    try {
      const run = await api.orchestrationRun(id);
      setRunDetail(run);
      return run;
    } catch (err) {
      setRunDetail(null);
      setRunDetailError(failureMessage(err));
      return null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadManifests(), loadValidation(), loadStatus(), loadRuns()]);
    setLoading(false);
  }, [loadManifests, loadValidation, loadStatus, loadRuns]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // 运行中的被选中运行：每 2 秒轮询逐项进度，直到终态。
  useEffect(() => {
    if (!selectedRunId || !runDetail || runDetail.state !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void (async () => {
        const run = await loadRunDetail(selectedRunId);
        if (run && run.state !== "running") {
          await loadRuns();
          await loadStatus();
        }
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedRunId, runDetail, loadRunDetail, loadRuns, loadStatus]);

  const deployableProjects = useMemo(() => {
    const entries = manifests?.projects ?? [];
    return entries.filter(isDeployable);
  }, [manifests]);

  const statusByProject = useMemo(() => {
    const map = new Map<string, DeployProjectStatus>();
    for (const project of status?.projects ?? []) {
      if (project.project) {
        map.set(project.project, project);
      }
    }
    return map;
  }, [status]);

  // 操作可用性以 Manifest 声明的 manager 为准——与服务端闸门同源
  //（internal/server/handlers_orchestration.go::gateManagedProjects）。
  // 状态视图里的 manager 是编排器覆盖后的生效值（本地验证上下文可能与
  // 声明值不同），只用于展示，不决定按钮是否可用。
  const manifestByProject = useMemo(() => {
    const map = new Map<string, DeployManifestEntry>();
    for (const entry of manifests?.projects ?? []) {
      map.set(entry.project, entry);
    }
    return map;
  }, [manifests]);

  const isActionable = useCallback(
    (project: string) => {
      const entry = manifestByProject.get(project);
      return entry ? isDeployable(entry) : false;
    },
    [manifestByProject]
  );

  function toggleDeployProject(name: string) {
    setDeploySelection((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    );
  }

  function openDeployDialog() {
    setTriggerFailure(null);
    setDeploySelection([]);
    setDeployDryRun(false);
    setDeployAutoRollback(true);
    setDeployOpen(true);
  }

  function openRollbackDialog(project: string) {
    setTriggerFailure(null);
    setRollbackProject(project);
    setRollbackTo("");
    setRollbackCascade(false);
  }

  async function submitDeploy() {
    setTriggerBusy(true);
    setTriggerFailure(null);
    setNotice(null);
    try {
      const run = await api.triggerDeploy({
        projects: deploySelection.length > 0 ? deploySelection : undefined,
        dry_run: deployDryRun || undefined,
        auto_rollback_on_fail: deployAutoRollback,
      });
      setDeployOpen(false);
      setNotice(
        run.options.dry_run
          ? `演练运行已开始（dry-run，不落盘不重启）：${run.id}`
          : `部署运行已开始：${run.id}`
      );
      setSelectedRunId(run.id);
      setRunDetail(run);
      await loadRuns();
    } catch (err) {
      if (err instanceof ApiError) {
        setTriggerFailure(err.failure);
      } else {
        setTriggerFailure({ status: 0, message: failureMessage(err) });
      }
    } finally {
      setTriggerBusy(false);
    }
  }

  async function submitRollback() {
    if (!rollbackProject) {
      return;
    }
    setTriggerBusy(true);
    setTriggerFailure(null);
    setNotice(null);
    try {
      const run = await api.triggerRollback({
        project: rollbackProject,
        to: rollbackTo.trim(),
        cascade: rollbackCascade,
      });
      setRollbackProject(null);
      setNotice(`回滚运行已开始：${run.id}`);
      setSelectedRunId(run.id);
      setRunDetail(run);
      await loadRuns();
    } catch (err) {
      if (err instanceof ApiError) {
        setTriggerFailure(err.failure);
      } else {
        setTriggerFailure({ status: 0, message: failureMessage(err) });
      }
    } finally {
      setTriggerBusy(false);
    }
  }

  const orderedResults: [string, RunProjectResult][] = useMemo(() => {
    if (!runDetail) {
      return [];
    }
    const seen = new Set<string>();
    const ordered: [string, RunProjectResult][] = [];
    for (const name of runDetail.order ?? []) {
      const result = runDetail.results?.[name];
      if (result) {
        ordered.push([name, result]);
        seen.add(name);
      }
    }
    for (const [name, result] of Object.entries(runDetail.results ?? {})) {
      if (!seen.has(name)) {
        ordered.push([name, result]);
      }
    }
    return ordered;
  }, [runDetail]);

  return (
    <div className="space-y-6">
      {/* 触发失败的分项原因（校验失败 / 前置检查阻断 / manager 闸门拒绝） */}
      {triggerFailure ? (
        <Banner tone="danger">
          <div>
            <div className="font-semibold">
              操作被拒绝{triggerFailure.upstream_status ? `（Deployer HTTP ${triggerFailure.upstream_status}）` : ""}
            </div>
            <div className="mt-1">{triggerFailure.message}</div>
            <ErrorPayload failure={triggerFailure} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTriggerFailure(null)}>
            关闭
          </Button>
        </Banner>
      ) : null}

      {notice ? (
        <Banner tone="ok">
          <div>{notice}</div>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            关闭
          </Button>
        </Banner>
      ) : null}

      {/* 总览 */}
      <Panel className="px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="grid grid-cols-2 gap-x-12 gap-y-4 sm:grid-cols-4">
            <Stat label="项目总数" value={manifests ? manifests.count : "—"} size="hero" />
            <Stat label="可部署项目" value={manifests ? deployableProjects.length : "—"} tone="accent" size="hero" />
            <Stat
              label="Manifest 校验"
              value={validation ? (validation.ok ? "通过" : `${validation.errors.length} 项错误`) : "—"}
              tone={validation ? (validation.ok ? "ok" : "danger") : "default"}
              size="hero"
            />
            <Stat
              label="Tinyvisor"
              value={status ? (status.tinyvisor_reachable ? "可达" : "不可达") : "—"}
              tone={status ? (status.tinyvisor_reachable ? "ok" : "danger") : "default"}
              size="hero"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => void refreshAll()}>
              刷新
            </Button>
            <Button variant="primary" onClick={openDeployDialog}>
              发起部署
            </Button>
          </div>
        </div>
        {status ? (
          <div className="mt-4 text-sm text-ink-faint">状态采集时间：{formatTime(status.generated_at)}</div>
        ) : null}
      </Panel>

      {/* Manifest 校验结果 */}
      <Panel className="px-8 py-6">
        <h2 className="mb-4 text-xl font-bold text-ink">Manifest 校验结果</h2>
        {validationError ? (
          <SectionError message={validationError} onRetry={() => void loadValidation()} />
        ) : !validation ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {validation.ok ? (
              <Banner tone="ok">聚合校验通过，全部清单可被编排器接受。</Banner>
            ) : (
              <Banner tone="danger">
                聚合校验存在 {validation.errors.length} 项错误，Deployer 会拒绝启动任何部署/回滚运行。
              </Banner>
            )}
            {validation.errors.length > 0 ? (
              <Inset className="px-5 py-4">
                <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-danger">
                  分项错误（{validation.errors.length}）
                </div>
                <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-danger">
                  {validation.errors.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </Inset>
            ) : null}
            {validation.warnings.length > 0 ? (
              <Inset className="px-5 py-4">
                <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-warn">
                  警告（{validation.warnings.length}）
                </div>
                <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-warn">
                  {validation.warnings.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </Inset>
            ) : null}
          </div>
        )}

        {/* 聚合 Manifest 清单 */}
        <div className="mt-6">
          {manifestsError ? (
            <SectionError message={manifestsError} onRetry={() => void loadManifests()} />
          ) : !manifests ? (
            <Spinner />
          ) : (
            <>
              {manifests.errors.length > 0 ? (
                <Banner tone="warn" className="mb-3">
                  <div>
                    <div className="font-semibold">清单装载错误（{manifests.errors.length}）</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 font-mono text-sm">
                      {manifests.errors.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </Banner>
              ) : null}
              <Table>
                <thead>
                  <tr>
                    <Th>项目</Th>
                    <Th>分组</Th>
                    <Th>声明版本</Th>
                    <Th>管理归属</Th>
                    <Th>清单来源</Th>
                  </tr>
                </thead>
                <tbody>
                  {manifests.projects.map((entry: DeployManifestEntry) => (
                    <tr key={entry.project}>
                      <Td>
                        <div className="font-semibold text-ink">{entry.display_name || entry.project}</div>
                        <div className="font-mono text-sm text-ink-faint">{entry.project}</div>
                      </Td>
                      <Td>{entry.group || "—"}</Td>
                      <Td className="font-mono">{entry.service_version || "—"}</Td>
                      <Td>{managerBadge(entry)}</Td>
                      <Td className="max-w-72 truncate font-mono text-sm text-ink-faint">{entry.source_path}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </div>
      </Panel>

      {/* 项目状态总览 */}
      <Panel className="px-8 py-6">
        <h2 className="mb-4 text-xl font-bold text-ink">项目状态总览</h2>
        {statusError ? (
          <SectionError message={statusError} onRetry={() => void loadStatus()} />
        ) : !status ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {!status.tinyvisor_reachable ? (
              <Banner tone="danger">
                Tinyvisor 不可达：进程状态与健康探测不可用，部署/回滚运行会被前置检查阻断。
              </Banner>
            ) : null}
            <Table>
              <thead>
                <tr>
                  <Th>项目</Th>
                  <Th>管理归属</Th>
                  <Th>声明版本</Th>
                  <Th>活跃版本</Th>
                  <Th>进程状态</Th>
                  <Th>健康</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {status.projects.map((project) => {
                  const declared = manifestByProject.get(project.project);
                  const actionable = isActionable(project.project);
                  const isExternal = project.kind === "external";
                  const managerDrifted =
                    declared !== undefined &&
                    !isExternal &&
                    declared.manager !== project.manager &&
                    project.manager !== "";
                  return (
                    <tr key={project.project || project.detail}>
                      <Td>
                        <div className="font-semibold text-ink">{project.project || "（校验错误行）"}</div>
                        {project.group ? <div className="text-sm text-ink-faint">{project.group}</div> : null}
                        {project.detail ? (
                          <div className="mt-1 max-w-80 font-mono text-sm text-ink-faint">{project.detail}</div>
                        ) : null}
                      </Td>
                      <Td>
                        {managerBadge(project)}
                        {managerDrifted ? (
                          <div className="mt-1 text-sm text-ink-faint">
                            Manifest 声明：{managerLabel(declared!.manager, declared!.kind)}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="font-mono">{project.declared_version || "—"}</Td>
                      <Td className="font-mono">{project.active_version || "—"}</Td>
                      <Td>{project.tinyvisor_state ? <Badge tone="info">{project.tinyvisor_state}</Badge> : "—"}</Td>
                      <Td>
                        {project.healthy === undefined ? (
                          "—"
                        ) : project.healthy ? (
                          <Badge tone="ok">健康</Badge>
                        ) : (
                          <Badge tone="danger">异常</Badge>
                        )}
                      </Td>
                      <Td>
                        {actionable ? (
                          <Button variant="outline" size="sm" onClick={() => openRollbackDialog(project.project)}>
                            回滚
                          </Button>
                        ) : (
                          <span className="text-sm text-ink-faint">
                            {isExternal
                              ? "外部依赖 · 无部署动作"
                              : declared
                                ? "非本系统管辖 · 不可部署/回滚"
                                : "未在 Manifest 声明"}
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {/* 运行历史与逐项进度 */}
      <Panel className="px-8 py-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">运行记录</h2>
          <Button variant="ghost" size="sm" onClick={() => void loadRuns()}>
            刷新列表
          </Button>
        </div>
        {runsError ? (
          <SectionError message={runsError} onRetry={() => void loadRuns()} />
        ) : runs.length === 0 ? (
          <div className="py-8 text-center text-ink-faint">尚无运行记录。</div>
        ) : (
          <div className="space-y-2">
            {runs.map((summary) => (
              <button
                key={summary.id}
                type="button"
                onClick={() => {
                  setSelectedRunId(summary.id);
                  setRunDetail(null);
                  setRunDetailError(null);
                  void loadRunDetail(summary.id);
                }}
                className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-md border px-5 py-4 text-left transition-colors
                  ${selectedRunId === summary.id ? "border-accent bg-raised" : "border-edge bg-base hover:bg-raised"}`}
              >
                <div className="flex items-center gap-3">
                  {runStateBadge(summary.state)}
                  <Badge tone={summary.type === "rollback" ? "gold" : "neutral"}>
                    {summary.type === "rollback" ? "回滚" : "部署"}
                  </Badge>
                  <span className="font-mono text-sm text-ink">{summary.id}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-ink-faint">
                  <span>
                    {Object.entries(summary.outcomes ?? {})
                      .map(([outcome, count]) => `${outcomeLabel(outcome)}×${count}`)
                      .join(" · ") || "—"}
                  </span>
                  <span>{formatTime(summary.started_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 单次运行逐项进度 */}
        {selectedRunId ? (
          <div className="mt-6 border-t border-edge pt-6">
            {runDetailError ? (
              <SectionError message={runDetailError} onRetry={() => void loadRunDetail(selectedRunId)} />
            ) : !runDetail ? (
              <Spinner />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-ink">{runDetail.id}</span>
                  {runStateBadge(runDetail.state)}
                  <Badge tone={runDetail.type === "rollback" ? "gold" : "neutral"}>
                    {runDetail.type === "rollback" ? "回滚" : "部署"}
                  </Badge>
                  {runDetail.options.dry_run ? <Badge tone="info">dry-run</Badge> : null}
                  <span className="text-sm text-ink-faint">
                    {formatTime(runDetail.started_at)}
                    {runDetail.finished_at ? ` → ${formatTime(runDetail.finished_at)}` : ""}
                  </span>
                </div>

                {runDetail.notes && runDetail.notes.length > 0 ? (
                  <Banner tone="warn">
                    <div>
                      <div className="font-semibold">本次运行的异常事件</div>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                        {runDetail.notes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  </Banner>
                ) : null}

                {runDetail.preflight ? (
                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-faint hover:text-ink">
                      开局前置检查报告（通过放行）
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <PreflightDetails report={runDetail.preflight} />
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}

                <div className="space-y-3">
                  {orderedResults.map(([name, result]) => (
                    <Inset key={name} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-semibold text-ink">{name}</span>
                          <Badge tone={outcomeTone(result.outcome)}>{outcomeLabel(result.outcome)}</Badge>
                          {result.active_version ? (
                            <span className="font-mono text-sm text-ink-faint">
                              {result.declared_version} → {result.active_version}
                            </span>
                          ) : (
                            <span className="font-mono text-sm text-ink-faint">声明 {result.declared_version}</span>
                          )}
                        </div>
                        <span className="text-sm text-ink-faint">
                          {formatTime(result.started_at)}
                          {result.finished_at && result.finished_at !== GO_ZERO_TIME
                            ? ` → ${formatTime(result.finished_at)}`
                            : ""}
                        </span>
                      </div>
                      {result.detail ? (
                        <div className="mt-2 font-mono text-sm text-ink-muted">{result.detail}</div>
                      ) : null}
                      {result.steps && result.steps.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
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
                  {orderedResults.length === 0 ? (
                    <div className="py-4 text-center text-sm text-ink-faint">
                      {runDetail.state === "running" ? "运行刚启动，尚无逐项结果。" : "本次运行没有逐项结果。"}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Panel>

      {/* 部署对话框 */}
      <Dialog
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        title="发起部署"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeployOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void submitDeploy()} disabled={triggerBusy}>
              {triggerBusy ? <Spinner size={16} /> : null}
              {deployDryRun ? "开始演练" : "开始部署"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
              项目范围（不勾选 = 全量部署；仅 Tinyvisor 管理的项目可选）
            </div>
            {manifests && manifests.projects.length > 0 ? (
              <div className="space-y-2">
                {manifests.projects.map((entry) => {
                  const deployable = isDeployable(entry);
                  const checked = deploySelection.includes(entry.project);
                  return (
                    <label
                      key={entry.project}
                      className={`flex items-center justify-between gap-3 rounded-md border border-edge px-4 py-3
                        ${deployable ? "cursor-pointer hover:bg-raised" : "opacity-60"}`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!deployable || triggerBusy}
                          onChange={() => toggleDeployProject(entry.project)}
                          className="h-4 w-4 accent-[var(--ha-accent)]"
                        />
                        <span className="font-mono text-ink">{entry.project}</span>
                        <span className="text-sm text-ink-faint">{entry.display_name}</span>
                      </span>
                      {deployable ? (
                        <span className="font-mono text-sm text-ink-faint">{entry.service_version}</span>
                      ) : (
                        <Badge tone="warn">非本系统管辖 · {managerLabel(entry.manager, entry.kind)}</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-ink-faint">Manifest 清单不可用，无法选择项目范围。</div>
            )}
          </div>

          <div className="flex flex-wrap gap-8">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={deployDryRun}
                disabled={triggerBusy}
                onChange={(event) => setDeployDryRun(event.target.checked)}
                className="h-4 w-4 accent-[var(--ha-accent)]"
              />
              <span>
                演练模式（dry-run）
                <span className="block text-sm text-ink-faint">只输出执行计划，不落盘不重启</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={deployAutoRollback}
                disabled={triggerBusy}
                onChange={(event) => setDeployAutoRollback(event.target.checked)}
                className="h-4 w-4 accent-[var(--ha-accent)]"
              />
              <span>
                健康判定失败时自动回滚
                <span className="block text-sm text-ink-faint">默认开启；关闭后失败只记录不回退</span>
              </span>
            </label>
          </div>
        </div>
      </Dialog>

      {/* 回滚对话框 */}
      <Dialog
        open={rollbackProject !== null}
        onClose={() => setRollbackProject(null)}
        title={`回滚 ${rollbackProject ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRollbackProject(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void submitRollback()} disabled={triggerBusy || !rollbackProject}>
              {triggerBusy ? <Spinner size={16} /> : null}
              开始回滚
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="目标版本（留空 = 自动选上一个非活跃版本）">
            <Input
              value={rollbackTo}
              onChange={(event) => setRollbackTo(event.target.value)}
              placeholder={statusByProject.get(rollbackProject ?? "")?.active_version ? "自动选择上一版本" : "例如 1.8.0"}
              disabled={triggerBusy}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={rollbackCascade}
              disabled={triggerBusy}
              onChange={(event) => setRollbackCascade(event.target.checked)}
              className="h-4 w-4 accent-[var(--ha-accent)]"
            />
            <span>
              级联回滚依赖本项目的项目
              <span className="block text-sm text-ink-faint">
                按依赖拓扑把依赖方一并切回兼容版本（上游语义由 Deployer 解释）
              </span>
            </span>
          </label>
          <Banner tone="warn">
            回滚会把 {rollbackProject} 的活跃版本软链切换到目标版本并重启进程，属于变更操作。
          </Banner>
        </div>
      </Dialog>
    </div>
  );
}
