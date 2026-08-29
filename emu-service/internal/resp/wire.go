package resp

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
)

// The limits emu reads a frame under. Real Redis allows a million elements and a
// 512 MB bulk string; emu shares a 128 MB cgroup with the student process and is
// PID 1 in it, so a client that announces half a gigabyte must be refused rather
// than allocated for. These are generous for a lesson and cheap to fail.
const (
	maxElements = 1024 * 1024
	maxBulk     = 8 << 20
	// readBuffer also bounds a protocol line: bufio reports a line longer than its
	// buffer instead of growing to hold it, which is the bound that matters.
	readBuffer = 64 * 1024
)

// crlf ends every frame.
const crlf = "\r\n"

// nullBulk is RESP2's nil, which is what a cache miss looks like on the wire.
const nullBulk = "$-1" + crlf

// defaultFaultPrefix is the error prefix an injected fault carries when the rule
// did not name one.
//
// Postgres has a SQLSTATE registry and a driver switches on it; Redis has no such
// thing. redis-py maps a handful of prefixes — WRONGTYPE, OOM, BUSY, READONLY,
// NOSCRIPT — to their own exception classes and everything else to a bare
// ResponseError, so ERR is the prefix that produces the exception a student's
// `except redis.RedisError` actually catches. A lesson that is specifically about
// an evicting cache or a read-only replica names OOM or READONLY with the rule's
// `code` and gets the class that goes with it.
const defaultFaultPrefix = "ERR"

// A protocolError is a frame emu could not read. It is not a command failure: a
// client that has lost the frame boundary cannot be answered any further, so the
// connection goes with it — which is also what Redis does.
type protocolError struct{ reason string }

func (e *protocolError) Error() string { return "ERR Protocol error: " + e.reason }

func protocolErrorf(format string, args ...any) *protocolError {
	return &protocolError{reason: fmt.Sprintf(format, args...)}
}

// readCommand decodes one command. An empty array is a client with nothing to
// say — Redis reads past it — so the caller gets no arguments and no error.
func readCommand(reader *bufio.Reader) ([]string, error) {
	line, err := readLine(reader)
	if err != nil {
		return nil, err
	}
	if len(line) == 0 || line[0] != '*' {
		return nil, protocolErrorf("expected '*', got '%s'", opening(line))
	}

	count, err := strconv.Atoi(string(line[1:]))
	if err != nil || count < 0 || count > maxElements {
		return nil, protocolErrorf("invalid multibulk length")
	}

	// Capacity is bounded separately from the announced count: a client that says
	// a million arguments should not get a million slots before the first arrives.
	argv := make([]string, 0, min(count, 64))
	for range count {
		argument, err := readBulk(reader)
		if err != nil {
			return nil, err
		}
		argv = append(argv, argument)
	}
	return argv, nil
}

func readBulk(reader *bufio.Reader) (string, error) {
	line, err := readLine(reader)
	if err != nil {
		return "", err
	}
	if len(line) == 0 || line[0] != '$' {
		return "", protocolErrorf("expected '$', got '%s'", opening(line))
	}

	size, err := strconv.Atoi(string(line[1:]))
	if err != nil || size < 0 || size > maxBulk {
		return "", protocolErrorf("invalid bulk length")
	}

	body := make([]byte, size+len(crlf))
	if _, err := io.ReadFull(reader, body); err != nil {
		return "", err
	}
	if string(body[size:]) != crlf {
		return "", protocolErrorf("invalid bulk length")
	}
	return string(body[:size]), nil
}

// readLine reads one CRLF-terminated header line, refusing one that would not
// fit the read buffer. ReadSlice is what makes that bound real: it reports a
// long line rather than growing to hold whatever a hostile client sends.
func readLine(reader *bufio.Reader) ([]byte, error) {
	line, err := reader.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return nil, protocolErrorf("too big inline request")
	}
	if err != nil {
		return nil, err
	}
	return bytes.TrimRight(line, crlf), nil
}

// opening is the character Redis quotes back at a client whose frame started
// wrong, and it is empty rather than a panic when the line was empty.
func opening(line []byte) string {
	if len(line) == 0 {
		return ""
	}
	return string(line[:1])
}

// coded is an error that already names its own Redis prefix, the way sqlitedb's
// errors carry a SQLSTATE. Anything without one is an emu bug rather than a
// Redis failure, and is reported as a plain ERR.
type coded interface{ RedisError() string }

// errorLine is what the client is told, which is what decides whether a driver
// raises something a student can tell apart from anything else.
func errorLine(err error) string {
	var fault *control.FaultError
	if errors.As(err, &fault) {
		prefix := fault.Code
		if prefix == "" {
			prefix = defaultFaultPrefix
		}
		return prefix + " " + fault.Message
	}

	var known coded
	if errors.As(err, &known) {
		return known.RedisError()
	}
	return defaultFaultPrefix + " " + err.Error()
}
