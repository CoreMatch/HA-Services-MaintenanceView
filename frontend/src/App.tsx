import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Field, Input, Spinner } from "@ha/ui";
import { api, ApiError, type SessionStatus } from "./api";
import OrchestrationView from "./OrchestrationView";
import WizardView from "./WizardView";

// 会话门：配置了 cupbearer.token 的实例必须先登录（登录校验复用的就是
// 部署凭据本身，面板不另设账号体系）；未配置时保持免登录，界面给出
// 醒目提示，变更端点由后端 fail-closed。

type Tab = "orchestration" | "bootstrap";

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!token.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(token.trim());
      setToken("");
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError && err.failure.status === 401) {
        setError("运维身份校验未通过：请检查输入是否与 Cupbearer 部署凭据一致。");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-edge bg-panel px-8 py-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">HA Services Maintenance View</p>
        <h1 className="mb-2 mt-2 text-2xl font-bold text-ink">操作员登录</h1>
        <p className="mb-6 text-base leading-relaxed text-ink-muted">
          本面板复用既有运维身份：输入 Cupbearer 部署凭据即可登录。凭据只用于这一次校验，
          浏览器之后只持有随机会话，任何响应都不回显凭据。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="部署凭据（部署/回滚共用的运维身份）">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="cupbearer.token"
              autoFocus
            />
          </Field>
          {error ? <div className="mt-3 text-sm text-danger">{error}</div> : null}
          <Button type="submit" variant="primary" className="mt-6 w-full" disabled={busy || !token.trim()}>
            {busy ? <Spinner size={16} /> : null}
            登录
          </Button>
        </form>
      </div>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // 默认落在首次使用向导；熟练用户一步切到"编排操作"直连入口。
  const [tab, setTab] = useState<Tab>("bootstrap");

  const loadSession = useCallback(async () => {
    setSessionError(null);
    try {
      setSession(await api.session());
    } catch (err) {
      setSession(null);
      setSessionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function logout() {
    try {
      await api.logout();
    } finally {
      await loadSession();
    }
  }

  if (sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <Banner tone="danger">
          <div>
            <div className="font-semibold">无法获取会话状态</div>
            <div className="mt-1">{sessionError}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadSession()}>
            重试
          </Button>
        </Banner>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner size={28} />
      </main>
    );
  }

  // 需要登录且无会话：前端整体隐藏，只给登录屏（后端同样拒绝）。
  if (session.auth_required && !session.authenticated) {
    return <LoginScreen onLoggedIn={() => void loadSession()} />;
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
              HA Services Maintenance View
            </p>
            <h1 className="mt-1 text-3xl font-bold text-ink">部署编排操作台</h1>
          </div>
          <div className="flex items-center gap-3">
            {session.auth_required ? (
              <>
                <Badge tone="ok">已登录</Badge>
                <Button variant="ghost" size="sm" onClick={() => void logout()}>
                  退出登录
                </Button>
              </>
            ) : (
              <Badge tone="warn">免登录模式</Badge>
            )}
          </div>
        </header>

        {!session.auth_required ? (
          <Banner tone="warn">
            本实例未配置部署凭据（cupbearer.token）：处于免登录模式，只读视图可用，
            触发部署/回滚会被后端拒绝（503）。
          </Banner>
        ) : null}

        <nav className="flex gap-2 border-b border-edge pb-0">
          {(
            [
              ["bootstrap", "首次使用向导"],
              ["orchestration", "编排操作（高级）"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-t-md border border-b-0 px-6 py-3 text-base font-semibold transition-colors
                ${tab === key ? "border-edge bg-panel text-ink" : "border-transparent text-ink-faint hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "orchestration" ? <OrchestrationView /> : <WizardView />}
      </div>
    </main>
  );
}
