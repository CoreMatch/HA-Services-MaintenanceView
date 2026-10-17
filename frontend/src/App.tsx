import { useEffect, useState, type CSSProperties } from "react";

type ApiState = {
  loading: boolean;
  data: unknown;
  error: string | null;
};

const cardStyle: CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

async function fetchJSON(path: string) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "request failed");
  }
  return data;
}

export default function App() {
  const [config, setConfig] = useState<ApiState>({
    loading: true,
    data: null,
    error: null,
  });
  const [healthz, setHealthz] = useState<ApiState>({
    loading: true,
    data: null,
    error: null,
  });
  const [manifest, setManifest] = useState<ApiState>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    void loadCard("/api/config", setConfig);
    void loadCard("/api/deployer/healthz", setHealthz);
    void loadCard("/api/deployer/manifest", setManifest);
  }

  async function loadCard(path: string, setter: (value: ApiState) => void) {
    setter({ loading: true, data: null, error: null });
    try {
      const data = await fetchJSON(path);
      setter({ loading: false, data, error: null });
    } catch (error) {
      setter({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#0d1117",
        color: "#e6edf3",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, color: "#7d8590" }}>HA Services Maintenance View</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 32 }}>
            WebUI skeleton for service deployment management
          </h1>
        </header>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Current direction</h2>
          <p style={{ lineHeight: 1.6, marginBottom: 0 }}>
            This first version keeps the browser talking to HASMV, while HASMV talks to
            HA-Services-Deployer over HTTP. The next slices can add version diff,
            executable replacement, and bootstrap configuration initialization on top of
            this path.
          </p>
        </section>

        <ApiCard title="HASMV Config" state={config} />
        <ApiCard title="Deployer Health" state={healthz} />
        <ApiCard title="Deployer Manifest" state={manifest} />

        <button
          onClick={() => void loadAll()}
          style={{
            marginTop: 8,
            background: "#238636",
            color: "#fff",
            border: 0,
            padding: "10px 16px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>
    </main>
  );
}

function ApiCard({ title, state }: { title: string; state: ApiState }) {
  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {state.loading ? <p>Loading...</p> : null}
      {state.error ? <p style={{ color: "#ff7b72" }}>{state.error}</p> : null}
      {!state.loading && !state.error ? (
        <pre
          style={{
            background: "#010409",
            borderRadius: 8,
            padding: 16,
            overflowX: "auto",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {JSON.stringify(state.data, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
