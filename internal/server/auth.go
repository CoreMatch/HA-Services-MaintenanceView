package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	sessionCookieName = "mvs_session"
	sessionTTL        = 12 * time.Hour
)

// SessionStore 是进程内会话表（会话 ID -> 过期时间），滑动过期。
type SessionStore struct {
	mu       sync.Mutex
	sessions map[string]time.Time
	ttl      time.Duration
}

func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: map[string]time.Time{},
		ttl:      sessionTTL,
	}
}

// Create 生成新会话并返回会话 ID。
func (s *SessionStore) Create() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[id] = time.Now().Add(s.ttl)
	return id, nil
}

// Valid 校验会话并滑动续期。
func (s *SessionStore) Valid(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	expires, ok := s.sessions[id]
	if !ok || time.Now().After(expires) {
		delete(s.sessions, id)
		return false
	}
	s.sessions[id] = time.Now().Add(s.ttl)
	return true
}

// Revoke 注销会话。
func (s *SessionStore) Revoke(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

// authEnabled 报告面板会话鉴权是否启用。
// 作者决策：复用既有运维身份（部署凭据）做登录验证，不为面板另起账号
// 体系。因此"是否配置了 cupbearer.token"同时决定：登录是否必需、变更
// 代理是否可用。未配置时保持历史行为：免登录（界面显示醒目提示），
// 变更端点 fail-closed。
func (h *Handler) authEnabled() bool {
	return h.cfg.Cupbearer.Token != ""
}

// loopbackTrusted 报告当前请求是否享受回环免登录：仅当配置开启
// loopback_session（Cupbearer 自启的受管形态）且对端确为回环地址。
// 面板被钉在 127.0.0.1，回环信任等价于本机操作员；部署凭据仍由服务端
// 持有转发，浏览器不接触凭据，安全边界不变。
func (h *Handler) loopbackTrusted(c *gin.Context) bool {
	if !h.cfg.Server.LoopbackSession {
		return false
	}
	ip := net.ParseIP(c.ClientIP())
	return ip != nil && ip.IsLoopback()
}

// authMiddleware 保护 /api/* 中在其后注册的路由。
func (h *Handler) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.authEnabled() || h.loopbackTrusted(c) {
			c.Next()
			return
		}

		id, err := c.Cookie(sessionCookieName)
		if err != nil || !h.sessions.Valid(id) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "authentication required",
			})
			return
		}
		c.Next()
	}
}

// SessionStatus 返回会话状态（只含布尔标志，不含任何凭据）。
// 回环受信形态对浏览器表现为"无需登录"（auth_required=false）。
func (h *Handler) SessionStatus(c *gin.Context) {
	authenticated := false
	required := h.authEnabled()
	if required && h.loopbackTrusted(c) {
		required = false
		authenticated = true
	}
	if h.authEnabled() && !h.loopbackTrusted(c) {
		if id, err := c.Cookie(sessionCookieName); err == nil {
			authenticated = h.sessions.Valid(id)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "session status",
		"data": gin.H{
			"auth_required": required,
			"authenticated": authenticated,
		},
	})
}

// SessionLogin 校验操作员输入的运维身份（部署凭据）并签发会话 Cookie。
// 凭据只用于这一次常量时间比较，之后浏览器仅持有随机会话 ID；
// 任何响应都不回显凭据本身。
func (h *Handler) SessionLogin(c *gin.Context) {
	if !h.authEnabled() {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "authentication is not enabled on this instance",
			"data":    gin.H{"auth_required": false},
		})
		return
	}

	var input struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid login payload",
		})
		return
	}

	if subtle.ConstantTimeCompare([]byte(input.Token), []byte(h.cfg.Cupbearer.Token)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "operator token rejected",
		})
		return
	}

	id, err := h.sessions.Create()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "failed to create session",
		})
		return
	}

	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, id, int(sessionTTL.Seconds()), "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "session established",
		"data":    gin.H{"auth_required": true},
	})
}

// SessionLogout 注销当前会话。
func (h *Handler) SessionLogout(c *gin.Context) {
	if id, err := c.Cookie(sessionCookieName); err == nil {
		h.sessions.Revoke(id)
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "session revoked",
	})
}
