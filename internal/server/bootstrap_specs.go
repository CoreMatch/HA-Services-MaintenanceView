package server

type bootstrapDependency struct {
	ProjectName string
	FieldPaths  []string
}

type bootstrapSpec struct {
	ConfigFileName string
	DefaultPort    int
	PortField      string
	SelfURLFields  []string
	Dependencies   []bootstrapDependency
}

var bootstrapSpecs = map[string]bootstrapSpec{
	"hrpauth": {
		ConfigFileName: "config.yaml",
		DefaultPort:    2778,
		PortField:      "server.port",
		Dependencies: []bootstrapDependency{
			{
				ProjectName: "hrpauth-yggdrasil-api",
				FieldPaths:  []string{"yggdrasil_api.base_url"},
			},
		},
	},
	"hrpauth-yggdrasil-api": {
		ConfigFileName: "config.yaml",
		DefaultPort:    2770,
		PortField:      "server.port",
		SelfURLFields:  []string{"callback.url", "microservice.relay_url"},
		Dependencies: []bootstrapDependency{
			{
				ProjectName: "hrpauth",
				FieldPaths:  []string{"core_api.base_url"},
			},
		},
	},
	"haskinproxy": {
		ConfigFileName: "config.yaml",
		DefaultPort:    2702,
		PortField:      "server.listen_addr",
		SelfURLFields:  []string{"server.public_url"},
		Dependencies: []bootstrapDependency{
			{
				ProjectName: "hrpauth",
				FieldPaths:  []string{"upstream.base_url"},
			},
		},
	},
}

func getBootstrapSpec(projectName string) (bootstrapSpec, bool) {
	spec, ok := bootstrapSpecs[projectName]
	return spec, ok
}
