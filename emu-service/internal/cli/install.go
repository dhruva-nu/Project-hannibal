package cli

import (
	"fmt"
	"io"
	"os"
)

// stagedSuffix names the partially written copy. The install is a rename, so a
// run container mounting the volume sees either the previous binary or the new
// one — never half of one.
const stagedSuffix = ".partial"

// binaryMode is what the destination ends up as: readable and executable by
// everyone, writable by nobody. The volume is mounted read-only into a run
// container anyway; this is the belt to that's braces.
const binaryMode = 0o555

// executablePath is a seam for the tests. Production has exactly one answer.
var executablePath = os.Executable

// install copies this executable to a destination — the one way a binary in a
// scratch image reaches the named volume rce-service mounts, since an image with
// no shell has no `cp` to run.
func install(args []string, stderr io.Writer) int {
	if len(args) != 1 {
		return fail(stderr, fmt.Errorf("install takes one destination\n\n%s", usage), exitUsage)
	}
	if err := installTo(args[0]); err != nil {
		return fail(stderr, err, exitControl)
	}
	return 0
}

func installTo(destination string) error {
	source, err := executablePath()
	if err != nil {
		return fmt.Errorf("finding this executable: %w", err)
	}
	binary, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("reading %s: %w", source, err)
	}

	staged := destination + stagedSuffix
	if err := os.WriteFile(staged, binary, binaryMode); err != nil {
		return fmt.Errorf("writing %s: %w", staged, err)
	}
	if err := os.Rename(staged, destination); err != nil {
		return fmt.Errorf("installing %s: %w", destination, err)
	}
	return nil
}
