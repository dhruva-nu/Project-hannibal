package queues

import "fmt"

// The AMQP reply codes emu produces. A client reacts to the code and reports
// the sentence, the same way a Postgres driver reacts to a SQLSTATE — pika
// turns any of these into a ChannelClosedByBroker carrying the number, and a
// lesson can branch on it.
const (
	// codeNotFound is a queue or an exchange the client named and emu has not.
	codeNotFound uint16 = 404
	// codeAccessRefused is an operation on something the client may not touch,
	// which here means only the default exchange.
	codeAccessRefused uint16 = 403
	// codePreconditionFailed is a request that contradicts what already exists:
	// a redeclared exchange of another kind, an acknowledgement of a delivery
	// that was never made.
	codePreconditionFailed uint16 = 406
	// codeNotAllowed is a request AMQP forbids outright, such as a second
	// consumer under a tag this connection is already using.
	codeNotAllowed uint16 = 530
	// codeCommandInvalid is a well-formed request emu cannot carry out, such as
	// an exchange of a kind it does not implement.
	codeCommandInvalid uint16 = 503
)

// A queueError is a failure with the reply code AMQP gives it. The codec reads
// the code through an interface rather than importing this package, exactly as
// pgwire reads a SQLSTATE.
type queueError struct {
	code    uint16
	message string
}

func (e *queueError) Error() string { return e.message }

// ReplyCode is what the codec closes the channel with.
func (e *queueError) ReplyCode() uint16 { return e.code }

func failure(code uint16, format string, args ...any) error {
	return &queueError{code: code, message: fmt.Sprintf(format, args...)}
}

func noQueue(name string) error {
	return failure(codeNotFound, "no queue %q", name)
}

func noExchange(name string) error {
	return failure(codeNotFound, "no exchange %q", name)
}
