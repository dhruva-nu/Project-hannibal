package pgwire

import (
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5/pgproto3"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqltext"
)

// defaultFaultState is the SQLSTATE an injected fault carries when the rule did
// not name one. A serialization failure is the failure Postgres clients are
// written to retry, which is the behaviour a fault lesson is about — the same
// words under a code the driver does not recognise would only be a string.
const defaultFaultState = "40001"

// The transaction states ReadyForQuery reports.
const (
	statusIdle    = 'I'
	statusInBlock = 'T'
	statusAborted = 'E'
)

// driverStatements are the ones a Postgres client issues on its own behalf to
// manage the connection rather than the data. SQLite has never heard of either,
// and neither is something the lesson's code did — so pgwire answers them and
// keeps them out of the op log a student is graded from.
var driverStatements = map[string]bool{"DEALLOCATE": true, "DISCARD": true}

// A task is one operation handed to the control layer, together with what
// replying to it owes the client.
type task struct {
	op control.Op
	// describes is whether the client asked what the result looks like. The
	// simple protocol always wants it; the extended one asks with Describe.
	describes bool
	// extended is whether the task came from Parse/Bind/Execute, which decides
	// whether an error waits for Sync before the client is ready again.
	extended bool
	// driver is whether pgwire answers this one itself. It is still queued rather
	// than answered where it was decoded, so that a query carrying several
	// statements replies to them in the order it sent them.
	driver bool
}

// A prepared statement is SQL the client named, read once, with the parameter
// types the client said it would send.
type prepared struct {
	statement sqltext.Statement
	oids      []uint32
}

// A portal is a prepared statement with its parameters bound.
type portal struct {
	statement sqltext.Statement
	described bool
}

// A session decodes one connection. It is per-connection because the extended
// query protocol has to remember prepared statements for the life of the socket,
// and because transaction status belongs to a connection and nothing else.
type session struct {
	backend  *pgproto3.Backend
	protocol *Protocol

	prepared map[string]*prepared
	portals  map[string]*portal

	queue  []task
	active task

	// alreadyOpen is how many connections this one arrived alongside.
	alreadyOpen int

	greeted   bool
	owesReady bool
	// skipping is the extended protocol's rule that everything after an error is
	// discarded until the client synchronises.
	skipping bool
	inBlock  bool
	aborted  bool
}

func newSession(backend *pgproto3.Backend, protocol *Protocol, alreadyOpen int) *session {
	return &session{
		backend:     backend,
		protocol:    protocol,
		alreadyOpen: alreadyOpen,
		prepared:    map[string]*prepared{},
		portals:     map[string]*portal{},
	}
}

// Next decodes until it has an operation for the control layer, answering the
// protocol messages that are not operations along the way.
func (s *session) Next() (control.Op, error) {
	if !s.greeted {
		s.greeted = true
		s.active = s.connectTask()
		return s.active.op, nil
	}

	for {
		if len(s.queue) > 0 {
			s.active, s.queue = s.queue[0], s.queue[1:]
			if !s.active.driver {
				return s.active.op, nil
			}
			s.answerDriver()
			continue
		}
		// A ReadyForQuery that cannot be written is a client that has gone, and
		// the read below is where that is reported.
		s.reportReady()

		message, err := s.backend.Receive()
		if err != nil {
			return control.Op{}, err
		}
		if err := s.dispatch(message); err != nil {
			return control.Op{}, err
		}
	}
}

// Reply writes the result of the operation Next last returned. ReadyForQuery is
// not part of it: the client is ready when its whole query is, which for a
// multi-statement query is several replies later.
func (s *session) Reply(result emulator.Result) error {
	if s.active.op.Kind == emulator.KindConnect {
		s.owesReady = true
		return nil
	}

	if s.active.describes {
		s.describeResult(result.Columns)
	}
	for _, row := range result.Rows {
		s.backend.Send(&pgproto3.DataRow{Values: encodeRow(result.Columns, row)})
	}
	s.backend.Send(&pgproto3.CommandComplete{CommandTag: []byte(result.Tag)})

	s.track(s.active.op.Kind, true)
	return s.backend.Flush()
}

// Fail writes the protocol's own error frame. A statement that fails abandons
// the rest of the query it arrived with, exactly as Postgres does.
func (s *session) Fail(err error) error {
	s.queue = nil
	s.backend.Send(errorFrame(err))
	s.track(s.active.op.Kind, false)

	if s.active.op.Kind == emulator.KindConnect {
		_ = s.backend.Flush()
		return errRefused // a refused connection does not become a usable one
	}
	if s.active.extended {
		s.skipping = true
	} else {
		s.owesReady = true
	}
	return s.backend.Flush()
}

func (s *session) Close() error {
	s.protocol.connections.Add(-1)
	return nil
}

// connectTask is the operation a completed handshake reports, carrying how deep
// the pool already was so a rule can gate on it.
func (s *session) connectTask() task {
	return task{op: control.Op{
		Kind:   emulator.KindConnect,
		Gauges: map[string]int{"connections": s.alreadyOpen},
	}}
}

func (s *session) dispatch(message pgproto3.FrontendMessage) error {
	switch message.(type) {
	case *pgproto3.Terminate:
		return io.EOF
	case *pgproto3.Sync:
		s.skipping, s.owesReady = false, true
		return nil
	case *pgproto3.Flush:
		return s.backend.Flush()
	}

	if s.skipping {
		return nil
	}

	switch typed := message.(type) {
	case *pgproto3.Query:
		return s.query(typed)
	case *pgproto3.Parse:
		return s.parse(typed)
	case *pgproto3.Bind:
		return s.bind(typed)
	case *pgproto3.Describe:
		return s.describe(typed)
	case *pgproto3.Execute:
		return s.execute(typed)
	case *pgproto3.Close:
		return s.forget(typed)
	default:
		return s.unsupported(fmt.Errorf("emu does not implement the %T message", message))
	}
}

// query handles the simple protocol, where one message can carry several
// statements and each of them is its own operation to the control layer.
func (s *session) query(message *pgproto3.Query) error {
	s.owesReady = true

	statements := sqltext.Split(message.String)
	if len(statements) == 0 {
		s.backend.Send(&pgproto3.EmptyQueryResponse{})
		return nil
	}
	for _, text := range statements {
		s.enqueue(sqltext.Parse(text, nil), true, false)
	}
	return nil
}

// answerDriver acknowledges a statement the client issued to tidy up after
// itself. The prepared statement it names is deliberately kept: emu is not told
// which one, and a name emu forgot while the client still had it cached would
// fail a Bind that Postgres would have honoured. The client re-parses under the
// same name whenever it wants it back, which overwrites it.
func (s *session) answerDriver() {
	statement, _ := s.active.op.Payload.(sqltext.Statement)
	s.backend.Send(&pgproto3.CommandComplete{CommandTag: []byte(statement.Command)})
}

func (s *session) parse(message *pgproto3.Parse) error {
	s.prepared[message.Name] = &prepared{statement: sqltext.Parse(message.Query, nil), oids: message.ParameterOIDs}
	s.backend.Send(&pgproto3.ParseComplete{})
	return nil
}

func (s *session) bind(message *pgproto3.Bind) error {
	statement, known := s.prepared[message.PreparedStatement]
	if !known {
		return s.reject(fmt.Errorf("prepared statement %q does not exist", message.PreparedStatement), "26000")
	}
	if wantsBinary(message.ResultFormatCodes) {
		return s.reject(errors.New("emu returns results in text format only"), "0A000")
	}

	params, err := decodeParams(statement.oids, message.ParameterFormatCodes, message.Parameters)
	if err != nil {
		return s.reject(err, "22P03")
	}
	bound := statement.statement
	bound.Params = params
	s.portals[message.DestinationPortal] = &portal{statement: bound}
	s.backend.Send(&pgproto3.BindComplete{})
	return nil
}

// describe answers what a statement or a portal looks like. emu has no planner,
// so a prepared statement's result shape is not known until it runs — the
// portal's own Describe is where the columns come from, and libpq asks for that
// one every time it executes.
func (s *session) describe(message *pgproto3.Describe) error {
	if message.ObjectType == 'S' {
		statement, known := s.prepared[message.Name]
		if !known {
			return s.reject(fmt.Errorf("prepared statement %q does not exist", message.Name), "26000")
		}
		s.backend.Send(&pgproto3.ParameterDescription{
			ParameterOIDs: resolved(statement.oids, statement.statement.Parameters),
		})
		s.backend.Send(&pgproto3.NoData{})
		return nil
	}

	target, known := s.portals[message.Name]
	if !known {
		return s.reject(fmt.Errorf("portal %q does not exist", message.Name), "34000")
	}
	target.described = true
	return nil
}

func (s *session) execute(message *pgproto3.Execute) error {
	target, known := s.portals[message.Portal]
	if !known {
		return s.reject(fmt.Errorf("portal %q does not exist", message.Portal), "34000")
	}
	if message.MaxRows > 0 {
		// Honouring a row limit means holding the portal open between Executes,
		// and emu reads every result whole. Saying so beats sending the whole
		// result to a client that asked for part of it and is waiting for more.
		return s.reject(errors.New("emu does not implement row-limited Execute"), "0A000")
	}
	s.enqueue(target.statement, target.described, true)
	return nil
}

func (s *session) forget(message *pgproto3.Close) error {
	if message.ObjectType == 'S' {
		delete(s.prepared, message.Name)
	} else {
		delete(s.portals, message.Name)
	}
	s.backend.Send(&pgproto3.CloseComplete{})
	return nil
}

func (s *session) enqueue(statement sqltext.Statement, describes, extended bool) {
	s.queue = append(s.queue, task{
		op: control.Op{
			Kind:    statement.Kind,
			Target:  statement.Table,
			Payload: statement,
		},
		describes: describes,
		extended:  extended,
		driver:    driverStatements[statement.Command],
	})
}

// describeResult sends the shape of a result. The simple protocol has no NoData
// message, so a statement with no columns there says nothing at all.
func (s *session) describeResult(columns []emulator.Column) {
	if len(columns) == 0 {
		if s.active.extended {
			s.backend.Send(&pgproto3.NoData{})
		}
		return
	}

	fields := make([]pgproto3.FieldDescription, len(columns))
	for index, column := range columns {
		oid := oidFor(column.Type)
		fields[index] = pgproto3.FieldDescription{
			Name:         []byte(column.Name),
			DataTypeOID:  oid,
			DataTypeSize: widthOf(oid),
			TypeModifier: -1,
			Format:       pgproto3.TextFormat,
		}
	}
	s.backend.Send(&pgproto3.RowDescription{Fields: fields})
}

// reject answers a protocol-level mistake — a portal that does not exist, a
// format emu cannot produce — without ending the connection. Everything up to
// the client's next Sync is discarded, as the protocol requires.
func (s *session) reject(err error, state string) error {
	s.backend.Send(&pgproto3.ErrorResponse{
		Severity:            "ERROR",
		SeverityUnlocalized: "ERROR",
		Code:                state,
		Message:             err.Error(),
	})
	s.skipping = true
	return nil
}

// unsupported ends the connection. A message emu never implemented means the
// client is doing something emu cannot follow, and carrying on would be
// pretending otherwise.
func (s *session) unsupported(err error) error {
	_ = s.reject(err, "0A000")
	_ = s.backend.Flush()
	return err
}

func (s *session) reportReady() {
	if !s.owesReady {
		return
	}
	s.owesReady = false
	s.backend.Send(&pgproto3.ReadyForQuery{TxStatus: s.status()})
	_ = s.backend.Flush()
}

func (s *session) status() byte {
	switch {
	case s.aborted:
		return statusAborted
	case s.inBlock:
		return statusInBlock
	default:
		return statusIdle
	}
}

// track follows the transaction the client thinks it is in, which is what the
// status byte reports. A COMMIT that failed still ends the block — that is the
// whole difference between a fault a student can ignore and one they cannot.
func (s *session) track(kind string, succeeded bool) {
	switch kind {
	case sqltext.KindBegin:
		s.inBlock, s.aborted = succeeded, false
	case sqltext.KindCommit, sqltext.KindRollback:
		s.inBlock, s.aborted = false, false
	default:
		s.aborted = s.aborted || (!succeeded && s.inBlock)
	}
}

func errorFrame(err error) *pgproto3.ErrorResponse {
	return &pgproto3.ErrorResponse{
		Severity:            "ERROR",
		SeverityUnlocalized: "ERROR",
		Code:                stateOf(err),
		Message:             err.Error(),
	}
}

// stateOf is the SQLSTATE the client is told, which is what makes a driver react
// rather than merely report.
func stateOf(err error) string {
	var fault *control.FaultError
	if errors.As(err, &fault) {
		if fault.Code != "" {
			return fault.Code
		}
		return defaultFaultState
	}

	var coded interface{ SQLState() string }
	if errors.As(err, &coded) {
		return coded.SQLState()
	}
	return "XX000" // internal_error
}

// resolved answers what a prepared statement's parameters are. A client may name
// none of them and leave the server to infer, which emu has no planner to do —
// so it counts the placeholders for how many there are and answers text for what
// they hold, that being what every value can be read as.
func resolved(oids []uint32, placeholders int) []uint32 {
	answered := make([]uint32, max(len(oids), placeholders))
	for index := range answered {
		if index < len(oids) && oids[index] != 0 {
			answered[index] = oids[index]
			continue
		}
		answered[index] = oidText
	}
	return answered
}

func wantsBinary(formats []int16) bool {
	for _, format := range formats {
		if format == pgproto3.BinaryFormat {
			return true
		}
	}
	return false
}
