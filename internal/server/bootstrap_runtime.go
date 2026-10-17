package server

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"HA-Services-MaintenanceView/internal/models"
	"github.com/goccy/go-yaml"
)

const generatedConfigWaitTimeout = 8 * time.Second

func initializeProjectConfig(
	projectName string,
	deployDir string,
	artifact *models.RemoteArtifact,
	spec bootstrapSpec,
	port int,
	dependencyPorts map[string]int,
) (*models.ProjectInitializationResult, error) {
	executablePath := filepath.Join(deployDir, artifact.FileName)
	if info, err := os.Stat(executablePath); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("executable %q does not exist yet", executablePath)
		}
		return nil, err
	} else if info.IsDir() {
		return nil, fmt.Errorf("executable path %q is a directory", executablePath)
	}

	configPath := filepath.Join(deployDir, spec.ConfigFileName)
	configGenerated, err := ensureGeneratedConfig(executablePath, deployDir, configPath)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var document map[string]any
	if len(bytes.TrimSpace(data)) == 0 {
		document = map[string]any{}
	} else if err := yaml.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse config %q: %w", configPath, err)
	}
	if document == nil {
		document = map[string]any{}
	}

	changes := make([]models.ProjectInitializationChange, 0, 1+len(spec.SelfURLFields)+len(spec.Dependencies))
	listenAddress := formatListenAddress(port)
	setNestedString(document, spec.PortField, listenAddress)
	changes = append(changes, models.ProjectInitializationChange{
		Field: spec.PortField,
		Value: listenAddress,
	})

	selfURL := formatLocalURL(port)
	for _, fieldPath := range spec.SelfURLFields {
		setNestedString(document, fieldPath, selfURL)
		changes = append(changes, models.ProjectInitializationChange{
			Field: fieldPath,
			Value: selfURL,
		})
	}

	resolvedDeps := make(map[string]int, len(spec.Dependencies))
	for _, dependency := range spec.Dependencies {
		dependencyPort, ok := dependencyPorts[dependency.ProjectName]
		if !ok || dependencyPort <= 0 {
			return nil, fmt.Errorf("dependency project %q does not have a saved port", dependency.ProjectName)
		}

		resolvedDeps[dependency.ProjectName] = dependencyPort
		dependencyURL := formatLocalURL(dependencyPort)
		for _, fieldPath := range dependency.FieldPaths {
			setNestedString(document, fieldPath, dependencyURL)
			changes = append(changes, models.ProjectInitializationChange{
				Field: fieldPath,
				Value: dependencyURL,
			})
		}
	}

	encoded, err := yaml.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("marshal config %q: %w", configPath, err)
	}

	if err := os.WriteFile(configPath, encoded, 0o644); err != nil {
		return nil, err
	}

	result := &models.ProjectInitializationResult{
		ProjectName:     projectName,
		ArtifactID:      artifact.ID,
		DeployDir:       deployDir,
		Port:            port,
		ExecutablePath:  executablePath,
		ConfigPath:      configPath,
		ConfigGenerated: configGenerated,
		Changes:         changes,
		DependencyPorts: resolvedDeps,
		Message:         "default config is ready and service ports were applied",
	}

	return result, nil
}

func ensureGeneratedConfig(executablePath, deployDir, configPath string) (bool, error) {
	if info, err := os.Stat(configPath); err == nil && !info.IsDir() {
		return false, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, executablePath)
	cmd.Dir = deployDir

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("start executable to generate config: %w", err)
	}

	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	deadline := time.Now().Add(generatedConfigWaitTimeout)
	for {
		if info, err := os.Stat(configPath); err == nil && !info.IsDir() {
			cancel()
			select {
			case <-waitCh:
			case <-time.After(1 * time.Second):
			}
			return true, nil
		}

		select {
		case err := <-waitCh:
			if info, statErr := os.Stat(configPath); statErr == nil && !info.IsDir() {
				return true, nil
			}
			output := summarizeCommandOutput(stdout.String(), stderr.String())
			if err != nil {
				return false, fmt.Errorf("executable exited before generating %q: %v%s", configPath, err, output)
			}
			return false, fmt.Errorf("executable exited before generating %q%s", configPath, output)
		case <-time.After(250 * time.Millisecond):
			if time.Now().After(deadline) {
				cancel()
				<-waitCh
				if info, err := os.Stat(configPath); err == nil && !info.IsDir() {
					return true, nil
				}
				return false, fmt.Errorf("timed out waiting for %q to be generated%s", configPath, summarizeCommandOutput(stdout.String(), stderr.String()))
			}
		}
	}
}

func summarizeCommandOutput(stdout, stderr string) string {
	parts := make([]string, 0, 2)
	if trimmed := strings.TrimSpace(stdout); trimmed != "" {
		parts = append(parts, " stdout="+limitOutput(trimmed))
	}
	if trimmed := strings.TrimSpace(stderr); trimmed != "" {
		parts = append(parts, " stderr="+limitOutput(trimmed))
	}
	return strings.Join(parts, "")
}

func limitOutput(value string) string {
	const maxLen = 240
	if len(value) <= maxLen {
		return fmt.Sprintf("%q", value)
	}
	return fmt.Sprintf("%q", value[:maxLen]+"...")
}

func setNestedString(document map[string]any, fieldPath, value string) {
	parts := strings.Split(fieldPath, ".")
	current := document
	for index := 0; index < len(parts)-1; index++ {
		part := parts[index]
		next, ok := current[part].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[part] = next
		}
		current = next
	}
	current[parts[len(parts)-1]] = value
}

func formatListenAddress(port int) string {
	return fmt.Sprintf(":%d", port)
}

func formatLocalURL(port int) string {
	return fmt.Sprintf("http://localhost:%d", port)
}
