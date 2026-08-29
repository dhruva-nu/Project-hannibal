package mongowire

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// A pending request is what the next reply owes the client: the id it responds
// to, whether it arrived the legacy way, and whether the client is waiting at
// all — an unacknowledged write sets moreToCome and then reads nothing, so a
// reply to it would be read as the answer to the client's next command.
type pending struct {
	requestID int32
	legacy    bool
	silent    bool
}

// A session decodes one connection. It is per-connection because the reply to a
// command has to name the request it answers, and because the connection count
// a rule gates on is only right if closing one is noticed.
type session struct {
	protocol *Protocol
	conn     net.Conn
	reader   *bufio.Reader

	// alreadyOpen is how many connections this one arrived alongside.
	alreadyOpen int
	// replies numbers the messages emu sends, which the protocol requires to be
	// unique per connection and uses for nothing else.
	replies int32

	greeted    bool
	connecting bool
	pending    pending
}

func newSession(conn net.Conn, protocol *Protocol, alreadyOpen int) *session {
	return &session{
		protocol:    protocol,
		conn:        conn,
		reader:      bufio.NewReader(conn),
		alreadyOpen: alreadyOpen,
	}
}

// Next decodes until it has an operation for the control layer, answering the
// commands that are about emu rather than about the data along the way.
func (s *session) Next() (control.Op, error) {
	if !s.greeted {
		s.greeted, s.connecting = true, true
		return control.Op{
			Kind:   emulator.KindConnect,
			Gauges: map[string]int{"connections": s.alreadyOpen},
		}, nil
	}
	s.connecting = false

	for {
		op, ready, err := s.read()
		if err != nil || ready {
			return op, err
		}
	}
}

// read takes one message off the wire. It reports ready only for an operation
// the control layer has to see; everything else it has already answered.
func (s *session) read() (control.Op, bool, error) {
	message, body, err := readMessage(s.reader)
	if err != nil {
		return control.Op{}, false, err
	}

	document, silent, err := s.decode(message, body)
	if err != nil {
		return control.Op{}, false, err
	}
	s.pending = pending{requestID: message.requestID, legacy: message.opCode == opQuery, silent: silent}

	command, err := mongocmd.Read(document)
	if err != nil {
		// A command emu does not implement is the client's mistake to hear about,
		// not a reason to drop a connection it is still using.
		return control.Op{}, false, s.send(errorDocument(err))
	}
	if command.Server {
		return control.Op{}, false, s.answer(command)
	}
	return s.operation(command), true, nil
}

func (s *session) decode(message header, body []byte) (bson.D, bool, error) {
	switch message.opCode {
	case opMsg:
		return decodeMsg(body)
	case opQuery:
		document, err := decodeQuery(body)
		return document, false, err
	default:
		// Nothing else can be answered in a way the client would understand, and
		// a reply on the wrong opcode is worse than a closed socket.
		return nil, false, fmt.Errorf("mongowire: opcode %d is not one emu speaks", message.opCode)
	}
}

// operation is the Op the control layer sees. The document count is the gauge a
// rule reads, and it is the count *before* the operation — so
// `when: {documents_gte: 100}` on an insert means "once it already holds a
// hundred", which is how a lesson author says a capacity.
func (s *session) operation(command mongocmd.Command) control.Op {
	op := control.Op{Kind: command.Kind, Target: command.Target, Payload: command}
	if command.Collection {
		op.Gauges = map[string]int{"documents": s.protocol.documents.Count(command.Target)}
	}
	return op
}

// Reply writes the result of the operation Next last returned.
func (s *session) Reply(result emulator.Result) error {
	if s.connecting {
		return nil // a MongoDB connection is not acknowledged; the client just speaks
	}
	document, err := mongocmd.Document(result)
	if err != nil {
		return s.send(errorDocument(err))
	}
	return s.send(document)
}

// Fail writes the protocol's own error document.
func (s *session) Fail(err error) error {
	if s.connecting {
		return errRefused // see errRefused: there is no frame to refuse a connection in
	}
	return s.send(errorDocument(err))
}

func (s *session) Close() error {
	s.protocol.connections.Add(-1)
	return nil
}

func (s *session) send(document bson.D) error {
	if s.pending.silent {
		return nil // the client set moreToCome and is not reading
	}

	encoded, err := bson.Marshal(document)
	if err != nil {
		return fmt.Errorf("mongowire: encoding a reply: %w", err)
	}
	body := encodeMsg(encoded)
	opCode := int32(opMsg)
	if s.pending.legacy {
		body, opCode = encodeReply(encoded), opReply
	}

	s.replies++
	return writeMessage(s.conn, s.replies, s.pending.requestID, opCode, body)
}

// errorDocument is what a client is told about a failure. A driver reacts to the
// code and not to the sentence — pymongo turns 11000 into DuplicateKeyError and
// 43 into CursorNotFound — so every failure has to carry one.
func errorDocument(err error) bson.D {
	code, codeName := codeOf(err)
	document := bson.D{
		mongocmd.Field("ok", 0.0),
		mongocmd.Field("errmsg", err.Error()),
		mongocmd.Field("code", int32(code)),
	}
	if codeName != "" {
		document = append(document, mongocmd.Field("codeName", codeName))
	}
	return document
}

// codeOf reads the MongoDB code a failure carries, and decides one for an
// injected fault that did not name it.
func codeOf(err error) (int, string) {
	var fault *control.FaultError
	if errors.As(err, &fault) {
		return faultCode(fault)
	}
	return mongocmd.CodeOf(err)
}

// faultCode reads a rule's `code` as MongoDB numbers its errors. The default is
// WriteConflict, which is MongoDB's serialization failure — the write failure a
// client is written to notice and retry, and therefore the behaviour a fault
// lesson is about.
//
// A rule that spells a name rather than a number gets it back as the codeName,
// because a client parses a non-numeric code as zero and reads zero as success.
func faultCode(fault *control.FaultError) (int, string) {
	if fault.Code == "" {
		return mongocmd.CodeWriteConflict, "WriteConflict"
	}
	if code, numeric := strconv.Atoi(fault.Code); numeric == nil {
		return code, ""
	}
	return mongocmd.CodeWriteConflict, fault.Code
}
