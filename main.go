package main

import (
	"log"

	"HA-Services-MaintenanceView/internal/config"
	"HA-Services-MaintenanceView/internal/deployer"
	"HA-Services-MaintenanceView/internal/server"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	client := deployer.NewClient(cfg.Deployer.BaseURL)
	router := server.NewRouter(cfg, client)

	log.Printf("HA Services Maintenance View listening on %s", cfg.Server.Listen)
	if err := router.Run(cfg.Server.Listen); err != nil {
		log.Fatalf("run server: %v", err)
	}
}
