package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"HA-Services-MaintenanceView/internal/cupbearer"
	"HA-Services-MaintenanceView/internal/models"
	"HA-Services-MaintenanceView/internal/state"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// stubCupbearer 按 HA-Cupbearer 编排端点的实际契约
//（/api/v1/deploy/*，X-Deploy-Token）提供最小实现。
type stubCupbearer struct {
	server             *httptest.Server
	lastDeployToken    string
	lastRollbackToken  string
	lastContainerToken string
	lastPreflightQuery string
	deployReject       int             // 非 0 时 POST run 返回该状态码
	deployRejectData   json.RawMessage // 伴随拒绝响应的 data 段
}

func newStubCupbearer(t *testing.T) *stubCupbearer {
	t.Helper()
	stub := &stubCupbearer{}

	envelope := func(w http.ResponseWriter, data any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"message": "ok",
			"data":    data,
		})
	}

	manifestsData := map[string]any{
		"count": 3,
		"projects": []map[string]any{
			{"project": "mca-server", "kind": "service", "display_name": "MCA Server", "group": "game", "service_version": "1.9.0", "manager": "tinyvisor", "source_path": "/x/mca/deploy-manifest.yaml", "artifact_source": "local_path"},
			{"project": "hrpauth", "kind": "service", "display_name": "HRPAuth", "group": "platform", "service_version": "1.2.0", "manager": "aapanel", "source_path": "/x/hrpauth/deploy-manifest.yaml", "artifact_source": "grail"},
			{"project": "mysql", "kind": "external", "display_name": "MySQL", "group": "infra", "service_version": "8.0", "manager": "", "source_path": "/x/external/mysql.yaml", "artifact_source": ""},
		},
		"errors": []string{},
	}

	runData := map[string]any{
		"id": "run-1", "type": "deploy", "state": "running",
		"order": []string{"mca-server"},
		"results": map[string]any{
			"mca-server": map[string]any{
				"project": "mca-server", "outcome": "pending", "declared_version": "1.9.0",
				"started_at": "2026-11-08T00:00:00Z", "finished_at": "0001-01-01T00:00:00Z",
			},
		},
		"started_at": "2026-11-08T00:00:00Z",
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/deploy/manifests", func(w http.ResponseWriter, r *http.Request) {
		envelope(w, manifestsData)
	})
	mux.HandleFunc("GET /api/v1/deploy/validate", func(w http.ResponseWriter, r *http.Request) {
		envelope(w, map[string]any{
			"ok":       false,
			"errors":   []string{"projects.winnerproxy: health port name not declared"},
			"warnings": []string{"projects.avalon: manifest duplicated, keeping first"},
		})
	})
	mux.HandleFunc("GET /api/v1/deploy/status", func(w http.ResponseWriter, r *http.Request) {
		healthy := true
		envelope(w, map[string]any{
			"generated_at":        "2026-11-08T00:00:00Z",
			"tinyvisor_reachable": true,
			"projects": []map[string]any{
				{
					"project": "mca-server", "kind": "service", "group": "game",
					"manager": "tinyvisor", "foreign": false,
					"declared_version": "1.9.0", "active_version": "1.9.0",
					"tinyvisor_state": "running", "healthy": &healthy,
				},
				{
					"project": "hrpauth", "kind": "service", "group": "platform",
					"manager": "aapanel", "foreign": true,
					"declared_version": "1.2.0",
				},
			},
		})
	})
	mux.HandleFunc("GET /api/v1/deploy/runs", func(w http.ResponseWriter, r *http.Request) {
		envelope(w, map[string]any{"runs": []map[string]any{
			{"id": "run-1", "type": "deploy", "state": "done", "started_at": "2026-11-08T00:00:00Z", "outcomes": map[string]int{"deployed": 1}},
		}})
	})
	mux.HandleFunc("GET /api/v1/deploy/runs/run-1", func(w http.ResponseWriter, r *http.Request) {
		envelope(w, runData)
	})
	mux.HandleFunc("POST /api/v1/deploy/run", func(w http.ResponseWriter, r *http.Request) {
		stub.lastDeployToken = r.Header.Get("X-Deploy-Token")
		if stub.deployReject != 0 {
			w.WriteHeader(stub.deployReject)
			body := map[string]any{"success": false, "message": "rejected by stub"}
			if len(stub.deployRejectData) > 0 {
				body["data"] = json.RawMessage(stub.deployRejectData)
			}
			_ = json.NewEncoder(w).Encode(body)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		envelope(w, runData)
	})
	mux.HandleFunc("POST /api/v1/deploy/rollback", func(w http.ResponseWriter, r *http.Request) {
		stub.lastRollbackToken = r.Header.Get("X-Deploy-Token")
		w.WriteHeader(http.StatusAccepted)
		envelope(w, map[string]any{"id": "run-1-rb", "type": "rollback", "state": "running"})
	})
	mux.HandleFunc("GET /api/v1/deploy/preflight", func(w http.ResponseWriter, r *http.Request) {
		stub.lastPreflightQuery = r.URL.RawQuery
		envelope(w, map[string]any{
			"checked_at": "2026-11-12T00:00:00Z",
			"mode":       "deploy",
			"results":    []any{},
			"blockers":   []any{},
			"warnings":   []any{},
		})
	})
	mux.HandleFunc("POST /api/v1/deploy/container/trigger", func(w http.ResponseWriter, r *http.Request) {
		stub.lastContainerToken = r.Header.Get("X-Deploy-Token")
		w.WriteHeader(http.StatusAccepted)
		envelope(w, map[string]any{"id": "run-1-ct", "type": "container-trigger", "state": "running"})
	})
	mux.HandleFunc("GET /api/v1/healthz", func(w http.ResponseWriter, r *http.Request) {
		envelope(w, map[string]any{"service": "ha-cupbearer"})
	})

	stub.server = httptest.NewServer(mux)
	t.Cleanup(stub.server.Close)
	return stub
}

type testEnv struct {
	router *gin.Engine
	stub   *stubCupbearer
	cfg    *models.Config
}

// newTestEnv 组装 MV 路由。cupbearerToken 为空表示未配置运维身份：
// 免登录 + 变更端点 fail-closed。
func newTestEnv(t *testing.T, cupbearerToken string) *testEnv {
	t.Helper()
	stub := newStubCupbearer(t)

	cfg := models.DefaultConfig()
	cfg.Cupbearer.BaseURL = stub.server.URL
	cfg.Cupbearer.Token = cupbearerToken
	cfg.Server.FrontendDist = t.TempDir()

	requestLog := NewRequestLog()
	client := cupbearer.NewClient(cfg.Cupbearer.BaseURL)
	client.SetToken(cfg.Cupbearer.Token)
	client.SetRecorder(requestLog)

	store := state.NewStore(t.TempDir() + "/projects.json")
	sessions := NewSessionStore()
	router := NewRouter(cfg, client, store, sessions, requestLog)

	return &testEnv{router: router, stub: stub, cfg: cfg}
}

func doJSON(t *testing.T, env *testEnv, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		if cookie != nil {
			req.AddCookie(cookie)
		}
	}
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, req)
	return recorder
}

// login 返回会话 Cookie。
func login(t *testing.T, env *testEnv, token string) *http.Cookie {
	t.Helper()
	recorder := doJSON(t, env, http.MethodPost, "/api/session/login", `{"token":"`+token+`"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", recorder.Code, recorder.Body.String())
	}
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == sessionCookieName {
			return cookie
		}
	}
	t.Fatal("login did not set session cookie")
	return nil
}

func decodeData(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope struct {
		Success bool           `json:"success"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("invalid envelope: %v; body=%s", err, recorder.Body.String())
	}
	return envelope.Data
}

// --- 凭据边界 ---

func TestConfigNeverLeaksTokens(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")

	// 未登录时 /api/config 同样被会话门拒绝。
	recorder := doJSON(t, env, http.MethodGet, "/api/config", "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /api/config status = %d, want 401", recorder.Code)
	}

	cookie := login(t, env, "deploy-secret")
	recorder = doJSON(t, env, http.MethodGet, "/api/config", "", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	body := recorder.Body.String()
	if strings.Contains(body, "deploy-secret") {
		t.Fatalf("config response leaks token material: %s", body)
	}
	data := decodeData(t, recorder)
	cupbearerCfg, _ := data["cupbearer"].(map[string]any)
	if cupbearerCfg["token_configured"] != true {
		t.Fatalf("token_configured should be true, got %v", cupbearerCfg["token_configured"])
	}
	authCfg, _ := data["auth"].(map[string]any)
	if authCfg["enabled"] != true {
		t.Fatalf("auth.enabled should be true, got %v", authCfg["enabled"])
	}
}

func TestDeployFailsClosedWithoutToken(t *testing.T) {
	env := newTestEnv(t, "")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mca-server"]}`)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%s", recorder.Code, recorder.Body.String())
	}
	if env.stub.lastDeployToken != "" {
		t.Fatal("stub should never be reached without a deploy token")
	}
}

// --- 会话鉴权（复用运维身份） ---

func TestAuthDisabledKeepsLegacyOpenBehavior(t *testing.T) {
	env := newTestEnv(t, "")
	recorder := doJSON(t, env, http.MethodGet, "/api/orchestration/status", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with auth disabled", recorder.Code)
	}
}

func TestSessionFlow(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")

	recorder := doJSON(t, env, http.MethodGet, "/api/orchestration/status", "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", recorder.Code)
	}

	recorder = doJSON(t, env, http.MethodPost, "/api/session/login", `{"token":"wrong"}`)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("wrong-token login status = %d, want 401", recorder.Code)
	}

	// 登录验证复用的就是部署凭据（既有运维身份）。
	cookie := login(t, env, "deploy-secret")

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/status", "", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("authenticated status = %d, want 200", recorder.Code)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/session", "", cookie)
	data := decodeData(t, recorder)
	if data["authenticated"] != true || data["auth_required"] != true {
		t.Fatalf("session status = %v", data)
	}

	recorder = doJSON(t, env, http.MethodPost, "/api/session/logout", "", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("logout status = %d", recorder.Code)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/status", "", cookie)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("post-logout status = %d, want 401", recorder.Code)
	}
}

func TestMutatingEndpointsRejectWithoutSession(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	for _, path := range []string{"/api/orchestration/deploy", "/api/orchestration/rollback"} {
		recorder := doJSON(t, env, http.MethodPost, path, `{"projects":["mca-server"]}`)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s without session status = %d, want 401", path, recorder.Code)
		}
	}
	if env.stub.lastDeployToken != "" || env.stub.lastRollbackToken != "" {
		t.Fatal("sessionless mutation must never reach the cupbearer")
	}
}

func TestHealthzAndSessionStatusBypassAuth(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	for _, path := range []string{"/healthz", "/api/healthz", "/api/session"} {
		recorder := doJSON(t, env, http.MethodGet, path, "")
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200 without session", path, recorder.Code)
		}
	}
}

// --- manager 闸门 ---

func TestDeployRejectsPanelManagedProject(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["hrpauth"]}`, cookie)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "非本系统管辖") {
		t.Fatalf("rejection reason missing: %s", recorder.Body.String())
	}
	if env.stub.lastDeployToken != "" {
		t.Fatal("panel-managed project must never reach the cupbearer")
	}
}

func TestDeployRejectsExternalDependency(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mysql"]}`, cookie)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "外部依赖") {
		t.Fatalf("external rejection reason missing: %s", recorder.Body.String())
	}
}

func TestDeployRejectsUndeclaredProject(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["ghost-project"]}`, cookie)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", recorder.Code)
	}
}

func TestDeployForwardsTokenForManagedProject(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mca-server"]}`, cookie)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", recorder.Code, recorder.Body.String())
	}
	if env.stub.lastDeployToken != "deploy-secret" {
		t.Fatalf("deploy token not injected via X-Deploy-Token: %q", env.stub.lastDeployToken)
	}
	data := decodeData(t, recorder)
	if data["id"] != "run-1" {
		t.Fatalf("run snapshot id = %v", data["id"])
	}
}

func TestRollbackGatesAndForwards(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")

	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/rollback", `{"project":"hrpauth"}`, cookie)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("panel-managed rollback status = %d, want 409", recorder.Code)
	}

	recorder = doJSON(t, env, http.MethodPost, "/api/orchestration/rollback", `{"project":"mca-server","to":"1.8.0","cascade":true}`, cookie)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("rollback status = %d, want 202; body=%s", recorder.Code, recorder.Body.String())
	}
	if env.stub.lastRollbackToken != "deploy-secret" {
		t.Fatalf("rollback token not injected: %q", env.stub.lastRollbackToken)
	}

	recorder = doJSON(t, env, http.MethodPost, "/api/orchestration/rollback", `{}`, cookie)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty rollback status = %d, want 400", recorder.Code)
	}
}

func TestPreflightPassthroughScoped(t *testing.T) {
	env := newTestEnv(t, "")

	recorder := doJSON(t, env, http.MethodGet, "/api/orchestration/preflight?projects=mca-server&group=game&evil=1", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	// 白名单重组：只转发 projects/group，其余参数丢弃。
	if env.stub.lastPreflightQuery != "group=game&projects=mca-server" {
		t.Fatalf("forwarded query = %q", env.stub.lastPreflightQuery)
	}
	data := decodeData(t, recorder)
	if data["mode"] != "deploy" {
		t.Fatalf("preflight passthrough missing report: %v", data)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/preflight", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("unscoped status = %d", recorder.Code)
	}
	if env.stub.lastPreflightQuery != "" {
		t.Fatalf("unscoped query = %q, want empty", env.stub.lastPreflightQuery)
	}
}

func TestContainerTriggerForwardsToken(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/container-trigger", "", cookie)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", recorder.Code, recorder.Body.String())
	}
	if env.stub.lastContainerToken != "deploy-secret" {
		t.Fatalf("container trigger token not injected: %q", env.stub.lastContainerToken)
	}
	data := decodeData(t, recorder)
	if data["type"] != "container-trigger" {
		t.Fatalf("run snapshot type = %v", data["type"])
	}
}

func TestContainerTriggerFailsClosedWithoutToken(t *testing.T) {
	env := newTestEnv(t, "")
	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/container-trigger", "")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
	if env.stub.lastContainerToken != "" {
		t.Fatal("stub should never be reached without a deploy token")
	}
}

// --- 只读透传与错误翻译 ---

func TestReadOnlyPassthroughs(t *testing.T) {
	env := newTestEnv(t, "")

	recorder := doJSON(t, env, http.MethodGet, "/api/orchestration/manifest", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("manifest status = %d", recorder.Code)
	}
	data := decodeData(t, recorder)
	projects, _ := data["projects"].([]any)
	if len(projects) != 3 {
		t.Fatalf("manifest passthrough projects = %d", len(projects))
	}
	// 契约 1.5.0：清单视图透传声明的产物来源。
	first, _ := projects[0].(map[string]any)
	if first["artifact_source"] != "local_path" {
		t.Fatalf("artifact_source not passed through: %v", first)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/validation", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("validation status = %d", recorder.Code)
	}
	data = decodeData(t, recorder)
	if data["ok"] != false {
		t.Fatalf("validation.ok = %v, want false", data["ok"])
	}
	errors, _ := data["errors"].([]any)
	if len(errors) != 1 {
		t.Fatalf("validation.errors = %v, want 1 item", errors)
	}
	warnings, _ := data["warnings"].([]any)
	if len(warnings) != 1 {
		t.Fatalf("validation.warnings = %v, want 1 item", warnings)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/runs", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("runs status = %d", recorder.Code)
	}

	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/runs/run-1", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("run detail status = %d", recorder.Code)
	}

	// 空格验证 run id 字符集守卫（^[a-zA-Z0-9_-]+$）。
	recorder = doJSON(t, env, http.MethodGet, "/api/orchestration/runs/bad%20id", "")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid run id status = %d, want 400", recorder.Code)
	}
}

func TestUpstreamAuthFailureIsTranslated(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	env.stub.deployReject = http.StatusUnauthorized

	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mca-server"]}`, cookie)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 passthrough", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "部署凭据缺失或无效") {
		t.Fatalf("translated error missing guidance: %s", recorder.Body.String())
	}
}

// TestUpstreamValidationRefusalKeepsErrors：上游因校验失败拒绝运行（400 +
// data.errors）时，分项错误必须原样透传给界面。
func TestUpstreamValidationRefusalKeepsErrors(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")
	env.stub.deployReject = http.StatusBadRequest
	env.stub.deployRejectData = json.RawMessage(`{"errors":["projects.mca-server: artifact source missing"]}`)

	recorder := doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mca-server"]}`, cookie)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 passthrough", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "projects.mca-server: artifact source missing") {
		t.Fatalf("validation errors not passed through: %s", body)
	}
}

func TestUpstreamUnreachableIs502(t *testing.T) {
	env := newTestEnv(t, "")
	env.stub.server.Close()

	recorder := doJSON(t, env, http.MethodGet, "/api/orchestration/status", "")
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "无法连接 Cupbearer") {
		t.Fatalf("missing readable message: %s", recorder.Body.String())
	}
}

// --- 请求日志 ---

func TestRequestLogRecordsProxiedCalls(t *testing.T) {
	env := newTestEnv(t, "deploy-secret")
	cookie := login(t, env, "deploy-secret")

	_ = doJSON(t, env, http.MethodGet, "/api/orchestration/status", "", cookie)
	_ = doJSON(t, env, http.MethodPost, "/api/orchestration/deploy", `{"projects":["mca-server"]}`, cookie)

	recorder := doJSON(t, env, http.MethodGet, "/api/request-log", "", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("request-log status = %d", recorder.Code)
	}
	data := decodeData(t, recorder)
	entries, _ := data["entries"].([]any)
	if len(entries) < 3 { // status + manifests(gate) + deploy
		t.Fatalf("entries = %d, want >= 3", len(entries))
	}
	newest, _ := entries[0].(map[string]any)
	if newest["method"] != http.MethodPost || newest["path"] != "/api/v1/deploy/run" {
		t.Fatalf("newest entry = %v, want the deploy call", newest)
	}
	body := recorder.Body.String()
	if strings.Contains(body, "deploy-secret") {
		t.Fatalf("request log leaks token material: %s", body)
	}
}

// --- 透传端点不回归 ---

func TestCupbearerHealthzKeepsFullEnvelope(t *testing.T) {
	env := newTestEnv(t, "")
	recorder := doJSON(t, env, http.MethodGet, "/api/cupbearer/healthz", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	data := decodeData(t, recorder)
	if data["success"] != true {
		t.Fatalf("legacy passthrough must keep the full upstream envelope, got %v", data)
	}
}
