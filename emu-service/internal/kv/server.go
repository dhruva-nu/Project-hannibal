package kv

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// serverVersion is what a client is told it connected to. Clients gate features
// on it — redis-py compares it before offering some commands — so it has to be a
// version that exists and that supports everything emu answers. The truth goes in
// a section of its own rather than in the version string, because a parser that
// reads "7.2.0 (emu)" as a version reads it wrong.
const serverVersion = "7.2.0"

func ping(_ *executor, args []string) (emulator.Result, error) {
	if len(args) == 0 {
		return status("PONG"), nil
	}
	return value(args[0]), nil
}

func echo(_ *executor, args []string) (emulator.Result, error) {
	return value(args[0]), nil
}

// selectDatabase moves this connection to another numbered database. It is the
// one piece of state an executor holds that the key space does not, which is the
// reason a cache backend hands out an executor per connection at all.
func selectDatabase(e *executor, args []string) (emulator.Result, error) {
	index, err := strconv.Atoi(args[0])
	if err != nil {
		return emulator.Result{}, ErrNotInteger
	}
	if index < 0 || index >= databases {
		return emulator.Result{}, ErrDBIndex
	}
	e.selected = index
	return status("OK"), nil
}

// info answers what a client asks about the server. The section argument is
// accepted and ignored: emu's whole report is shorter than any one section of a
// real server's, so filtering it would only hide the two lines that are true.
func info(e *executor, _ []string) (emulator.Result, error) {
	var report strings.Builder
	fmt.Fprintf(&report, "# Server\r\nredis_version:%s\r\nredis_mode:standalone\r\n", serverVersion)
	report.WriteString("\r\n# Emu\r\nemulated:1\r\n")
	report.WriteString("\r\n# Keyspace\r\n")

	for index, space := range e.backend.spaces {
		if live := space.live(); len(live) > 0 {
			fmt.Fprintf(&report, "db%d:keys=%d,expires=%d,avg_ttl=0\r\n", index, len(live), space.expiring())
		}
	}
	return value(report.String()), nil
}

func dbsize(e *executor, _ []string) (emulator.Result, error) {
	return value(len(e.space().live())), nil
}

// flushdb empties the selected database. The ASYNC or SYNC a client may append
// is accepted and ignored, because emu has no background thread for either word
// to mean anything different about.
func flushdb(e *executor, _ []string) (emulator.Result, error) {
	e.space().flush()
	return status("OK"), nil
}

// expiring counts the live keys that have a TTL, which is the only number in
// INFO's keyspace line that is not already known.
func (s *space) expiring() int {
	count := 0
	for _, key := range s.live() {
		if !s.entries[key].expires.IsZero() {
			count++
		}
	}
	return count
}
