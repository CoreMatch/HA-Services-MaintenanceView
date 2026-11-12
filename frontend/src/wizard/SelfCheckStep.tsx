import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Inset, Panel, Spinner, type BadgeTone } from "@ha/ui";
import { api, ApiError } from "../api";
import type { DeployPath } from "./state";

// 第 2 步：环境与依赖自检。聚合现有只读端点（healthz / bootstrap status /
// manifests / validate / infra / status），把 503 与探测失败翻译成带
// 可执行下一步的检查项——失败必须指路，不只报错。

type CheckStatus = "ok" | "warn" | "fail";

type CheckItem = {
  name: string;
  status: CheckStatus;
  detail: string;
  nextAction?: string;
};

function statusTone(status: CheckStatus): BadgeTone {
  return status === "ok" ? "ok" : status === "warn" ? "warn" : "danger";
}

const STATUS_LABELS: Record<CheckStatus, string> = { ok: "通过", warn: "警告", fail: "未通过" };

// 常见上游失败 → 人话下一步。匹配不到时回落到通用指引（不吞细节）。
function nextActionFor(message: string): string {
  if (message.includes("orchestration disabled")) {
    return "编辑 Cupbearer 的 config.yaml：设置 orchestration.enabled: true，并配好 scan_roots / tinyvisor.url / credentials_path，然后重启 Cupbearer。配置形状见 Cupbearer README 的 \"Bare-metal orchestration (opt-in)\" 一节。";
  }
  if (message.includes("无法连接") || message.includes("unreachable") || message.includes("connection refused")) {
    return "确认 Cupbearer 进程在运行、本面板配置的 cupbearer.base_url 与其监听地址一致。";
  }
  return "查看错误详情；若涉及配置项，对照 Cupbearer README 与 knowledge/ 目录修正后重点自检。";
}

export default function SelfCheckStep({
  path,
  onResult,
}: {
  path: DeployPath | null;
  onResult: (passed: boolean) => void;
}) {
  const [items, setItems] = useState<CheckItem[] | null>(null);
  const [running, setRunning] = useState(false);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const found: CheckItem[] = [];

    // 1. Cupbearer 可达。
    try {
      await api.cupbearerHealthz();
      found.push({ name: "Cupbearer 可达", status: "ok", detail: "healthz 200" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      found.push({
        name: "Cupbearer 可达",
        status: "fail",
        detail: message,
        nextAction: nextActionFor(message),
      });
      setItems(found);
      setRunning(false);
      onResult(false);
      return;
    }

    // 2. 部署凭据（变更端点 fail-closed 的前提）。
    let stateExists = false;
    try {
      const status = await api.bootstrapStatus();
      stateExists = status.state_exists;
      found.push(
        status.deploy_token_configured
          ? { name: "部署凭据", status: "ok", detail: "deploy token 已配置（变更端点可用）" }
          : {
              name: "部署凭据",
              status: "fail",
              detail: "deploy token 未配置：初始化执行与部署触发都会被拒绝（fail-closed）",
              nextAction:
                "在 Cupbearer 凭据文件（orchestration.credentials_path）写入 deploy_token；新版本首启会自动生成，重启 Cupbearer 即可。",
            }
      );
      const mv = status.maintenance_view;
      found.push({
        name: "运维面板监督",
        status: mv.mode === "managed" || mv.mode === "reused" ? "ok" : "warn",
        detail:
          mv.mode === "managed" || mv.mode === "reused"
            ? `${mv.mode}${mv.address ? `（${mv.address}）` : ""}`
            : `${mv.mode}${mv.detail ? `：${mv.detail}` : ""}`,
        nextAction:
          mv.mode === "unavailable"
            ? "把 MV 二进制放到 Cupbearer 配置指定或相邻位置；独立部署时可忽略本项。"
            : undefined,
      });
    } catch (err) {
      found.push({
        name: "初始化状态",
        status: "fail",
        detail: err instanceof Error ? err.message : String(err),
        nextAction: "bootstrap 层应始终可用；检查 Cupbearer 日志。",
      });
    }

    // 3. 编排是否启用 + 清单装载 + 校验。
    let orchestrationOn = false;
    try {
      const manifests = await api.orchestrationManifests();
      orchestrationOn = true;
      found.push({
        name: "编排已启用",
        status: "ok",
        detail: `orchestration.enabled=true，聚合到 ${manifests.count} 个项目`,
      });
      if (manifests.count === 0) {
        found.push({
          name: "清单在场",
          status: "fail",
          detail: "扫描根下没有任何 deploy-manifest.yaml",
          nextAction:
            "在每个项目仓库根目录创建 deploy-manifest.yaml（schema 位置：Cupbearer internal/manifest 与 knowledge/0002；可参考任一现有仓库的清单）。本向导第 4 步提供骨架生成。",
        });
      } else {
        found.push({ name: "清单在场", status: "ok", detail: `${manifests.count} 个项目清单已装载` });
      }
      if (manifests.errors.length > 0) {
        found.push({
          name: "清单装载错误",
          status: "warn",
          detail: manifests.errors.join("；"),
          nextAction: "装载错误多为个别文件损坏/重名；按错误里的路径处理，重名会按确定性规则取舍。",
        });
      }
      const validation = await api.orchestrationValidation();
      found.push(
        validation.ok
          ? {
              name: "清单校验",
              status: validation.warnings.length > 0 ? "warn" : "ok",
              detail: validation.warnings.length > 0 ? `通过，但有 ${validation.warnings.length} 条警告` : "通过",
            }
          : {
              name: "清单校验",
              status: "fail",
              detail: `${validation.errors.length} 项错误：${validation.errors.slice(0, 3).join("；")}${validation.errors.length > 3 ? "…" : ""}`,
              nextAction:
                "校验失败时 Cupbearer 拒绝一切运行。按分项错误修正清单（schema：Cupbearer knowledge/0002），修完重点自检。本向导第 4 步可查看全部分项错误。",
            }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      found.push({
        name: "编排已启用",
        status: "fail",
        detail: message,
        nextAction: nextActionFor(message),
      });
    }

    // 4. Tinyvisor 可达（裸金属链路必需；容器链路不依赖）。
    if (orchestrationOn) {
      try {
        const status = await api.orchestrationStatus();
        if (path === "container") {
          found.push({
            name: "Tinyvisor（容器链路不依赖）",
            status: status.tinyvisor_reachable ? "ok" : "warn",
            detail: status.tinyvisor_reachable ? "可达（容器链路用不到，仅记录）" : "不可达（容器链路用不到，仅记录）",
          });
        } else {
          found.push(
            status.tinyvisor_reachable
              ? { name: "Tinyvisor 可达", status: "ok", detail: "进程管理链路可用" }
              : {
                  name: "Tinyvisor 可达",
                  status: "fail",
                  detail: "不可达：裸金属部署无法重启进程",
                  nextAction:
                    "在目标机启动 Tinyvisor，并核对 Cupbearer 凭据文件的 tinyvisor_api_key 与 Tinyvisor 配置的 apiKey 一致（两端各一份，必须相同）。",
                }
          );
        }
      } catch (err) {
        found.push({
          name: "项目状态探测",
          status: "warn",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. 基础设施（MySQL/Redis）：缺失不阻断本步——第 3 步可一键拉起。
    try {
      const infra = await api.bootstrapInfra();
      for (const inst of [infra.mysql, infra.redis]) {
        const label = inst.kind === "mysql" ? "MySQL" : "Redis";
        found.push(
          inst.mode === "absent"
            ? {
                name: `${label} 基础设施`,
                status: stateExists ? "warn" : "warn",
                detail: "未检测到",
                nextAction: "下一步（密钥与初始化）可一键拉起；已有外部实例也会在那里接管。",
              }
            : {
                name: `${label} 基础设施`,
                status: inst.healthy ? "ok" : "warn",
                detail: `${inst.mode === "container" ? "受管容器" : "接管复用"}${inst.healthy ? "，健康" : "，未确认健康"}`,
              }
        );
      }
    } catch (err) {
      found.push({
        name: "基础设施探测",
        status: "warn",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    setItems(found);
    setRunning(false);
    onResult(!found.some((item) => item.status === "fail"));
  }, [path, onResult]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          聚合 Cupbearer 只读端点一次查全；失败项都带下一步动作。路径：
          {path === "container" ? "容器" : "裸金属"}。
        </p>
        <Button variant="outline" size="sm" onClick={() => void runChecks()} disabled={running}>
          {running ? <Spinner size={14} /> : null}重新自检
        </Button>
      </div>
      {running && !items ? <Spinner size={20} /> : null}
      {items ? (
        <Panel>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="flex items-start gap-3">
                <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{item.name}</div>
                  <div className="break-words text-sm text-ink-muted">{item.detail}</div>
                  {item.nextAction ? (
                    <Inset className="mt-2 px-4 py-2 text-sm text-ink">
                      <span className="font-semibold text-warn">下一步：</span>
                      {item.nextAction}
                    </Inset>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      {items && items.some((item) => item.status === "fail") ? (
        <Banner tone="warn">
          有未通过项。可以先处理再继续；也可以跳过本步（跳过会留痕），但被拦下的问题会在后面的步骤再次出现。
        </Banner>
      ) : null}
    </div>
  );
}
