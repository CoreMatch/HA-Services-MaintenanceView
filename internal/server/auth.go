package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
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
// 体系。因此"是否配置了 deployer.token"同时决定：登录是否必需、变更
// 代理是否可用。未配置时保持历史行为：免登录（界面显示醒目提示），
// 变更端点 fail-closed。
func (h *Handler) authEnabled() bool {
	return h.cfg.Deployer.Token != ""
}

// authMiddleware 保护 /api/* 中在其后注册的路由。
func (h *Handler) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.authEnabled() {
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
func (h *Handler) SessionStatus(c *gin.Context) {
	authenticated := false
	if h.authEnabled() {
		if id, err := c.Cookie(sessionCookieName); err == nil {
			authenticated = h.sessions.Valid(id)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "session status",
		"data": gin.H{
			"auth_required": h.authEnabled(),
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

	if subtle.ConstantTimeCompare([]byte(input.Token), []byte(h.cfg.Deployer.Token)) != 1 {
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
