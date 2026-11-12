import { useCallback, useEffect, useMemo, useState } from "react";
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
  Table,
  Td,
  Th,
  type BadgeTone,
} from "@ha/ui";
import { api, managerLabel, type DeployManifests, type DeployValidation } from "../api";
import type { DeployPath } from "./state";

// 第 4 步：产物来源。展示每个项目声明的来源并解释四种来源的前置条件；
// 识别"清单缺位/校验失败"并给出可继续的路径（schema 位置 + 就地生成骨架）。
// 清单是声明式文件、属于各项目仓库——面板不代写仓库文件，骨架供复制落位。

const SOURCE_GUIDE: { source: string; when: string; prereq: string }[] = [
  {
    source: "local_path",
    when: "本机已有构建好的二进制（空白环境起步最常用）",
    prereq:
      "清单 baremetal.artifact.local_path 指向文件本身；同目录必须有同名 .sha256 旁路校验文件（sha256sum 格式）。发布命名约定：<项目名>-linux-amd64 + .sha256。",
  },
  {
    source: "ci_release",
    when: "从 GitHub Release 拉资产（本阶段未启用，仅已实现）",
    prereq: "需要仓库发布 Release 且资产按硬约定命名；凭据文件可配 github_token。",
  },
  {
    source: "grail",
    when: "走 Grail 分发（签名清单 + 摘要流式取件）",
    prereq:
      "Grail 原站/镜像在场并已发布该项目的 release；清单声明 grail: {base_url, project, channel, version, platform}；Cupbearer 凭据文件钉住 Grail 根公钥。",
  },
  {
    source: "容器镜像（容器路径）",
    when: "容器编排：镜像即版本",
    prereq:
      "清单 container 段声明已发布镜像引用（digest 优先：repo@sha256:<manifest list digest>）；模板（deploy/docker-compose.yml）有同名服务。",
  },
];

function sourceTone(source: string): BadgeTone {
  if (!source) return "warn";
  if (source === "local_path" || source === "grail") return "ok";
  if (source === "ci_release") return "info";
  return "neutral";
}

// 依据现有清单的 source_path 推断扫描根（<root>/<repo>/deploy-manifest.yaml
// 的两级父目录），仅用于提示骨架文件该落在哪。
function inferScanRoots(manifests: DeployManifests | null): string[] {
  const roots = new Set<string>();
  for (const entry of manifests?.projects ?? []) {
    if (!entry.source_path) continue;
    const parts = entry.source_path.split("/").filter(Boolean);
    if (parts.length >= 3) {
      roots.add("/" + parts.slice(0, parts.length - 2).join("/"));
    }
  }
  return Array.from(roots).slice(0, 4);
}

function skeletonManifest(input: {
  project: string;
  port: string;
  installRoot: string;
  binary: string;
  localPath: string;
}): string {
  const port = input.port.trim() || "8080";
  const installRoot = input.installRoot.trim() || `/www/wwwroot/${input.project || "service"}`;
  const binary = input.binary.trim() || input.project || "service";
  const localPath =
    input.localPath.trim() || `/path/to/${binary}-linux-amd64`;
  return `# deploy-manifest v1 —— 向导生成的骨架：逐项核对后再使用。
# schema：HA-Cupbearer internal/manifest（knowledge/0002）；
# 参考任一现有项目仓库的 deploy-manifest.yaml。
manifest_version: 1
kind: service
project: ${input.project || "my-service"}
display_name: ${input.project || "My Service"}
group: app
service_version: "0.1.0"

facts:
  ports:
    - name: http
      port: ${port}
      exposure: loopback
  health:
    http:
      port_name: http
      path: /healthz
      expect_status: 200
      timeout_seconds: 5
      interval_seconds: 30
      retries: 3
  depends_on: []
  migration:
    mode: none
  data_dirs:
    - ./data
  config:
    - path: config.yaml
      template_version: "1"

baremetal:
  process:
    manager: tinyvisor
  install:
    root: ${installRoot}
    binary_name: ${binary}
  artifact:
    source: local_path
    local_path: ${localPath}

container:
  enabled: false
`;
}

export default function SourceStep({ path }: { path: DeployPath | null }) {
  const [manifests, setManifests] = useState<DeployManifests | null>(null);
  const [validation, setValidation] = useState<DeployValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [skProject, setSkProject] = useState("");
  const [skPort, setSkPort] = useState("");
  const [skRoot, setSkRoot] = useState("");
  const [skBinary, setSkBinary] = useState("");
  const [skLocalPath, setSkLocalPath] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ms, vd] = await Promise.all([api.orchestrationManifests(), api.orchestrationValidation()]);
      setManifests(ms);
      setValidation(vd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scanRoots = useMemo(() => inferScanRoots(manifests), [manifests]);
  const skeleton = useMemo(
    () =>
      skeletonManifest({ project: skProject, port: skPort, installRoot: skRoot, binary: skBinary, localPath: skLocalPath }),
    [skProject, skPort, skRoot, skBinary, skLocalPath]
  );

  async function copySkeleton() {
    try {
      await navigator.clipboard.writeText(skeleton);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (error) {
    return (
      <Banner tone="danger">
        <div>
          <div className="font-semibold">无法读取清单状态</div>
          <div className="mt-1">{error}</div>
          <div className="mt-1 text-sm">
            若提示 orchestration disabled：先在 Cupbearer config.yaml 启用编排并重启，再回到上一步自检。
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </Banner>
    );
  }

  if (!manifests) {
    return <Spinner size={20} />;
  }

  const missingManifest = manifests.count === 0;
  const invalid = validation !== null && !validation.ok;

  return (
    <div className="space-y-6">
      {(missingManifest || invalid) && (
        <Banner tone={missingManifest ? "danger" : "warn"}>
          <div>
            <div className="font-semibold">
              {missingManifest ? "没有任何项目清单——部署无从谈起" : "清单校验有错误——Cupbearer 会拒绝一切运行"}
            </div>
            <div className="mt-1">
              每个项目仓库根目录需要一份 deploy-manifest.yaml。schema 在 HA-Cupbearer
              <code> internal/manifest</code>（knowledge/0002 有说明），现有仓库的清单就是示例。
              下方骨架生成器可以产出一份起点；把它放到扫描根下的项目目录里：
              {scanRoots.length > 0 ? (
                <code className="ml-1">{scanRoots.join("、")}</code>
              ) : (
                <span className="ml-1">（当前无清单可推断扫描根，见 Cupbearer 配置的 orchestration.scan_roots）</span>
              )}
            </div>
          </div>
        </Banner>
      )}

      <section>
        <h3 className="mb-2 text-lg font-semibold text-ink">已声明的产物来源</h3>
        {manifests.projects.length > 0 ? (
          <Panel>
            <Table>
              <thead>
                <tr>
                  <Th>项目</Th>
                  <Th>管理归属</Th>
                  <Th>产物来源</Th>
                  <Th>清单文件</Th>
                </tr>
              </thead>
              <tbody>
                {manifests.projects.map((entry) => (
                  <tr key={entry.project}>
                    <Td>
                      <div className="font-semibold text-ink">{entry.display_name || entry.project}</div>
                      <div className="font-mono text-sm text-ink-faint">{entry.project}</div>
                    </Td>
                    <Td>
                      <Badge tone={entry.manager === "tinyvisor" ? "accent" : entry.kind === "external" ? "neutral" : "warn"}>
                        {managerLabel(entry.manager, entry.kind)}
                      </Badge>
                    </Td>
                    <Td>
                      {entry.kind === "external" ? (
                        <span className="text-sm text-ink-faint">外部依赖（无产物）</span>
                      ) : entry.kind === "plugin" ? (
                        <span className="text-sm text-ink-faint">插件（另行登记）</span>
                      ) : entry.artifact_source ? (
                        <Badge tone={sourceTone(entry.artifact_source)}>{entry.artifact_source}</Badge>
                      ) : (
                        <Badge tone="warn">未声明</Badge>
                      )}
                    </Td>
                    <Td className="max-w-80 truncate font-mono text-sm text-ink-faint">{entry.source_path}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ) : (
          <div className="text-sm text-ink-muted">尚无清单。用下方骨架生成第一份。</div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-lg font-semibold text-ink">四种来源与各自的前置条件</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {SOURCE_GUIDE.map((guide) => (
            <Inset key={guide.source} className="px-4 py-3">
              <div className="font-semibold text-ink">{guide.source}</div>
              <div className="text-sm text-ink-muted">{guide.when}</div>
              <div className="mt-1 text-sm text-ink-faint">{guide.prereq}</div>
            </Inset>
          ))}
        </div>
        {path === "container" ? (
          <p className="mt-2 text-sm text-ink-faint">
            你选的是容器路径：裸金属产物来源仅供对照，真正需要的是容器镜像引用（最后一张卡）。
          </p>
        ) : null}
      </section>

      {validation && validation.errors.length > 0 ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">校验分项错误（{validation.errors.length}）</h3>
          <Inset className="px-5 py-4">
            <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-danger">
              {validation.errors.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </Inset>
        </section>
      ) : null}

      {validation && validation.warnings.length > 0 ? (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">校验警告（{validation.warnings.length}）</h3>
          <Inset className="px-5 py-4">
            <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-warn">
              {validation.warnings.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </Inset>
        </section>
      ) : null}

      <section>
        <Collapsible>
          <CollapsibleTrigger className="text-base font-semibold text-ink hover:text-accent">
            清单骨架生成器（新项目 / 修正缺字段时用）
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="项目名（仓库目录名）">
                  <Input value={skProject} onChange={(e) => setSkProject(e.target.value)} placeholder="my-service" />
                </Field>
                <Field label="HTTP 端口">
                  <Input value={skPort} onChange={(e) => setSkPort(e.target.value.replace(/[^\d]/g, ""))} placeholder="8080" />
                </Field>
                <Field label="安装根（版本目录的父目录）">
                  <Input value={skRoot} onChange={(e) => setSkRoot(e.target.value)} placeholder="/www/wwwroot/my-service" />
                </Field>
                <Field label="二进制名">
                  <Input value={skBinary} onChange={(e) => setSkBinary(e.target.value)} placeholder="my-service" />
                </Field>
                <Field label="local_path 产物位置（含 .sha256 旁路）">
                  <Input value={skLocalPath} onChange={(e) => setSkLocalPath(e.target.value)} placeholder="/path/to/my-service-linux-amd64" />
                </Field>
              </div>
              <Panel className="p-4">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">{skeleton}</pre>
              </Panel>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => void copySkeleton()}>
                  {copied ? "已复制" : "复制骨架"}
                </Button>
                <span className="text-sm text-ink-faint">
                  落位：&lt;项目仓库根目录&gt;/deploy-manifest.yaml
                  {scanRoots.length > 0 ? `（扫描根：${scanRoots.join("、")}）` : ""}；保存后回到自检步骤复查。
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}
