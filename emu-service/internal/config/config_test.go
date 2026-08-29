package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
)

// theWholeDocumentedShape is the config from plans/emu-service.md, so a drift
// between the plan and the loader fails here.
const theWholeDocumentedShape = `{
  "services": ["postgres", "redis"],
  "seed": {
    "postgres": [
      "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
      "INSERT INTO accounts VALUES (1, 100), (2, 50)"
    ],
    "redis": { "rate:1": "0" }
  },
  "faults": [
    { "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
      "message": "could not serialize access due to concurrent update" }
  ],
  "log_limit": 500
}`

func TestParseAcceptsTheDocumentedConfig(t *testing.T) {
	config, err := Parse(strings.NewReader(theWholeDocumentedShape))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	if len(config.Services) != 2 {
		t.Errorf("services = %v, want two", config.Services)
	}
	if len(config.Seed) != 2 {
		t.Errorf("seed = %v, want an entry per service", config.Seed)
	}
	if len(config.Faults) != 1 || config.Faults[0].After != 2 || config.Faults[0].Times != 1 {
		t.Errorf("faults = %+v, want the commit rule with its counting", config.Faults)
	}
	if config.LogLimit != 500 {
		t.Errorf("log_limit = %d, want 500", config.LogLimit)
	}
}

// TestNoConfigInputCanOpenAControlChannel is the phase's load-bearing test. A
// lesson author influences the config while only rce-service builds argv, so a
// config knob that reached the control socket would hand student code the ability
// to disarm the faults grading it.
func TestNoConfigInputCanOpenAControlChannel(t *testing.T) {
	forbidden := []string{"control", "socket", "bind", "listen", "addr", "dev"}

	var walk func(reflect.Type, string)
	walk = func(structure reflect.Type, path string) {
		for index := range structure.NumField() {
			field := structure.Field(index)
			name := strings.ToLower(field.Name + " " + field.Tag.Get("json"))
			for _, word := range forbidden {
				if strings.Contains(name, word) {
					t.Errorf("%s%s mentions %q — config must not reach the control plane", path, field.Name, word)
				}
			}
			if field.Type.Kind() == reflect.Struct {
				walk(field.Type, path+field.Name+".")
			}
		}
	}
	walk(reflect.TypeFor[Config](), "Config.")
	walk(reflect.TypeFor[control.Rule](), "Rule.")
}

func TestParseRejectsAConfigThatAsksForAControlChannel(t *testing.T) {
	// Unknown fields are refused, so the attempt fails the run instead of being
	// silently ignored — which is what makes the guarantee above enforceable
	// rather than merely true today.
	for name, document := range map[string]string{
		"a control socket":      `{"services":["redis"],"dev_control_socket":"/tmp/emu.sock"}`,
		"a control bind":        `{"services":["redis"],"dev_control_bind":":9100"}`,
		"a knob inside a fault": `{"services":["redis"],"faults":[{"match":"redis.*","action":"error","control":"on"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(strings.NewReader(document)); err == nil {
				t.Error("Parse = nil, want the unknown field refused")
			}
		})
	}
}

func TestParseRejectsConfigsThatCouldNotDoWhatTheySay(t *testing.T) {
	for name, testCase := range map[string]struct {
		document string
		names    string
	}{
		"no services":         {`{"faults":[]}`, "services is empty"},
		"an unknown service":  {`{"services":["postgress"]}`, "postgress"},
		"a service twice":     {`{"services":["redis","redis"]}`, "twice"},
		"a negative limit":    {`{"services":["redis"],"log_limit":-1}`, "log_limit"},
		"seed for no service": {`{"services":["redis"],"seed":{"postgres":[]}}`, "postgres"},
		"a fault on no service": {
			`{"services":["redis"],"faults":[{"match":"postgres.COMMIT","action":"error"}]}`, "postgres",
		},
		"not json": {`{`, "unexpected EOF"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(strings.NewReader(testCase.document))
			if err == nil {
				t.Fatalf("Parse = nil, want a refusal naming %q", testCase.names)
			}
			if !strings.Contains(err.Error(), testCase.names) {
				t.Errorf("Parse = %v, want it to name %q", err, testCase.names)
			}
		})
	}
}

func TestParseAcceptsAWildcardFaultAgainstAnyDeclaredService(t *testing.T) {
	for _, match := range []string{control.Wildcard, "*.COMMIT", "redis.*"} {
		document := `{"services":["redis"],"faults":[{"match":"` + match + `","action":"drop_conn"}]}`
		if _, err := Parse(strings.NewReader(document)); err != nil {
			t.Errorf("Parse with match %q: %v", match, err)
		}
	}
}

func TestLoadNamesTheFileItCouldNotUse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"services":["nope"]}`), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	_, err := Load(path)
	if err == nil {
		t.Fatal("Load = nil, want the invalid service refused")
	}
	if !strings.Contains(err.Error(), path) {
		t.Errorf("Load = %v, want it to name %s", err, path)
	}
}

func TestLoadReportsAMissingFile(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "absent.json"))

	if err == nil || !strings.Contains(err.Error(), "reading the config") {
		t.Errorf("Load = %v, want a read failure", err)
	}
}

func TestLoadReadsTheDocumentedConfigFromDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(theWholeDocumentedShape), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	config, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(config.Services) != 2 {
		t.Errorf("services = %v, want two", config.Services)
	}
}

func TestEveryKnownServiceIsAcceptedAndNamedInTheError(t *testing.T) {
	for _, service := range KnownServices {
		if _, err := Parse(strings.NewReader(`{"services":["` + service + `"]}`)); err != nil {
			t.Errorf("Parse with service %q: %v", service, err)
		}
	}
}
