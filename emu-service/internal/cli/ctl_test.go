package cli

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

func TestCtlBuildsTheRuleTheFlagsDescribe(t *testing.T) {
	request, socket, err := parseCtl([]string{
		"fault", "add", "--socket", "/tmp/emu.sock",
		"--match", "queue.publish", "--action", "error", "--message", "queue full",
		"--after", "2", "--times", "1", "--when", "depth_gte=100", "--when", "depth_lte=500",
	})
	if err != nil {
		t.Fatalf("parseCtl: %v", err)
	}

	if socket != "/tmp/emu.sock" {
		t.Errorf("socket = %q, want the flag's value", socket)
	}
	if request.Command != control.CommandFaultAdd {
		t.Errorf("command = %q, want %q", request.Command, control.CommandFaultAdd)
	}
	want := control.Rule{
		Match: "queue.publish", Action: control.ActionError, Message: "queue full",
		After: 2, Times: 1, When: control.Conditions{"depth_gte": 100, "depth_lte": 500},
	}
	if request.Rule == nil {
		t.Fatal("rule = nil, want the rule the flags describe")
	}
	if got := *request.Rule; !sameRule(got, want) {
		t.Errorf("rule = %+v, want %+v", got, want)
	}
}

func TestCtlCommandsMapToTheSocketsVocabulary(t *testing.T) {
	for _, testCase := range []struct {
		words []string
		want  string
	}{
		{[]string{"fault", "add", "--match", "redis.*", "--action", "drop_conn"}, control.CommandFaultAdd},
		{[]string{"fault", "list"}, control.CommandFaultList},
		{[]string{"fault", "reset"}, control.CommandFaultReset},
		{[]string{"oplog"}, control.CommandOplog},
	} {
		request, _, err := parseCtl(append(testCase.words, "--socket", "/tmp/emu.sock"))
		if err != nil {
			t.Fatalf("%v: %v", testCase.words, err)
		}
		if request.Command != testCase.want {
			t.Errorf("%v = %q, want %q", testCase.words, request.Command, testCase.want)
		}
	}
}

func TestCtlCarriesNoRuleForACommandThatTakesNone(t *testing.T) {
	request, _, err := parseCtl([]string{"oplog", "--socket", "/tmp/emu.sock"})
	if err != nil {
		t.Fatalf("parseCtl: %v", err)
	}
	if request.Rule != nil {
		t.Errorf("rule = %+v, want none", request.Rule)
	}
}

func TestCtlReportsAnEmuItCannotReach(t *testing.T) {
	var stdout, stderr bytes.Buffer
	socket := filepath.Join(t.TempDir(), "absent.sock")

	code := Run([]string{"ctl", "oplog", "--socket", socket}, &stdout, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "dialing") {
		t.Errorf("stderr = %q, want it to name the dial", stderr.String())
	}
}

func TestCtlSurfacesARefusalFromTheRunningEmu(t *testing.T) {
	// The rule is well formed, so ctl sends it; the running emu is what refuses,
	// and that refusal must not read as success.
	socket := serveControl(t)
	var stdout, stderr bytes.Buffer

	code := Run([]string{"ctl", "fault", "add", "--socket", socket,
		"--match", "redis.SET", "--action", "error", "--times", "1"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("a valid rule was refused: %s", stderr.String())
	}

	code = Run([]string{"ctl", "fault", "reset", "--socket", socket}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("fault reset exit = %d, stderr = %s", code, stderr.String())
	}
}

func TestCtlReportsAStdoutItCannotWriteTo(t *testing.T) {
	var stderr bytes.Buffer

	code := Run([]string{"ctl", "oplog", "--socket", serveControl(t)}, failingWriter{}, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
}

func TestConditionFlagCollectsRepeatedGauges(t *testing.T) {
	var conditions conditionFlag

	for _, value := range []string{"depth_gte=100", "rows_lte=5"} {
		if err := conditions.Set(value); err != nil {
			t.Fatalf("Set(%q): %v", value, err)
		}
	}

	if conditions["depth_gte"] != 100 || conditions["rows_lte"] != 5 {
		t.Errorf("conditions = %v, want both gauges", conditions)
	}
	if got := conditions.String(); !strings.Contains(got, "depth_gte") {
		t.Errorf("String = %q, want it to show the gauges", got)
	}
}

func TestConditionFlagRejectsWhatItCannotRead(t *testing.T) {
	for _, value := range []string{"depth_gte", "depth_gte=lots"} {
		var conditions conditionFlag
		if err := conditions.Set(value); err == nil {
			t.Errorf("Set(%q) = nil, want a refusal", value)
		}
	}
}

// serveControl starts a control socket for an emu with nothing armed, closed when
// the test ends, and returns its path.
func serveControl(t *testing.T) string {
	t.Helper()
	interceptor, err := control.New(nil, oplog.New(10))
	if err != nil {
		t.Fatalf("control.New: %v", err)
	}
	path := filepath.Join(t.TempDir(), "emu.sock")
	server, err := control.Listen(path, interceptor)
	if err != nil {
		t.Fatalf("control.Listen: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })
	go server.Serve()
	return path
}

func sameRule(got, want control.Rule) bool {
	if got.Match != want.Match || got.Action != want.Action || got.Message != want.Message {
		return false
	}
	if got.After != want.After || got.Times != want.Times || got.Millis != want.Millis || got.Limit != want.Limit {
		return false
	}
	if len(got.When) != len(want.When) {
		return false
	}
	for gauge, bound := range want.When {
		if got.When[gauge] != bound {
			return false
		}
	}
	return true
}
