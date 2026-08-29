package cli

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// stubExecutable makes install copy a file the test controls rather than the
// test binary itself, which is 20 MB of nothing to do with what is asserted.
func stubExecutable(t *testing.T, contents string) string {
	t.Helper()

	source := filepath.Join(t.TempDir(), "emu")
	if err := os.WriteFile(source, []byte(contents), 0o755); err != nil {
		t.Fatalf("writing the stub executable: %v", err)
	}

	previous := executablePath
	executablePath = func() (string, error) { return source, nil }
	t.Cleanup(func() { executablePath = previous })
	return source
}

func TestInstallCopiesTheBinaryToTheDestination(t *testing.T) {
	stubExecutable(t, "the static binary")
	destination := filepath.Join(t.TempDir(), "emu")

	var stderr bytes.Buffer
	if code := Run([]string{"install", destination}, nil, &stderr); code != 0 {
		t.Fatalf("exit code = %d (%s), want 0", code, stderr.String())
	}

	installed, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("reading the installed binary: %v", err)
	}
	if string(installed) != "the static binary" {
		t.Errorf("installed = %q, want the source's contents", installed)
	}
}

// installed runs a successful install and returns where the binary landed.
func installed(t *testing.T) string {
	t.Helper()

	stubExecutable(t, "x")
	destination := filepath.Join(t.TempDir(), "emu")
	if err := installTo(destination); err != nil {
		t.Fatalf("installTo: %v", err)
	}
	return destination
}

func TestInstallLeavesTheBinaryExecutableAndUnwritable(t *testing.T) {
	info, err := os.Stat(installed(t))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != binaryMode {
		t.Errorf("mode = %o, want %o", info.Mode().Perm(), binaryMode)
	}
}

func TestInstallLeavesNoPartialBehind(t *testing.T) {
	if _, err := os.Stat(installed(t) + stagedSuffix); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the staged copy survived the rename: %v", err)
	}
}

func TestInstallRejectsAnythingButOneDestination(t *testing.T) {
	for name, args := range map[string][]string{
		"no destination":   {"install"},
		"two destinations": {"install", "/out/emu", "/other/emu"},
	} {
		t.Run(name, func(t *testing.T) {
			var stderr bytes.Buffer
			if code := Run(args, nil, &stderr); code != exitUsage {
				t.Errorf("exit code = %d, want %d", code, exitUsage)
			}
		})
	}
}

func TestInstallReportsAnUnknowableExecutable(t *testing.T) {
	previous := executablePath
	executablePath = func() (string, error) { return "", errors.New("no /proc") }
	t.Cleanup(func() { executablePath = previous })

	var stderr bytes.Buffer
	if code := Run([]string{"install", filepath.Join(t.TempDir(), "emu")}, nil, &stderr); code != exitControl {
		t.Errorf("exit code = %d, want %d", code, exitControl)
	}
	if !bytes.Contains(stderr.Bytes(), []byte("no /proc")) {
		t.Errorf("stderr = %q, want the underlying reason", stderr.String())
	}
}

func TestInstallReportsAnUnreadableExecutable(t *testing.T) {
	previous := executablePath
	executablePath = func() (string, error) { return filepath.Join(t.TempDir(), "gone"), nil }
	t.Cleanup(func() { executablePath = previous })

	if err := installTo(filepath.Join(t.TempDir(), "emu")); err == nil {
		t.Error("err = nil, want a read failure")
	}
}

func TestInstallReportsAnUnwritableDestination(t *testing.T) {
	stubExecutable(t, "x")

	if err := installTo(filepath.Join(t.TempDir(), "no-such-dir", "emu")); err == nil {
		t.Error("err = nil, want a write failure")
	}
}

func TestInstallReportsADestinationItCannotReplace(t *testing.T) {
	stubExecutable(t, "x")

	// A non-empty directory where the binary should go: the staged copy writes
	// fine and the rename is what fails.
	destination := filepath.Join(t.TempDir(), "emu")
	if err := os.MkdirAll(filepath.Join(destination, "occupied"), 0o755); err != nil {
		t.Fatalf("preparing the destination: %v", err)
	}

	if err := installTo(destination); err == nil {
		t.Error("err = nil, want a rename failure")
	}
}
