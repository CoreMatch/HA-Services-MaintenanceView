package state

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"HA-Services-MaintenanceView/internal/models"
)

type Store struct {
	path string
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Load() (*models.ProjectSettings, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &models.ProjectSettings{
				Projects: map[string]models.ProjectDeployment{},
			}, nil
		}
		return nil, err
	}

	var settings models.ProjectSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	if settings.Projects == nil {
		settings.Projects = map[string]models.ProjectDeployment{}
	}

	return &settings, nil
}

func (s *Store) Save(settings *models.ProjectSettings) error {
	if settings.Projects == nil {
		settings.Projects = map[string]models.ProjectDeployment{}
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, data, 0o644)
}
