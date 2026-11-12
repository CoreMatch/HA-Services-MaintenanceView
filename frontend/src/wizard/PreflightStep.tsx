import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Inset, Panel, Spinner } from "@ha/ui";
import { api, type CheckResult, type PreflightReport } from "../api";

// 第 5 步：预检。Cupbearer 的一次性前置检查（分级 blocker/warning）；
// 每个阻断项附"怎么办"，失败不只丢错误码。

// 阻断项名 → 可执行的下一步。未命中的回落到通用指引（detail 本身带
// 具体路径/端口，不吞细节）。
function hintFor(blocker: CheckResult): string {
  const detail = blocker.detail ?? "";
  switch (blocker.name) {
    case "tinyvisor":
      return "确认 Tinyvisor 进程在运行；核对 Cupbearer 凭据文件 tinyvisor_api_key 与 Tinyvisor 配置 apiKey 完全一致；核对 orchestration.tinyvisor.url 地址与端口。";
    case "install-root":
    case "version-dir":
    case "current-link":
    case "workdir":
      return `按报错路径创建目录并保证 Cupbearer 运行用户可写（mkdir -p <路径>），或修正清单 baremetal.install 的声明。涉及路径：${detail}`;
    case "env-file":
      return "容器路径需要 deploy/.env：先完成第 3 步初始化（会合并生成），或手工创建后重试。";
    case "port":
      return "端口被占：停掉占用进程，或修改清单 facts.ports 声明（本地隔离环境可用 Cupbearer 配置 overrides.<项目>.ports 重映射，不改生产清单）。";
    case "disk-space":
      return "磁盘不足：清理空间后重试；detail 里给出了需要的量与所在路径。";
    case "artifact":
      return "产物不在场或校验不过：local_path 先构建二进制并生成 .sha256 旁路文件；grail 先确认 Grail 站点可达且该 release 已发布。回到第 4 步核对来源声明。";
    case "smoke-secrets":
      return "冒烟引用的 ${secret:<name>} 在凭据文件 smoke_secrets 里缺失：补齐后重试（密钥只进凭据文件，不进清单）。";
    case "dependency":
      return "依赖不可达：先把被依赖的服务部署起来（或确认其外部实例在线），再重跑预检。";
    default:
      return "按 detail 中的具体路径/端口/地址处理；修正后点右上角重新预检。";
  }
}

export default function PreflightStep({ onResult }: { onResult: (passed: boolean) => void }) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const runPreflight = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const rep = await api.orchestrationPreflight();
      setReport(rep);
      onResult(rep.blockers.length === 0);
    } catch (err) {
      setReport(null);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onResult(false);
    } finally {
      setRunning(false);
    }
  }, [onResult]);

  useEffect(() => {
    void runPreflight();
  }, [runPreflight]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          部署/回滚开局前的一次性全量检查；阻断项会直接拒绝运行，警告项放行。
        </p>
        <Button variant="outline" size="sm" onClick={() => void runPreflight()} disabled={running}>
          {running ? <Spinner size={14} /> : null}重新预检
        </Button>
      </div>

      {error ? (
        <Banner tone="danger">
          <div>
            <div className="font-semibold">预检不可用</div>
            <div className="mt-1">{error}</div>
            <div className="mt-1 text-sm">
              常见原因：编排未启用（503）或清单校验失败（400）。回到第 2 步自检定位；校验分项错误在第 4 步可读。
            </div>
          </div>
        </Banner>
      ) : null}

      {running && !report ? <Spinner size={20} /> : null}

      {report ? (
        <>
          {report.blockers.length === 0 ? (
            <Banner tone="ok">
              无阻断项{report.warnings.length > 0 ? `，但有 ${report.warnings.length} 条警告（放行，建议看一眼）` : ""}
              ：可以进入执行。
            </Banner>
          ) : (
            <Banner tone="danger">
              {report.blockers.length} 个阻断项：运行会被拒绝。逐项给出了下一步动作，处理后重新预检。
            </Banner>
          )}

          {report.blockers.length > 0 ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-base font-bold text-danger">阻断项（{report.blockers.length}）</h3>
              <div className="space-y-3">
                {report.blockers.map((blocker, index) => (
                  <Inset key={index} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="danger">blocker</Badge>
                      <span className="font-mono font-semibold text-ink">
                        {blocker.project ? `${blocker.project} · ` : ""}
                        {blocker.name}
                      </span>
                    </div>
                    <div className="mt-1 break-words font-mono text-sm text-danger">{blocker.detail}</div>
                    <div className="mt-2 text-sm text-ink">
                      <span className="font-semibold text-warn">怎么办：</span>
                      {hintFor(blocker)}
                    </div>
                  </Inset>
                ))}
              </div>
            </Panel>
          ) : null}

          {report.warnings.length > 0 ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-base font-bold text-warn">警告项（{report.warnings.length}）</h3>
              <div className="space-y-2">
                {report.warnings.map((warning, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <Badge tone="warn">warning</Badge>
                    <span className="font-mono text-ink">
                      {warning.project ? `${warning.project} · ` : ""}
                      {warning.name}
                    </span>
                    <span className="break-words font-mono text-ink-muted">{warning.detail}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {report.blockers.length === 0 && report.warnings.length === 0 ? (
            <Panel className="p-5 text-sm text-ink-muted">全部检查项通过（检查时间 {report.checked_at}）。</Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
