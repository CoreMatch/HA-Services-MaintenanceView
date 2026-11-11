package main

import (
	"log"

	"HA-Services-MaintenanceView/internal/config"
	"HA-Services-MaintenanceView/internal/cupbearer"
	"HA-Services-MaintenanceView/internal/server"
	"HA-Services-MaintenanceView/internal/state"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	requestLog := server.NewRequestLog()

	client := cupbearer.NewClient(cfg.Cupbearer.BaseURL)
	// 部署凭据只存在于服务端：注入出站请求头，绝不出现在日志或响应中。
	client.SetToken(cfg.Cupbearer.Token)
	client.SetRecorder(requestLog)

	store := state.NewStore(cfg.State.ProjectsPath)
	sessions := server.NewSessionStore()
	router := server.NewRouter(cfg, client, store, sessions, requestLog)

	log.Printf("HA Services Maintenance View listening on %s", cfg.Server.Listen)
	if err := router.Run(cfg.Server.Listen); err != nil {
		log.Fatalf("run server: %v", err)
	}
}
