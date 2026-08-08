package resp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"slices"
	"strconv"
	"strings"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// serverVersion is what HELLO reports. It matches what the backend puts in INFO
// — see kv.serverVersion — and cannot be shared with it without the protocol
// importing the backend, which is the one direction this seam does not go.
const serverVersion = "7.2.0"

// unsupportedProtocol is what Redis answers a HELLO naming a version it has
// never heard of.
const unsupportedProtocol = "NOPROTO unsupported protocol version"

// The protocol versions emu negotiates.
const (
	resp2 = "2"
	resp3 = "3"
)

// driverCommands are the ones a Redis client issues on its own behalf to set the
// connection up rather than to touch the cache. redis-py sends two CLIENT SETINFO
// on every connect and go-redis pipelines the same pair; pgwire keeps DEALLOCATE
// out of the op log for exactly this reason, and a graded artifact buried under a
// driver's bookkeeping is no better here.
//
// Everything else — including PING, ECHO, SELECT, and INFO — is the lesson
// talking, becomes an Op, and can be faulted.
var driverCommands = map[string]bool{"HELLO": true, "CLIENT": true, "COMMAND": true, "QUIT": true}

// keyless are the commands whose first argument is not a key, so that an op log
// entry and a rule's Target say something true. Everything else names its key
// first, which is a property of Redis's command table and not a coincidence.
var keyless = map[string]bool{
	"PING": true, "ECHO": true, "SELECT": true, "INFO": true,
	"KEYS": true, "SCAN": true, "DBSIZE": true, "FLUSHDB": true,
}

// A session decodes one connection. Redis has no per-connection state emu keeps
// here — the selected database belongs to the backend's executor — but a session
// per connection is what the seam is, and it is what holds the buffers.
type session struct {
	protocol *Protocol
	reader   *bufio.Reader
	writer   *bufio.Writer

	// alreadyOpen is how many connections this one arrived alongside.
	alreadyOpen int
	// identity is what HELLO reports as the client id.
	identity uint32

	// greeted is whether CONNECT has been reported yet, and deferred holds the
	// command that triggered it — see Next.
	greeted  bool
	deferred []string
	active   control.Op
	// modern is whether HELLO 3 was accepted, which changes three frames and
	// nothing else. RESP2 is the default because a client that never says HELLO
	// is a client from before there was anything else.
	modern bool
}

func newSession(conn net.Conn, protocol *Protocol, alreadyOpen int, identity uint32) *session {
	return &session{
		protocol:    protocol,
		reader:      bufio.NewReaderSize(conn, readBuffer),
		writer:      bufio.NewWriter(conn),
		alreadyOpen: alreadyOpen,
		identity:    identity,
	}
}

// Next decodes until it has an operation for the control layer, answering the
// driver's own commands along the way.
//
// CONNECT is reported when the first command that is not driver bookkeeping
// arrives, not when the socket is accepted, and the reason is that refusing a
// connection has to be something the student can see. RESP has no handshake, so
// there is no frame at which a client is waiting to be told it may proceed; and
// both redis-py and go-redis are written to swallow an error on their own setup
// commands — go-redis reads a failed HELLO as "this server is old" and carries
// on. A refusal delivered there would vanish. Delivered on the first operation
// the lesson's code performs, it arrives as the exception the lesson is about,
// which is also the moment a lazily-connecting client opened the socket at all.
func (s *session) Next() (control.Op, error) {
	for {
		argv, err := s.nextFrame()
		if err != nil {
			return control.Op{}, s.endWith(err)
		}
		if len(argv) == 0 {
			continue // *0: a client with nothing to say
		}

		verb := strings.ToUpper(argv[0])
		if driverCommands[verb] {
			if err := s.answerDriver(verb, argv[1:]); err != nil {
				return control.Op{}, err
			}
			continue
		}

		if !s.greeted {
			s.greeted, s.deferred = true, argv
			s.active = control.Op{
				Kind:   emulator.KindConnect,
				Gauges: map[string]int{"connections": s.alreadyOpen},
			}
			return s.active, nil
		}

		s.active = control.Op{Kind: verb, Target: targetOf(verb, argv), Payload: argv}
		return s.active, nil
	}
}

// nextFrame is the command to work on: the one that announced the connection if
// it has not been dealt with yet, otherwise the next one off the socket.
func (s *session) nextFrame() ([]string, error) {
	if s.deferred != nil {
		frame := s.deferred
		s.deferred = nil
		return frame, nil
	}
	return readCommand(s.reader)
}

// Reply writes the result of the operation Next last returned. A result with no
// rows is a simple string — Tag already means "what the client is told the
// operation did, in the protocol's own words", and in RESP that is +OK — and a
// result with rows carries its one value in the one cell. See the vocabulary in
// kv/commands.go.
func (s *session) Reply(result emulator.Result) error {
	if s.active.Kind == emulator.KindConnect {
		return nil // a connection is not something a client is told about
	}

	if len(result.Rows) == 0 || len(result.Rows[0]) == 0 {
		s.writeSimple(result.Tag)
	} else {
		s.writeValue(result.Rows[0][0])
	}
	return s.writer.Flush()
}

// Fail writes the protocol's own error frame. Unlike Postgres there is no
// transaction to poison and nothing to skip until a synchronisation point: the
// client is free to send the next command, which is exactly what makes "fail the
// third SET" a lesson about retries rather than about reconnecting.
func (s *session) Fail(err error) error {
	s.writeError(errorLine(err))
	if flushed := s.writer.Flush(); flushed != nil {
		return flushed
	}
	if s.active.Kind == emulator.KindConnect {
		return errRefused // a refused connection never becomes a usable one
	}
	return nil
}

func (s *session) Close() error {
	s.protocol.connections.Add(-1)
	return nil
}

// endWith reports a frame emu could not read the way Redis does — the error, then
// the connection. A client that has lost the frame boundary cannot be talked to
// any further, and carrying on would be pretending otherwise.
func (s *session) endWith(err error) error {
	var broken *protocolError
	if errors.As(err, &broken) {
		s.writeError(broken.Error())
		_ = s.writer.Flush()
	}
	return err
}

func (s *session) answerDriver(verb string, args []string) error {
	switch verb {
	case "HELLO":
		return s.hello(args)
	case "CLIENT":
		return s.client(args)
	case "QUIT":
		s.writeSimple("OK")
		_ = s.writer.Flush()
		return io.EOF
	default: // COMMAND
		// A client asks what the server can do so it can decide what to offer.
		// Answering "nothing" is what every client treats as "ask me instead",
		// and emu's table is in kv where the protocol cannot see it anyway.
		s.writeValue([]any{})
		return s.writer.Flush()
	}
}

// hello negotiates the protocol version, and the greeting it answers with is
// already in the version it just agreed to. redis-py checks that the proto it
// reads back is the one it asked for and refuses the connection otherwise, so
// this is not a formality.
//
// The AUTH clause a client may append is ignored rather than refused: emu has no
// password, so there is nothing for it to be wrong against.
func (s *session) hello(args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case resp2:
			s.modern = false
		case resp3:
			s.modern = true
		default:
			s.writeError(unsupportedProtocol)
			return s.writer.Flush()
		}
	}

	s.writePairs([]any{
		"server", "redis",
		"version", serverVersion,
		"proto", s.negotiated(),
		"id", int(s.identity),
		"mode", "standalone",
		"role", "master",
		"modules", []any{},
	})
	return s.writer.Flush()
}

func (s *session) negotiated() int {
	if s.modern {
		return 3
	}
	return 2
}

func (s *session) client(args []string) error {
	switch leading(args) {
	case "SETNAME", "SETINFO":
		s.writeSimple("OK")
	default:
		s.writeError(unknownSubcommand("CLIENT", args))
	}
	return s.writer.Flush()
}

func leading(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return strings.ToUpper(args[0])
}

func unknownSubcommand(container string, args []string) string {
	return fmt.Sprintf("ERR Unknown subcommand or wrong number of arguments for '%s'. Try %s HELP.",
		leading(args), container)
}

func targetOf(verb string, argv []string) string {
	if keyless[verb] || len(argv) < 2 {
		return ""
	}
	return argv[1]
}

// put buffers one frame. Write errors are not checked here and are not lost: a
// bufio.Writer remembers the first one and returns it from Flush, which is the
// one place a reply's fate is decided.
func (s *session) put(text string) { _, _ = s.writer.WriteString(text) }

func (s *session) writeSimple(text string) { s.put("+" + text + crlf) }

func (s *session) writeError(line string) { s.put("-" + line + crlf) }

func (s *session) writeBulk(text string) {
	s.put("$" + strconv.Itoa(len(text)) + crlf + text + crlf)
}

// writeValue encodes a backend's answer by its Go type, which is the whole
// contract between kv and this package: nil is a cache miss, a string is a bulk
// string, an int is an integer, a slice is an array, and a map is a map.
// Anything else is emu having produced something it never defined, and the
// client is told so rather than left waiting for a frame that is not coming.
func (s *session) writeValue(held any) {
	switch typed := held.(type) {
	case nil:
		s.writeNull()
	case string:
		s.writeBulk(typed)
	case int:
		s.put(":" + strconv.Itoa(typed) + crlf)
	case []string:
		s.put("*" + strconv.Itoa(len(typed)) + crlf)
		for _, item := range typed {
			s.writeBulk(item)
		}
	case []any:
		s.put("*" + strconv.Itoa(len(typed)) + crlf)
		for _, item := range typed {
			s.writeValue(item)
		}
	case map[string]string:
		s.writePairs(flatten(typed))
	default:
		s.writeError(fmt.Sprintf("ERR emu produced a %T, which is not a Redis reply", held))
	}
}

// writeNull is the first of the three frames the protocol versions disagree
// about. RESP3's parser reads $-1 as a bulk string of length minus one and falls
// over, so this one is not cosmetic.
func (s *session) writeNull() {
	if s.modern {
		s.put("_" + crlf)
		return
	}
	s.put(nullBulk)
}

// writePairs is the second: RESP3 has a map frame and RESP2 flattens the pairs
// into an array, which is why a RESP2 client's HGETALL comes back needing
// reassembly and a RESP3 client's does not.
func (s *session) writePairs(pairs []any) {
	if s.modern {
		s.put("%" + strconv.Itoa(len(pairs)/2) + crlf)
	} else {
		s.put("*" + strconv.Itoa(len(pairs)) + crlf)
	}
	for _, item := range pairs {
		s.writeValue(item)
	}
}

// flatten orders a map for the wire. Go's map iteration is deliberately random
// and a lesson has to run the same way twice, so the fields go out sorted.
func flatten(fields map[string]string) []any {
	pairs := make([]any, 0, 2*len(fields))
	for _, field := range slices.Sorted(maps.Keys(fields)) {
		pairs = append(pairs, field, fields[field])
	}
	return pairs
}
