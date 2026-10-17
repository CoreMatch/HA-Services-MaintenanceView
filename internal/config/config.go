package config

import (
	"log"
	"os"

	"HA-Services-MaintenanceView/internal/models"

	"github.com/goccy/go-yaml"
)

func Load(path string) (*models.Config, error) {
	// 1. Load default config
	cfg := models.DefaultConfig()

	// 2. If file doesn't exist, save default and return
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Config file %s not found, creating with defaults", path)
			if err := Save(path, cfg); err != nil {
				return nil, err
			}
			return cfg, nil
		}
		return nil, err
	}

	// 3. Parse as map for migration
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	// 4. Perform migration
	oldVersion, _ := raw["version"].(string)
	if oldVersion == "" {
		oldVersion = "0"
	}

	migrated, changed, err := MigrateConfig(raw)
	if err != nil {
		return nil, err
	}

	if changed {
		// Backup old file
		if err := BackupConfigFile(path, oldVersion); err != nil {
			log.Printf("Warning: failed to backup config: %v", err)
		}

		// Save migrated config
		newData, err := yaml.Marshal(migrated)
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, newData, 0644); err != nil {
			return nil, err
		}
		log.Printf("Config migrated to version %s and saved to %s", ConfigVersion, path)
		data = newData
	}

	// 5. Final unmarshal into struct
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func Save(path string, cfg *models.Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
