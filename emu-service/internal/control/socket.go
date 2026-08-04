package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// Commands the dev control socket understands.
const (
	CommandFaultAdd   = "fault.add"
	CommandFaultList  = "fault.list"
	CommandFaultReset = "fault.reset"
	CommandOplog      = "oplog"
)

// A Request is one line of JSON sent to the dev control socket.
type Request struct {
	Command string `json:"cmd"`
	Rule    *Rule  `json:"rule,omitempty"`
}

// A Response is the one line of JSON sent back.
type Response struct {
	OK    bool          `json:"ok"`
	Error string        `json:"error,omitempty"`
	Rules []Rule        `json:"rules,omitempty"`
	Oplog []oplog.Entry `json:"oplog,omitempty"`
}

// A Server answers `emu ctl` over a Unix socket. It exists for an emu running
// locally, where there is no untrusted child — the P2 dashboard drives it.
//
// A lesson run never has one, and the mode 0600 below is not what stops that.
// Student code shares emu's uid inside the sandbox, so the owner of this socket
// is also the process the faults are grading: it could disarm them. There is no
// socket the controller can reach that the student cannot, which is why this is
// reachable only from an explicit argv flag and why config cannot ask for it.
type Server struct {
	listener  net.Listener
	intercept *Interceptor
}

// Listen opens the control socket at path. An existing file at that path is an
// error rather than something to clean up: it means another emu is running.
func Listen(path string, intercept *Interceptor) (*Server, error) {
	return listen(path, intercept, os.Chmod)
}

// listen takes chmod as an argument so that a test can reach the failure branch;
// callers want Listen.
func listen(path string, intercept *Interceptor, chmod func(string, os.FileMode) error) (*Server, error) {
	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, fmt.Errorf("dev control socket: %w", err)
	}
	if err := chmod(path, 0o600); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("dev control socket: %w", err)
	}
	return &Server{listener: listener, intercept: intercept}, nil
}

// Serve accepts connections until Close, each carrying any number of requests.
func (s *Server) Serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return // the listener was closed during teardown
		}
		go s.handle(conn)
	}
}

// Close stops accepting and unlinks the socket file.
func (s *Server) Close() error { return s.listener.Close() }

func (s *Server) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()

	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)
	for {
		var request Request
		if err := decoder.Decode(&request); err != nil {
			return // the client hung up, or sent something that is not a request
		}
		// A failed reply means the client left mid-exchange, and there is nobody
		// left to tell; the next Decode ends the connection.
		_ = encoder.Encode(s.answer(request))
	}
}

// answer applies one request. Mutations go through the Interceptor rather than
// touching its state, so every one of them lands in the op log.
func (s *Server) answer(request Request) Response {
	switch request.Command {
	case CommandFaultAdd:
		if request.Rule == nil {
			return refusal(errors.New(CommandFaultAdd + " needs a rule"))
		}
		if err := s.intercept.AddRule(*request.Rule); err != nil {
			return refusal(err)
		}
		return Response{OK: true, Rules: s.intercept.Rules()}
	case CommandFaultList:
		return Response{OK: true, Rules: s.intercept.Rules()}
	case CommandFaultReset:
		s.intercept.ResetRules()
		return Response{OK: true}
	case CommandOplog:
		return Response{OK: true, Oplog: s.intercept.Log().Entries()}
	default:
		return refusal(fmt.Errorf("unknown command %q", request.Command))
	}
}

func refusal(err error) Response { return Response{Error: err.Error()} }

// Send dials a dev control socket, sends one request, and returns the response.
// A refusal from the far side is an error here too, so a caller cannot mistake it
// for success.
func Send(path string, request Request) (Response, error) {
	conn, err := net.Dial("unix", path)
	if err != nil {
		return Response{}, fmt.Errorf("dialing %s: %w", path, err)
	}
	defer func() { _ = conn.Close() }()

	return exchange(conn, request)
}

// exchange is one request/response round trip, split out from the dialling so a
// test can drive it over a stream that fails.
func exchange(stream io.ReadWriter, request Request) (Response, error) {
	if err := json.NewEncoder(stream).Encode(request); err != nil {
		return Response{}, fmt.Errorf("sending %s: %w", request.Command, err)
	}

	var response Response
	if err := json.NewDecoder(stream).Decode(&response); err != nil {
		return Response{}, fmt.Errorf("reading the reply to %s: %w", request.Command, err)
	}
	if !response.OK {
		return response, fmt.Errorf("emu refused %s: %s", request.Command, response.Error)
	}
	return response, nil
}
