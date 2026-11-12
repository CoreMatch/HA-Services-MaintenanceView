package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"HA-Services-MaintenanceView/internal/cupbearer"
	"HA-Services-MaintenanceView/internal/models"
	"HA-Services-MaintenanceView/internal/state"
)

// 代理信任 / 回环免登录 / Cookie Secure 的回归锁。
//
// 背景：gin 默认信任所有代理，Context.ClientIP() 会解析 X-Forwarded-For；
// 若回环免登录直接信 ClientIP()，伪造 XFF: 127.0.0.1 即可免登录直通。
// NewRouter 默认 SetTrustedProxies(nil)（不信任任何代理）堵住该路径；
// 仅当显式配置 server.trusted_proxies 时才解析 XFF。

// newSecurityEnv 组装一个开启回环免登录、配置了运维身份的 MV 路由，
// 允许指定可信代理与 Cookie Secure。
func newSecurityEnv(t *testing.T, trustedProxies []string, cookieSecure bool) *testEnv {
	t.Helper()
	stub := newStubCupbearer(t)

	cfg := models.DefaultConfig()
	cfg.Cupbearer.BaseURL = stub.server.URL
	cfg.Cupbearer.Token = "deploy-secret" // 开启鉴权
	cfg.Server.FrontendDist = t.TempDir()
	cfg.Server.LoopbackSession = true
	cfg.Server.TrustedProxies = trustedProxies
	cfg.Server.CookieSecure = cookieSecure

	requestLog := NewRequestLog()
	client := cupbearer.NewClient(cfg.Cupbearer.BaseURL)
	client.SetToken(cfg.Cupbearer.Token)
	client.SetRecorder(requestLog)

	store := state.NewStore(t.TempDir() + "/projects.json")
	sessions := NewSessionStore()
	router := NewRouter(cfg, client, store, sessions, requestLog)

	return &testEnv{router: router, stub: stub, cfg: cfg}
}

// doReqIP 发起一个可指定直连远端地址与 X-Forwarded-For 的请求。
func doReqIP(t *testing.T, env *testEnv, method, path, remoteAddr, xff string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(""))
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, req)
	return recorder
}

// 未配置可信代理时：伪造 XFF: 127.0.0.1 不得被当作回环，受保护端点仍 401。
func TestXFFSpoofRejectedWithoutTrustedProxies(t *testing.T) {
	env := newSecurityEnv(t, nil, false)

	// 直连远端是公网地址，但伪造 XFF 声称来自回环。
	rec := doReqIP(t, env, http.MethodGet, "/api/orchestration/status", "192.0.2.1:34567", "127.0.0.1")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged X-Forwarded-For must NOT bypass auth: status=%d want 401; body=%s",
			rec.Code, rec.Body.String())
	}

	// 会话状态同样不得把伪造回环当成已认证。
	rec = doReqIP(t, env, http.MethodGet, "/api/session", "192.0.2.1:34567", "127.0.0.1")
	data := decodeData(t, rec)
	if data["auth_required"] != true || data["authenticated"] != false {
		t.Fatalf("spoofed XFF must not authenticate: %v", data)
	}
}

// 真实回环直连仍然免登录（功能不回归）。
func TestRealLoopbackStillTrusted(t *testing.T) {
	env := newSecurityEnv(t, nil, false)

	rec := doReqIP(t, env, http.MethodGet, "/api/orchestration/status", "127.0.0.1:34567", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("genuine loopback must bypass auth: status=%d want 200; body=%s",
			rec.Code, rec.Body.String())
	}
}

// 显式配置可信代理后：来自该代理的 XFF 被解析，回环判定按真实客户端 IP。
func TestTrustedProxyHonorsXFF(t *testing.T) {
	// 只信任直连远端 192.0.2.1（把它当作反代）。
	env := newSecurityEnv(t, []string{"192.0.2.1"}, false)

	// 反代转发真实客户端 127.0.0.1 → 免登录生效。
	rec := doReqIP(t, env, http.MethodGet, "/api/orchestration/status", "192.0.2.1:34567", "127.0.0.1")
	if rec.Code != http.StatusOK {
		t.Fatalf("trusted proxy + loopback client should bypass: status=%d want 200; body=%s",
			rec.Code, rec.Body.String())
	}

	// 反代转发的是公网客户端 → 不再免登录。
	rec = doReqIP(t, env, http.MethodGet, "/api/orchestration/status", "192.0.2.1:34567", "203.0.113.9")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("trusted proxy + public client must require auth: status=%d want 401", rec.Code)
	}
}

// 非可信来源的 XFF 一律忽略（即使配置了可信代理，直连者也不能靠 XFF 伪装）。
func TestUntrustedSourceXFFIgnored(t *testing.T) {
	env := newSecurityEnv(t, []string{"198.51.100.7"}, false) // 信任的是另一个地址

	rec := doReqIP(t, env, http.MethodGet, "/api/orchestration/status", "192.0.2.1:34567", "127.0.0.1")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("XFF from untrusted remote must be ignored: status=%d want 401", rec.Code)
	}
}

// Cookie Secure 位随配置开关。
func TestSessionCookieSecureFlag(t *testing.T) {
	cases := []struct {
		name       string
		secure     bool
		wantSecure bool
	}{
		{"default off for local http", false, false},
		{"on when exposed via https", true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := newSecurityEnv(t, nil, tc.secure)
			rec := doJSON(t, env, http.MethodPost, "/api/session/login", `{"token":"deploy-secret"}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("login failed: %d %s", rec.Code, rec.Body.String())
			}
			var found *http.Cookie
			for _, ck := range rec.Result().Cookies() {
				if ck.Name == sessionCookieName {
					found = ck
				}
			}
			if found == nil {
				t.Fatal("session cookie not set")
			}
			if found.Secure != tc.wantSecure {
				t.Fatalf("cookie Secure=%v want %v", found.Secure, tc.wantSecure)
			}
			if !found.HttpOnly {
				t.Fatal("session cookie must always be HttpOnly")
			}
		})
	}
}
