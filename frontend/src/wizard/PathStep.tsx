import { Badge, Banner, Inset, Panel } from "@ha/ui";
import type { DeployPath } from "./state";

// 第 1 步：部署路径显式单选。一次部署只走一条路径——选完后向导只渲染
// 对应链路（初始化目标、预检范围、执行入口都随之收窄）。

const PATHS: {
  id: DeployPath;
  name: string;
  summary: string;
  points: string[];
}[] = [
  {
    id: "baremetal",
    name: "裸金属编排",
    summary:
      "Cupbearer 本体：版本目录 + current 软链原子切换，进程归 Tinyvisor 管，健康判定 + 冒烟 + 一键回滚。",
    points: [
      "产物按声明的来源取件（local_path / ci_release / grail）",
      "初始化时渲染各服务的裸金属配置（deploy/config 模板）",
      "部署逐项目执行：落盘 → 切链 → 重启 → 健康 → 冒烟",
      "适合长期运行的单机/多机裸环境",
    ],
  },
  {
    id: "container",
    name: "容器编排",
    summary:
      "compose 模板承载整套接线，Cupbearer 按清单已发布的镜像引用生成 override 并一键 up -d；容器生命周期由 compose 负责。",
    points: [
      "镜像即版本：清单 container 段必须声明已发布镜像引用",
      "初始化时合并 deploy/.env + 生成签名密钥",
      "基础设施经 ha-infra 网络以服务名连接（mysql:3306 形态）",
      "适合容器化环境；回滚按镜像 digest 钉死",
    ],
  },
];

export default function PathStep({
  path,
  onChoose,
}: {
  path: DeployPath | null;
  onChoose: (path: DeployPath) => void;
}) {
  return (
    <div className="space-y-4">
      <Banner tone="info">
        两条链路互斥：配置渲染形态、基础设施连接方式、执行入口都不同。选定后本向导只渲染该链路；
        之后随时可回到这一步改选（已完成的初始化不会被破坏——它是幂等的）。
      </Banner>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PATHS.map((option) => {
          const selected = path === option.id;
          return (
            <Panel
              key={option.id}
              className={`cursor-pointer p-6 transition-colors ${selected ? "border-accent" : "hover:bg-raised"}`}
              onClick={() => onChoose(option.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChoose(option.id);
                }
              }}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
            >
              <div className="mb-2 flex items-center gap-3">
                <span
                  className={`inline-block h-4 w-4 rounded-full border ${selected ? "border-accent bg-accent" : "border-edge-strong"}`}
                />
                <span className="text-lg font-bold text-ink">{option.name}</span>
                {selected ? <Badge tone="accent">已选择</Badge> : null}
              </div>
              <p className="mb-3 text-base leading-relaxed text-ink-muted">{option.summary}</p>
              <Inset className="px-4 py-3">
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  {option.points.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </Inset>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
