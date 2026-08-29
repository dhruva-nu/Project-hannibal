package control

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"syscall"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/supervise"
)

// outputLimit bounds the child output the dashboard holds. A student program in
// a print loop is the obvious way to turn a dev tool into an out-of-memory kill.
const outputLimit = 256 << 10

// readChunk is how much of the child's output one read collects.
const readChunk = 8 << 10

// exitUnstarted marks a command that never became a process.
const exitUnstarted = -1

// An OutputChunk is a piece of what the child wrote, numbered so the page can
// poll for what it has not seen. Chunks rather than lines: a read boundary is
// something the operating system already gave us, while a line is a guess about
// output that may never contain a newline at all.
type OutputChunk struct {
	N      int    `json:"n"`
	Stream string `json:"stream"` // "stdout", "stderr", or "emu" for our own notes
	Text   string `json:"text"`
}

// ChildStatus is what the dashboard shows about the process it started.
type ChildStatus struct {
	Command  string        `json:"command"`
	Running  bool          `json:"running"`
	Exited   bool          `json:"exited"`
	ExitCode int           `json:"exit_code"`
	Output   []OutputChunk `json:"output"`
	Dropped  int           `json:"dropped"`
}

// A Runner starts one child at a time on the dashboard's behalf, keeping its
// output for the page to poll.
//
// Only `emu dev` gets one. An emu already supervising a lesson's child must not
// start a second: both supervisors reap with wait(-1), so each would collect the
// other's exit status and report the wrong code.
type Runner struct {
	mutex   sync.Mutex
	command string
	running bool
	exited  bool
	code    int
	process *os.Process

	chunks  []OutputChunk
	next    int
	held    int
	dropped int

	// shell is what interprets the command. It is a field only so a test can
	// point it at something that does not exist.
	shell string
}

// NewRunner returns a runner with nothing started.
func NewRunner() *Runner { return &Runner{next: 1, shell: "sh"} }

// Start runs command through `sh -c`, under the same supervisor a lesson's child
// gets — so what the dashboard exercises is the real path, not a convenience
// wrapper around it. The shell is what makes quoting behave as it does in a
// terminal.
func (r *Runner) Start(command string) error { return r.start(command, os.Pipe) }

// start takes the pipe constructor as an argument so a test can reach the
// failure branches; callers want Start.
func (r *Runner) start(command string, pipe func() (*os.File, *os.File, error)) error {
	if strings.TrimSpace(command) == "" {
		return errors.New("no command given")
	}
	if err := r.claim(command); err != nil {
		return err
	}
	r.append("emu", "$ "+command+"\n")

	streams, err := capture(pipe)
	if err != nil {
		r.finish(exitUnstarted)
		r.append("emu", err.Error()+"\n")
		return err
	}

	go r.supervise(command, streams)
	return nil
}

// Stop terminates the running child and everything it started.
//
// The signal goes to the process group, not the process. A shell waiting on a
// foreground `sleep` does not forward SIGTERM to it, so signalling the shell
// alone leaves the sleep running — still holding the output pipes open, which
// would pin the runner in "running" until it finished on its own.
func (r *Runner) Stop() error {
	r.mutex.Lock()
	process, claimed := r.process, r.running
	r.mutex.Unlock()

	switch {
	case process != nil:
		return syscall.Kill(-process.Pid, syscall.SIGTERM)
	case claimed:
		// Claimed but not yet forked. Saying so beats "nothing is running", which
		// would be a lie the operator could act on.
		return errors.New("the child is still starting")
	default:
		return errors.New("nothing is running")
	}
}

// Status reports the child and whatever output is numbered above since.
func (r *Runner) Status(since int) ChildStatus {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	fresh := make([]OutputChunk, 0, len(r.chunks))
	for _, chunk := range r.chunks {
		if chunk.N > since {
			fresh = append(fresh, chunk)
		}
	}
	return ChildStatus{
		Command:  r.command,
		Running:  r.running,
		Exited:   r.exited,
		ExitCode: r.code,
		Output:   fresh,
		Dropped:  r.dropped,
	}
}

func (r *Runner) supervise(command string, streams pipes) {
	var draining sync.WaitGroup
	draining.Add(2)
	go r.drain(streams.outReader, "stdout", &draining)
	go r.drain(streams.errReader, "stderr", &draining)

	code, err := supervise.Supervisor{
		Stdout:  streams.outWriter,
		Stderr:  streams.errWriter,
		Started: r.track,
		Group:   true,
	}.Run([]string{r.shell, "-c", command})

	// Closing the writers is what ends the drains: a pipe reports EOF only once
	// every writing end is gone, and the child's copies died with it.
	_, _ = streams.outWriter.Close(), streams.errWriter.Close()
	draining.Wait()

	if err != nil {
		r.finish(exitUnstarted)
		r.append("emu", err.Error()+"\n")
		return
	}
	r.finish(code)
	r.append("emu", fmt.Sprintf("exited %d\n", code))
}

func (r *Runner) drain(reader *os.File, stream string, done *sync.WaitGroup) {
	defer done.Done()
	defer func() { _ = reader.Close() }()

	buffer := make([]byte, readChunk)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			r.append(stream, string(buffer[:count]))
		}
		if err != nil {
			return
		}
	}
}

func (r *Runner) claim(command string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	if r.running {
		return fmt.Errorf("%q is still running", r.command)
	}
	r.command, r.running, r.exited = command, true, false
	return nil
}

func (r *Runner) track(process *os.Process) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.process = process
}

func (r *Runner) finish(code int) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.running, r.exited, r.code, r.process = false, true, code, nil
}

// append adds a chunk and drops the oldest until the buffer is back under the
// limit, counting what it lost so the page can say so.
func (r *Runner) append(stream, text string) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.chunks = append(r.chunks, OutputChunk{N: r.next, Stream: stream, Text: text})
	r.next++
	r.held += len(text)

	for r.held > outputLimit && len(r.chunks) > 1 {
		r.held -= len(r.chunks[0].Text)
		r.chunks = r.chunks[1:]
		r.dropped++
	}
}

// pipes carries a child's two output streams and the ends the dashboard reads.
type pipes struct {
	outReader, outWriter *os.File
	errReader, errWriter *os.File
}

func capture(pipe func() (*os.File, *os.File, error)) (pipes, error) {
	outReader, outWriter, err := pipe()
	if err != nil {
		return pipes{}, fmt.Errorf("capturing stdout: %w", err)
	}
	errReader, errWriter, err := pipe()
	if err != nil {
		_, _ = outReader.Close(), outWriter.Close()
		return pipes{}, fmt.Errorf("capturing stderr: %w", err)
	}
	return pipes{outReader, outWriter, errReader, errWriter}, nil
}
