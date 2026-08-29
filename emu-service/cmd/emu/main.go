// Command emu supervises a sandboxed process and, in later phases, serves the
// infrastructure emulators it talks to.
package main

import (
	"os"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr))
}
