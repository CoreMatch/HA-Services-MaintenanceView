package server

import (
	"sync"
	"time"
)

const requestLogCap = 50

// RequestLogEntry 是一次代理调用的元数据记录。形态对齐
// MatchCoreArena-MaintenanceView knowledge 0008：只记时间/方法/路径/
// 状态码/错误码/成败，绝不记录请求头、凭据或请求体。
type RequestLogEntry struct {
	Time   string `json:"time"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	Code   string `json:"code,omitempty"`
	OK     bool   `json:"ok"`
}

// RequestLog 是进程内环形缓冲（最近 requestLogCap 条）。
// 有意不持久化：它调试的是当前会话，不是历史档案。
type RequestLog struct {
	mu      sync.Mutex
	entries []RequestLogEntry
}

func NewRequestLog() *RequestLog {
	return &RequestLog{}
}

// Record 实现 deployer.RequestRecorder。
func (l *RequestLog) Record(method, path string, status int, code string, ok bool) {
	entry := RequestLogEntry{
		Time:   time.Now().Format("15:04:05"),
		Method: method,
		Path:   path,
		Status: status,
		Code:   code,
		OK:     ok,
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, entry)
	if len(l.entries) > requestLogCap {
		l.entries = l.entries[len(l.entries)-requestLogCap:]
	}
}

// Entries 返回日志（最新在前）。
func (l *RequestLog) Entries() []RequestLogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]RequestLogEntry, 0, len(l.entries))
	for i := len(l.entries) - 1; i >= 0; i-- {
		out = append(out, l.entries[i])
	}
	return out
}
