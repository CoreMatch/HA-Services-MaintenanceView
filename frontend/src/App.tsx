import { useEffect, useMemo, useState, type CSSProperties } from "react";

type ProjectArtifact = {
  id: string;
  file_name: string;
  download_path: string;
  download_url: string;
  sha256: string;
  size_bytes: number;
  os?: string;
  arch?: string;
};

type Project = {
  name: string;
  display_name?: string;
  channel?: string;
  version: string;
  published_at?: string;
  deploy_dir?: string;
  port?: number;
  default_port?: number;
  init_supported: boolean;
  config_file_name?: string;
  init_dependencies?: ProjectDependency[];
  artifacts: ProjectArtifact[];
};

type ProjectDependency = {
  name: string;
  fields: string[];
};

type ProjectsResponse = {
  generated_at: string;
  projects: Project[];
};

type PrecheckResult = {
  project_name: string;
  deploy_dir: string;
  artifact_id: string;
  executable_path: string;
  directory_created: boolean;
  directory_mode_before?: string;
  directory_mode_after: string;
  file_exists: boolean;
  file_mode_before?: string;
  file_mode_after?: string;
  message: string;
};

type InitializationChange = {
  field: string;
  value: string;
};

type InitializationResult = {
  project_name: string;
  artifact_id: string;
  deploy_dir: string;
  port: number;
  executable_path: string;
  config_path: string;
  config_generated: boolean;
  changes: InitializationChange[];
  dependency_ports?: Record<string, number>;
  message: string;
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: 24,
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  background: "#0d1117",
  color: "#e6edf3",
};

const cardStyle: CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const buttonStyle: CSSProperties = {
  background: "#238636",
  color: "#fff",
  border: 0,
  padding: "10px 16px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#1f6feb",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #30363d",
  background: "#010409",
  color: "#e6edf3",
  boxSizing: "border-box",
};

async function requestJSON(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "request failed");
  }
  return data;
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [deployDirs, setDeployDirs] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [initializing, setInitializing] = useState<Record<string, boolean>>({});
  const [prechecks, setPrechecks] = useState<Record<string, PrecheckResult>>({});
  const [initializations, setInitializations] = useState<Record<string, InitializationResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, []);

  const projectCountText = useMemo(() => `${projects.length} projects`, [projects.length]);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const response = await requestJSON("/api/projects");
      const payload = response.data as ProjectsResponse;
      setGeneratedAt(payload.generated_at);
      setProjects(payload.projects);
      setDeployDirs(
        Object.fromEntries(payload.projects.map((project) => [project.name, project.deploy_dir || ""]))
      );
      setPorts(
        Object.fromEntries(
          payload.projects.map((project) => [
            project.name,
            String(project.port || project.default_port || ""),
          ])
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveDeployment(project: Project) {
    const deployDir = (deployDirs[project.name] || "").trim();
    const port = Number.parseInt((ports[project.name] || "").trim(), 10);
    if (!deployDir) {
      setNotice(`请先填写 ${project.display_name || project.name} 的部署目录`);
      return;
    }
    if (project.init_supported && (!Number.isInteger(port) || port <= 0)) {
      setNotice(`请先填写 ${project.display_name || project.name} 的服务端口`);
      return;
    }

    setSaving((current) => ({ ...current, [project.name]: true }));
    setNotice(null);
    try {
      await requestJSON(`/api/projects/${project.name}/deployment`, {
        method: "PUT",
        body: JSON.stringify({ deploy_dir: deployDir, port: Number.isInteger(port) ? port : 0 }),
      });
      setNotice(`${project.display_name || project.name} 的部署配置已保存`);
      await loadProjects();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving((current) => ({ ...current, [project.name]: false }));
    }
  }

  async function runPrecheck(project: Project) {
    const artifact = project.artifacts[0];
    if (!artifact) {
      setNotice(`${project.display_name || project.name} 当前没有可用二进制`);
      return;
    }

    setChecking((current) => ({ ...current, [project.name]: true }));
    setNotice(null);
    try {
      const response = await requestJSON(`/api/projects/${project.name}/precheck`, {
        method: "POST",
        body: JSON.stringify({ artifact_id: artifact.id }),
      });
      setPrechecks((current) => ({
        ...current,
        [project.name]: response.data as PrecheckResult,
      }));
      setNotice(`${project.display_name || project.name} 预检查已完成`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking((current) => ({ ...current, [project.name]: false }));
    }
  }

  async function initializeProject(project: Project) {
    const artifact = project.artifacts[0];
    if (!artifact) {
      setNotice(`${project.display_name || project.name} 当前没有可用二进制`);
      return;
    }

    setInitializing((current) => ({ ...current, [project.name]: true }));
    setNotice(null);
    try {
      const response = await requestJSON(`/api/projects/${project.name}/initialize`, {
        method: "POST",
        body: JSON.stringify({ artifact_id: artifact.id }),
      });
      setInitializations((current) => ({
        ...current,
        [project.name]: response.data as InitializationResult,
      }));
      setNotice(`${project.display_name || project.name} 初始化已完成`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setInitializing((current) => ({ ...current, [project.name]: false }));
    }
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, color: "#7d8590" }}>HA Services Maintenance View</p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 32 }}>项目部署与开荒初始化</h1>
          <p style={{ margin: 0, color: "#9da7b3", lineHeight: 1.6 }}>
            WebUI 负责保存每个项目的部署目录和服务端口。初始化时会先执行单文件生成默认
            config，再按你编排的端口自动改写服务之间的调用地址。
          </p>
        </header>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>{projectCountText}</strong>
              <div style={{ color: "#7d8590", marginTop: 6 }}>
                清单生成时间: {generatedAt || "unknown"}
              </div>
            </div>
            <button style={buttonStyle} onClick={() => void loadProjects()}>
              刷新项目列表
            </button>
          </div>
          {notice ? (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 8,
                background: "#111827",
                border: "1px solid #30363d",
              }}
            >
              {notice}
            </div>
          ) : null}
          {error ? (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 8,
                background: "#2d1117",
                border: "1px solid #f85149",
                color: "#ffb4ae",
              }}
            >
              {error}
            </div>
          ) : null}
        </section>

        {loading ? <section style={cardStyle}>Loading...</section> : null}

        {!loading && !error
          ? projects.map((project) => {
              const artifact = project.artifacts[0];
              const precheck = prechecks[project.name];
              const initialization = initializations[project.name];

              return (
                <section key={project.name} style={cardStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h2 style={{ margin: "0 0 8px" }}>{project.display_name || project.name}</h2>
                      <div style={{ color: "#9da7b3", lineHeight: 1.7 }}>
                        <div>项目名: {project.name}</div>
                        <div>版本: {project.version}</div>
                        <div>通道: {project.channel || "default"}</div>
                        <div>发布时间: {project.published_at || "unknown"}</div>
                      </div>
                    </div>

                    <div
                      style={{
                        minWidth: 320,
                        flex: "1 1 420px",
                      }}
                    >
                      <label style={{ display: "block", marginBottom: 8, color: "#9da7b3" }}>
                        部署目录
                      </label>
                      <input
                        value={deployDirs[project.name] || ""}
                        onChange={(event) =>
                          setDeployDirs((current) => ({
                            ...current,
                            [project.name]: event.target.value,
                          }))
                        }
                        placeholder="/www/wwwroot/ha"
                        style={inputStyle}
                      />
                      <label style={{ display: "block", marginTop: 12, marginBottom: 8, color: "#9da7b3" }}>
                        服务端口
                      </label>
                      <input
                        value={ports[project.name] || ""}
                        onChange={(event) =>
                          setPorts((current) => ({
                            ...current,
                            [project.name]: event.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                        placeholder={String(project.default_port || "")}
                        style={inputStyle}
                        inputMode="numeric"
                      />
                      {project.init_supported ? (
                        <div style={{ marginTop: 10, color: "#7d8590", lineHeight: 1.6 }}>
                          <div>初始化配置文件: {project.config_file_name || "config.yaml"}</div>
                          <div>推荐默认端口: {project.default_port || "未定义"}</div>
                          <div>
                            自动联动:
                            {" "}
                            {project.init_dependencies && project.init_dependencies.length > 0
                              ? project.init_dependencies
                                  .map((dependency) => `${dependency.name} (${dependency.fields.join(", ")})`)
                                  .join("；")
                              : "当前服务只改写自己的端口字段"}
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10, color: "#7d8590" }}>当前项目暂未接入自动初始化规则</div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          marginTop: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          style={buttonStyle}
                          onClick={() => void saveDeployment(project)}
                          disabled={Boolean(saving[project.name])}
                        >
                          {saving[project.name] ? "保存中..." : "保存部署配置"}
                        </button>
                        <button
                          style={secondaryButtonStyle}
                          onClick={() => void runPrecheck(project)}
                          disabled={Boolean(checking[project.name])}
                        >
                          {checking[project.name] ? "检查中..." : "预检查并修正权限"}
                        </button>
                        {project.init_supported ? (
                          <button
                            style={{ ...buttonStyle, background: "#8957e5" }}
                            onClick={() => void initializeProject(project)}
                            disabled={Boolean(initializing[project.name])}
                          >
                            {initializing[project.name] ? "初始化中..." : "生成并初始化配置"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ marginTop: 0 }}>当前默认更新制品</h3>
                    {artifact ? (
                      <div
                        style={{
                          background: "#010409",
                          borderRadius: 8,
                          padding: 14,
                          lineHeight: 1.7,
                        }}
                      >
                        <div>文件名: {artifact.file_name}</div>
                        <div>目标平台: {[artifact.os, artifact.arch].filter(Boolean).join(" / ") || "generic"}</div>
                        <div>大小: {formatBytes(artifact.size_bytes)}</div>
                        <div>SHA256: {artifact.sha256}</div>
                        <div>下载路径: {artifact.download_path}</div>
                        <div>
                          下载 URL:{" "}
                          <a href={artifact.download_url} target="_blank" rel="noreferrer">
                            {artifact.download_url}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: "#ffb4ae" }}>当前项目没有可更新二进制</div>
                    )}
                  </div>

                  {precheck ? (
                    <div style={{ marginTop: 20 }}>
                      <h3 style={{ marginTop: 0 }}>最近一次预检查结果</h3>
                      <div
                        style={{
                          background: "#010409",
                          borderRadius: 8,
                          padding: 14,
                          lineHeight: 1.7,
                        }}
                      >
                        <div>部署目录: {precheck.deploy_dir}</div>
                        <div>目标文件: {precheck.executable_path}</div>
                        <div>
                          目录权限: {precheck.directory_mode_before || "new"} -&gt;{" "}
                          {precheck.directory_mode_after}
                        </div>
                        <div>
                          文件权限:{" "}
                          {precheck.file_exists
                            ? `${precheck.file_mode_before || "unknown"} -> ${precheck.file_mode_after || "777"}`
                            : "文件尚不存在，当前只修正了目录权限"}
                        </div>
                        <div>说明: {precheck.message}</div>
                      </div>
                    </div>
                  ) : null}

                  {initialization ? (
                    <div style={{ marginTop: 20 }}>
                      <h3 style={{ marginTop: 0 }}>最近一次初始化结果</h3>
                      <div
                        style={{
                          background: "#010409",
                          borderRadius: 8,
                          padding: 14,
                          lineHeight: 1.7,
                        }}
                      >
                        <div>部署目录: {initialization.deploy_dir}</div>
                        <div>执行文件: {initialization.executable_path}</div>
                        <div>配置文件: {initialization.config_path}</div>
                        <div>当前端口: {initialization.port}</div>
                        <div>
                          默认配置生成: {initialization.config_generated ? "本次已生成" : "已存在，直接改写"}
                        </div>
                        <div>
                          依赖端口:
                          {" "}
                          {initialization.dependency_ports && Object.keys(initialization.dependency_ports).length > 0
                            ? Object.entries(initialization.dependency_ports)
                                .map(([name, port]) => `${name}:${port}`)
                                .join("；")
                            : "无"}
                        </div>
                        <div>说明: {initialization.message}</div>
                        <div style={{ marginTop: 10, color: "#9da7b3" }}>本次写入字段</div>
                        <div style={{ marginTop: 6 }}>
                          {initialization.changes.map((change) => (
                            <div key={`${change.field}:${change.value}`}>
                              {change.field} = {change.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })
          : null}
      </div>
    </main>
  );
}
