import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Panel, Spinner, Table, Td, Th } from "@ha/ui";
import { api, managerLabel, type DeployStatusReport } from "../api";
import type { DeployPath } from "./state";

// 第 7 步：健康确认（终局）。部署完成的标志不是命令返回，而是
// 声明版本=活跃版本、进程活着、健康探测通过。失败的项目在这里显形。

export default function HealthStep({ path }: { path: DeployPath | null }) {
  const [status, setStatus] = useState<DeployStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.orchestrationStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !status) {
    return <Spinner size={20} />;
  }

  if (error) {
    return (
      <Banner tone="danger">
        <div>
          <div className="font-semibold">无法读取状态</div>
          <div className="mt-1">{error}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </Banner>
    );
  }

  if (!status) {
    return null;
  }

  const managed = status.projects.filter((p) => !p.foreign && p.manager === "tinyvisor");
  const healthyCount = managed.filter((p) => p.healthy === true).length;
  const versionAligned = managed.filter((p) => p.active_version && p.active_version === p.declared_version).length;
  const allGood = managed.length > 0 && healthyCount === managed.length && versionAligned === managed.length;

  return (
    <div className="space-y-4">
      {managed.length === 0 ? (
        <Banner tone="warn">
          没有 Tinyvisor 管理的项目可确认。{path === "container" ? "容器路径的栈状态以 compose/容器自身为准；本表仅反映 Cupbearer 视角。" : "回到第 4 步检查清单。"}
        </Banner>
      ) : allGood ? (
        <Banner tone="ok">
          终局核对通过：{managed.length} 个受管项目全部 声明版本=活跃版本 且健康探测通过。服务已跑起来。
        </Banner>
      ) : (
        <Banner tone="danger">
          尚未全部就绪：{healthyCount}/{managed.length} 健康，{versionAligned}/{managed.length}
          版本对齐。下面的表指出谁没好；失败项目的运行详情在高级界面（编排操作 → 运行记录）可查。
        </Banner>
      )}

      {!status.tinyvisor_reachable ? (
        <Banner tone="warn">Tinyvisor 当前不可达：进程状态可能过期，健康列为探测结果。</Banner>
      ) : null}

      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>项目</Th>
              <Th>管理归属</Th>
              <Th>声明版本</Th>
              <Th>活跃版本</Th>
              <Th>进程状态</Th>
              <Th>健康</Th>
            </tr>
          </thead>
          <tbody>
            {status.projects.map((project, index) => (
              <tr key={project.project || index}>
                <Td>
                  <div className="font-semibold text-ink">{project.project || "（校验错误行）"}</div>
                  {project.detail ? (
                    <div className="mt-1 max-w-80 font-mono text-sm text-ink-faint">{project.detail}</div>
                  ) : null}
                </Td>
                <Td>
                  <Badge tone={project.foreign ? "warn" : project.manager === "tinyvisor" ? "accent" : "neutral"}>
                    {managerLabel(project.manager, project.kind)}
                  </Badge>
                </Td>
                <Td className="font-mono">{project.declared_version || "—"}</Td>
                <Td className="font-mono">
                  {project.active_version || "—"}
                  {project.active_version && project.active_version !== project.declared_version ? (
                    <Badge className="ml-2" tone="danger">
                      未对齐
                    </Badge>
                  ) : null}
                </Td>
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
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          刷新状态
        </Button>
        <span className="text-sm text-ink-faint">
          冒烟（facts.smoke）结果包含在运行详情的步骤里——冒烟失败 = 部署失败，会自动回滚。
        </span>
      </div>
    </div>
  );
}
