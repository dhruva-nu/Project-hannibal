package amqp

import (
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// Where each method keeps the flags emu reads, counted from the low bit in the
// order the specification lists them. Everything not named here — durable,
// exclusive, auto-delete, internal, if-unused, if-empty, no-local, immediate —
// is read off the wire and ignored, because none of them can mean anything in a
// broker that is one process and dies with the run.
const (
	declarePassive = 0 // Exchange.Declare and Queue.Declare
	declareNoWait  = 4 // likewise
	bindNoWait     = 0
	purgeNoWait    = 0
	deleteNoWait   = 2

	qosGlobal        = 0
	consumeNoAck     = 1
	consumeNoWait    = 3
	cancelNoWait     = 0
	publishMandatory = 0
	getNoAck         = 0
	ackMultiple      = 0
	rejectRequeue    = 0
	nackMultiple     = 0
	nackRequeue      = 1
	confirmNoWait    = 0
)

// operation turns the methods that act on queues into Ops. Everything else a
// channel can carry has already been dealt with by the time this is reached.
func (s *session) operation(number uint16, id methodID, in *reader) error {
	switch id {
	case exchangeDeclare:
		return s.declareExchange(number, in)
	case queueDeclare:
		return s.declareQueue(number, in)
	case queueBind:
		return s.bindQueue(number, in)
	case queuePurge:
		return s.purgeQueue(number, in)
	case queueDelete:
		return s.deleteQueue(number, in)
	case basicQos:
		return s.setQos(number, in)
	case basicConsume:
		return s.consume(number, in)
	case basicCancel:
		return s.cancel(number, in)
	case basicPublish:
		return s.publish(number, in)
	case basicGet:
		return s.get(number, in)
	case basicAck:
		return s.settle(number, in, mq.KindAck)
	case basicNack:
		return s.settle(number, in, mq.KindNack)
	case basicReject:
		return s.reject(number, in)
	case confirmSelect:
		return s.selectConfirms(number, in)
	}
	return s.unsupported(number, id)
}

// answered is the method a request is replied with, unless the client set
// no-wait and asked not to be.
func answered(reply methodID, noWait bool) methodID {
	if noWait {
		return noReply
	}
	return reply
}

func (s *session) declareExchange(number uint16, in *reader) error {
	in.short() // reserved
	name := in.shortstr()
	kind := in.shortstr()
	flags := in.bits()
	in.table() // arguments, which emu has no exchange kind that reads

	return s.decoded(in, task{
		op: control.Op{
			Kind:    mq.KindExchange,
			Target:  name,
			Payload: mq.Exchange{Kind: kind, Passive: flags.at(declarePassive)},
		},
		channel: number,
		cause:   exchangeDeclare,
		answer:  answered(exchangeDeclareOk, flags.at(declareNoWait)),
	})
}

// namedQueue reads the arguments a Queue method starts with: a reserved short,
// the queue's name, and the method's own flags.
func namedQueue(in *reader) (string, bits) {
	in.short()
	return in.shortstr(), in.bits()
}

func (s *session) declareQueue(number uint16, in *reader) error {
	name, flags := namedQueue(in)
	in.table() // arguments: no dead-lettering, no TTL, no max-length here

	return s.decoded(in, task{
		op: control.Op{
			Kind:    mq.KindDeclare,
			Target:  name,
			Payload: mq.Declare{Passive: flags.at(declarePassive)},
		},
		channel: number,
		cause:   queueDeclare,
		answer:  answered(queueDeclareOk, flags.at(declareNoWait)),
	})
}

func (s *session) bindQueue(number uint16, in *reader) error {
	in.short() // reserved
	name := in.shortstr()
	exchange := in.shortstr()
	routingKey := in.shortstr()
	flags := in.bits()
	in.table() // arguments, which only a headers exchange would read

	return s.decoded(in, task{
		op: control.Op{
			Kind:    mq.KindBind,
			Target:  name,
			Payload: mq.Bind{Exchange: exchange, RoutingKey: routingKey},
		},
		channel: number,
		cause:   queueBind,
		answer:  answered(queueBindOk, flags.at(bindNoWait)),
	})
}

func (s *session) purgeQueue(number uint16, in *reader) error {
	name, flags := namedQueue(in)

	return s.decoded(in, task{
		op:      control.Op{Kind: mq.KindPurge, Target: name},
		channel: number,
		cause:   queuePurge,
		answer:  answered(queuePurgeOk, flags.at(purgeNoWait)),
	})
}

func (s *session) deleteQueue(number uint16, in *reader) error {
	name, flags := namedQueue(in)

	return s.decoded(in, task{
		op:      control.Op{Kind: mq.KindDelete, Target: name},
		channel: number,
		cause:   queueDelete,
		answer:  answered(queueDeleteOk, flags.at(deleteNoWait)),
	})
}

// setQos limits how much a channel may hold unacknowledged, which is the whole
// of "give the next message to whichever worker is free".
//
// The count is applied per channel whether or not the client set `global`. The
// distinction only shows up with several consumers on one channel, and the
// pattern every lesson uses — one consumer, one channel — makes the two
// readings identical. A prefetch in *bytes* is refused rather than ignored:
// RabbitMQ does not implement it either, and a limit that silently did nothing
// would be a lesson about backpressure that has none.
func (s *session) setQos(number uint16, in *reader) error {
	size := in.long()
	count := in.short()
	in.bits() // global

	if size != 0 {
		return s.unsupported(number, basicQos)
	}
	return s.decoded(in, task{
		op:      control.Op{Kind: mq.KindQos, Payload: mq.Qos{Channel: number, Prefetch: int(count)}},
		channel: number,
		cause:   basicQos,
		answer:  basicQosOk, // the one method here that has no no-wait flag
	})
}

func (s *session) consume(number uint16, in *reader) error {
	in.short() // reserved
	name := in.shortstr()
	tag := in.shortstr()
	flags := in.bits()
	in.table() // arguments, which emu has no consumer priority to read

	return s.decoded(in, task{
		op: control.Op{
			Kind:   mq.KindConsume,
			Target: name,
			Payload: mq.Consume{
				Tag:     tag,
				Sink:    s.deliveries,
				Channel: number,
				NoAck:   flags.at(consumeNoAck),
			},
		},
		channel: number,
		cause:   basicConsume,
		answer:  answered(basicConsumeOk, flags.at(consumeNoWait)),
	})
}

func (s *session) cancel(number uint16, in *reader) error {
	tag := in.shortstr()
	flags := in.bits()

	return s.decoded(in, task{
		op: control.Op{
			Kind:    mq.KindCancel,
			Target:  s.channels[number].consumers[tag],
			Payload: mq.Cancel{Tag: tag},
		},
		channel: number,
		cause:   basicCancel,
		answer:  answered(basicCancelOk, flags.at(cancelNoWait)),
	})
}

// publish is only the first third of a published message. There is no operation
// to hand over until the content header and the body have arrived too.
func (s *session) publish(number uint16, in *reader) error {
	in.short() // reserved
	exchange := in.shortstr()
	routingKey := in.shortstr()
	flags := in.bits()

	switch {
	case !in.done():
		return s.fatal(codeSyntaxError, basicPublish, "Basic.Publish ran off the end of its frame")
	case s.pending != nil:
		return s.fatal(codeUnexpectedFrame, basicPublish, "a second Basic.Publish arrived before the first one's content")
	}

	s.pending = &publishing{
		channel:   number,
		message:   mq.Message{Exchange: exchange, RoutingKey: routingKey},
		mandatory: flags.at(publishMandatory),
	}
	return nil
}

func (s *session) contentHeader(received frame) error {
	if s.pending == nil || s.pending.channel != received.channel {
		return s.fatal(codeUnexpectedFrame, noMethod, "a content header arrived with no Basic.Publish waiting for it")
	}

	in := &reader{data: received.payload}
	class := in.short()
	in.short() // weight, which the specification has never used
	size := in.longlong()
	// The property block is carried on as it arrived: content type, headers,
	// reply-to and the rest are the publisher's to state and the consumer's to
	// read, and emu is neither.
	properties := in.rest()

	if !in.done() || class != basicClass {
		return s.fatal(codeSyntaxError, noMethod, "a content header for class %d is not one Basic.Publish can carry", class)
	}
	s.pending.bodySize = size
	s.pending.message.Properties = properties
	return s.publishComplete()
}

func (s *session) contentBody(received frame) error {
	if s.pending == nil || s.pending.channel != received.channel {
		return s.fatal(codeUnexpectedFrame, noMethod, "a content body arrived with no Basic.Publish waiting for it")
	}

	s.pending.message.Body = append(s.pending.message.Body, received.payload...)
	if uint64(len(s.pending.message.Body)) > s.pending.bodySize {
		return s.fatal(codeFrameError, noMethod, "a message body is longer than the %d bytes its header announced", s.pending.bodySize)
	}
	return s.publishComplete()
}

func (s *session) publishComplete() error {
	if uint64(len(s.pending.message.Body)) < s.pending.bodySize {
		return nil
	}

	arrived := s.pending
	s.pending = nil
	s.stage(task{
		op: control.Op{
			Kind:    mq.KindPublish,
			Target:  arrived.message.RoutingKey,
			Payload: mq.Publish{Message: arrived.message, Mandatory: arrived.mandatory},
		},
		channel: arrived.channel,
		cause:   basicPublish,
		answer:  noReply,
	})
	return nil
}

func (s *session) get(number uint16, in *reader) error {
	name, flags := namedQueue(in)

	return s.decoded(in, task{
		op: control.Op{
			Kind:    mq.KindGet,
			Target:  name,
			Payload: mq.Get{Channel: number, NoAck: flags.at(getNoAck)},
		},
		channel: number,
		cause:   basicGet,
		answer:  basicGetOk,
	})
}

// settle decodes Basic.Ack and Basic.Nack, which carry the same arguments up to
// the requeue flag that only a nack has.
func (s *session) settle(number uint16, in *reader, kind string) error {
	tag := in.longlong()
	flags := in.bits()
	multiple := flags.at(ackMultiple)

	next := task{
		op:      control.Op{Kind: kind, Target: s.fromQueue[tag]},
		channel: number,
		cause:   basicAck,
		answer:  noReply,
	}
	if kind == mq.KindNack {
		next.cause = basicNack
		next.op.Payload = mq.Nack{
			Tag: tag, Channel: number,
			Multiple: flags.at(nackMultiple), Requeue: flags.at(nackRequeue),
		}
	} else {
		next.op.Payload = mq.Ack{Tag: tag, Channel: number, Multiple: multiple}
	}

	s.forget(tag, multiple)
	return s.decoded(in, next)
}

// reject is Basic.Nack for exactly one delivery, which is what AMQP had before
// it had Basic.Nack.
func (s *session) reject(number uint16, in *reader) error {
	tag := in.longlong()
	flags := in.bits()

	next := task{
		op: control.Op{
			Kind:    mq.KindNack,
			Target:  s.fromQueue[tag],
			Payload: mq.Nack{Tag: tag, Channel: number, Requeue: flags.at(rejectRequeue)},
		},
		channel: number,
		cause:   basicReject,
		answer:  noReply,
	}
	s.forget(tag, false)
	return s.decoded(in, next)
}

// selectConfirms turns publisher confirms on. It never reaches the backend:
// whether a publisher is told its message landed is between the codec and the
// client, and the queues are the same either way.
//
// It matters more here than it does against a real broker. Basic.Publish is
// asynchronous, so a client that is not in confirm mode does not wait for
// anything and learns that a publish was refused only at its next synchronous
// call. Confirm mode is what makes "the hundred and first publish fails" fail
// on the hundred and first publish.
func (s *session) selectConfirms(number uint16, in *reader) error {
	flags := in.bits()
	if !in.done() {
		return s.fatal(codeSyntaxError, confirmSelect, "Confirm.Select ran off the end of its frame")
	}

	s.channels[number].confirms = true
	if flags.at(confirmNoWait) {
		return nil
	}
	s.send(frame{kind: frameMethod, channel: number, payload: encode(confirmSelectOk).out})
	return s.flush()
}
