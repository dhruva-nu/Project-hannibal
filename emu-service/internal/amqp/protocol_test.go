package amqp

import (
	"bufio"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/queues"
)

// These tests speak the protocol by hand, for the frames a real client would
// never send and the answers a real client hides. Everything a working client
// does is covered in amqp_test.go instead, against a working client.

type rawClient struct {
	t    *testing.T
	conn net.Conn
	in   *bufio.Reader
}

func dialRaw(t *testing.T, address string) *rawClient {
	t.Helper()

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	client := &rawClient{t: t, conn: conn, in: bufio.NewReader(conn)}
	client.write(protocolHeader)
	return client
}

func (c *rawClient) write(raw []byte) {
	c.t.Helper()

	if _, err := c.conn.Write(raw); err != nil {
		c.t.Fatalf("writing: %v", err)
	}
}

func (c *rawClient) send(sending frame) { c.write(encodeFrame(sending)) }

func (c *rawClient) method(number uint16, out *writer) {
	c.send(frame{kind: frameMethod, channel: number, payload: out.out})
}

func (c *rawClient) receive() frame {
	c.t.Helper()

	_ = c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	received, err := readFrame(c.in, proposedFrameMax)
	if err != nil {
		c.t.Fatalf("reading: %v", err)
	}
	return received
}

func (c *rawClient) expect(wanted methodID) *reader {
	c.t.Helper()

	received := c.receive()
	id, arguments := decode(received.payload)
	if received.kind != frameMethod || id != wanted {
		c.t.Fatalf("got a type %d frame carrying %d.%d, want %d.%d",
			received.kind, id.class(), id.method(), wanted.class(), wanted.method())
	}
	return arguments
}

// hungUp reports what emu said before dropping the connection.
func (c *rawClient) hungUp() (uint16, string) {
	c.t.Helper()

	arguments := c.expect(connectionClose)
	code := arguments.short()
	reason := arguments.shortstr()
	if _, err := readFrame(c.in, proposedFrameMax); err == nil {
		c.t.Fatal("the connection is still open after a Connection.Close")
	}
	return code, reason
}

// refused reports the channel exception emu answered with.
func (c *rawClient) refused() (uint16, string) {
	c.t.Helper()

	arguments := c.expect(channelClose)
	code := arguments.short()
	return code, arguments.shortstr()
}

func (c *rawClient) startOk() {
	c.expect(connectionStart)
	out := encode(connectionStartOk)
	out.table(nil)
	out.shortstr("PLAIN")
	out.longstr([]byte("\x00guest\x00guest"))
	out.shortstr("en_US")
	c.method(0, out)
}

func (c *rawClient) tuneOk(frameMax uint32, heartbeat uint16) {
	c.expect(connectionTune)
	out := encode(connectionTuneOk)
	out.short(proposedChannelMax)
	out.long(frameMax)
	out.short(heartbeat)
	c.method(0, out)
}

func (c *rawClient) openConnection() {
	out := encode(connectionOpen)
	out.shortstr("/")
	out.shortstr("")
	out.flags(false)
	c.method(0, out)
	c.expect(connectionOpenOk)
}

// handshake takes a raw client to the point where it can open a channel.
func (c *rawClient) handshake() {
	c.t.Helper()

	c.startOk()
	c.tuneOk(proposedFrameMax, 0)
	c.openConnection()
}

func (c *rawClient) openChannel(number uint16) {
	c.t.Helper()

	out := encode(channelOpen)
	out.shortstr("")
	c.method(number, out)
	c.expect(channelOpenOk)
}

// connected is a raw client on an emulator with nothing seeded and no rules.
func connected(t *testing.T) *rawClient {
	t.Helper()

	address, _ := serve(t, "", nil)
	client := dialRaw(t, address)
	client.handshake()
	client.openChannel(1)
	return client
}

func TestAProtocolEmuDoesNotSpeakIsAnsweredWithTheOneItDoes(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if _, err := conn.Write([]byte("AMQP\x01\x01\x00\x09")); err != nil {
		t.Fatalf("writing: %v", err)
	}

	answer := make([]byte, len(protocolHeader))
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Read(answer); err != nil {
		t.Fatalf("reading: %v", err)
	}
	if string(answer) != string(protocolHeader) {
		t.Errorf("answered %q, want the header emu does speak", answer)
	}
}

func TestAHandshakeThatEndsEarlyEndsTheConnection(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}

	// Half a protocol header and then nothing.
	if _, err := conn.Write(protocolHeader[:4]); err != nil {
		t.Fatalf("writing: %v", err)
	}
	_ = conn.Close()
}

func TestTheHandshakeAcceptsNothingButTheMethodItIsWaitingFor(t *testing.T) {
	t.Run("a frame on the wrong channel", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.expect(connectionStart)
		client.send(frame{kind: frameHeartbeat, channel: 4})
		client.gone()
	})

	t.Run("the wrong method", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.expect(connectionStart)
		client.method(0, encode(connectionTuneOk))
		client.gone()
	})

	t.Run("a Tune-Ok that ran short", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.startOk()
		client.expect(connectionTune)
		client.method(0, encode(connectionTuneOk))
		client.gone()
	})

	t.Run("a frame maximum under the floor", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.startOk()
		client.tuneOk(minimumFrameMax-1, 0)
		client.gone()
	})

	t.Run("no Connection.Open at all", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.startOk()
		client.tuneOk(proposedFrameMax, 0)
		client.method(0, encode(connectionCloseOk))
		client.gone()
	})
}

// gone waits for emu to hang up without saying anything more.
func (c *rawClient) gone() {
	c.t.Helper()

	_ = c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := readFrame(c.in, proposedFrameMax); err == nil {
		c.t.Fatal("emu carried on with a handshake it should have abandoned")
	}
}

func addressOf(t *testing.T) string {
	t.Helper()

	address, _ := serve(t, "", nil)
	return address
}

func TestAClientMayLowerTheFrameSizeOrLeaveItToEmu(t *testing.T) {
	for name, frameMax := range map[string]uint32{
		"zero means whatever emu proposed": 0,
		"more than emu proposed is capped": proposedFrameMax * 2,
		"less than emu proposed is taken":  minimumFrameMax,
	} {
		t.Run(name, func(t *testing.T) {
			client := dialRaw(t, addressOf(t))
			client.startOk()
			client.tuneOk(frameMax, 0)
			client.openConnection()
			client.openChannel(1)
		})
	}
}

func TestAClientThatInsistsOnHeartbeatsGetsThem(t *testing.T) {
	// emu proposes none, because it holds no deadline against anyone. A client
	// that asks for an interval anyway would close the connection if it heard
	// nothing, so the frames go out at half the timeout it named.
	client := dialRaw(t, addressOf(t))
	client.startOk()
	client.tuneOk(proposedFrameMax, 1)
	client.openConnection()

	if beat := client.receive(); beat.kind != frameHeartbeat {
		t.Errorf("got a type %d frame, want a heartbeat", beat.kind)
	}
}

func TestAFrameEmuCannotFollowEndsTheConnection(t *testing.T) {
	for name, expectation := range map[string]struct {
		provoke func(*rawClient)
		code    uint16
		reason  string
	}{
		"a frame type AMQP has never had": {
			func(c *rawClient) { c.send(frame{kind: 5, channel: 1}) }, codeFrameError, "frame type 5",
		},
		"a frame that does not end where it says": {
			func(c *rawClient) { c.write([]byte{frameMethod, 0, 1, 0, 0, 0, 0, 0x00}) }, 0, "",
		},
		"a frame larger than the maximum": {
			func(c *rawClient) { c.write([]byte{frameMethod, 0, 1, 0xFF, 0xFF, 0xFF, 0xFF}) }, 0, "",
		},
		"a method channel 0 does not take": {
			func(c *rawClient) { c.method(0, encode(channelOpen)) }, codeCommandInvalid, "channel 0",
		},
		"an operation on a channel that was never opened": {
			func(c *rawClient) { c.method(9, encode(queueDeclare)) }, codeChannelError, "never opened",
		},
		"opening a channel twice": {
			func(c *rawClient) { c.openChannelWithoutWaiting(1) }, codeChannelError, "already open",
		},
		"a channel number past the agreed maximum": {
			func(c *rawClient) { c.openChannelWithoutWaiting(proposedChannelMax + 1) }, codeChannelError, "past the",
		},
		"a content header with nothing to attach it to": {
			func(c *rawClient) { c.send(frame{kind: frameHeader, channel: 1}) }, codeUnexpectedFrame, "content header",
		},
		"a content body with nothing to attach it to": {
			func(c *rawClient) { c.send(frame{kind: frameBody, channel: 1, payload: []byte("x")}) }, codeUnexpectedFrame, "content body",
		},
		"a method whose arguments ran out": {
			func(c *rawClient) { c.method(1, encode(queueDeclare)) }, codeSyntaxError, "ran off the end",
		},
		"a Basic.Publish whose arguments ran out": {
			func(c *rawClient) { c.method(1, encode(basicPublish)) }, codeSyntaxError, "Basic.Publish ran off",
		},
		"a Confirm.Select whose arguments ran out": {
			func(c *rawClient) { c.method(1, encode(confirmSelect)) }, codeSyntaxError, "Confirm.Select ran off",
		},
	} {
		t.Run(name, func(t *testing.T) {
			client := connected(t)
			expectation.provoke(client)

			if expectation.code == 0 {
				client.gone()
				return
			}
			code, reason := client.hungUp()
			if code != expectation.code || !strings.Contains(reason, expectation.reason) {
				t.Errorf("closed with %d %q, want %d mentioning %q", code, reason, expectation.code, expectation.reason)
			}
		})
	}
}

func (c *rawClient) openChannelWithoutWaiting(number uint16) {
	out := encode(channelOpen)
	out.shortstr("")
	c.method(number, out)
}

func TestAPublishThatDoesNotAddUpEndsTheConnection(t *testing.T) {
	t.Run("a second publish before the first one's content", func(t *testing.T) {
		client := connected(t)
		client.publishMethod(1, "", "jobs")
		client.publishMethod(1, "", "jobs")

		code, reason := client.hungUp()
		if code != codeUnexpectedFrame || !strings.Contains(reason, "second Basic.Publish") {
			t.Errorf("closed with %d %q, want the second publish blamed", code, reason)
		}
	})

	t.Run("a content header for a class that cannot carry one", func(t *testing.T) {
		client := connected(t)
		client.publishMethod(1, "", "jobs")
		header := &writer{}
		header.short(20) // the channel class, which has no content
		header.short(0)
		header.longlong(0)
		client.send(frame{kind: frameHeader, channel: 1, payload: header.out})

		code, _ := client.hungUp()
		if code != codeSyntaxError {
			t.Errorf("closed with %d, want a syntax error", code)
		}
	})

	t.Run("a content header that ran short", func(t *testing.T) {
		client := connected(t)
		client.publishMethod(1, "", "jobs")
		client.send(frame{kind: frameHeader, channel: 1, payload: []byte{0, 60}})

		code, _ := client.hungUp()
		if code != codeSyntaxError {
			t.Errorf("closed with %d, want a syntax error", code)
		}
	})

	t.Run("a body longer than the header announced", func(t *testing.T) {
		client := connected(t)
		client.publishMethod(1, "", "jobs")
		client.sendHeader(1, 1)
		client.send(frame{kind: frameBody, channel: 1, payload: []byte("far too much")})

		code, reason := client.hungUp()
		if code != codeFrameError || !strings.Contains(reason, "longer than") {
			t.Errorf("closed with %d %q, want the body blamed", code, reason)
		}
	})
}

func (c *rawClient) publishMethod(number uint16, exchange, routingKey string) {
	out := encode(basicPublish)
	out.short(0)
	out.shortstr(exchange)
	out.shortstr(routingKey)
	out.flags(false, false)
	c.method(number, out)
}

func (c *rawClient) sendHeader(number uint16, size uint64) {
	header := &writer{}
	header.short(basicClass)
	header.short(0)
	header.longlong(size)
	header.raw(emptyProperties)
	c.send(frame{kind: frameHeader, channel: number, payload: header.out})
}

func TestAMethodEmuNeverImplementedIsRefusedRatherThanIgnored(t *testing.T) {
	client := connected(t)

	// Tx.Select, which emu has no transactions to begin.
	client.method(1, encode(90<<16|10))

	code, reason := client.refused()
	if code != codeNotImplemented || !strings.Contains(reason, "90.10") {
		t.Errorf("refused with %d %q, want the method named", code, reason)
	}
}

func TestAPrefetchInBytesIsRefusedRatherThanIgnored(t *testing.T) {
	client := connected(t)

	out := encode(basicQos)
	out.long(4096) // prefetch-size, which no broker implements
	out.short(0)
	out.flags(false)
	client.method(1, out)

	if code, _ := client.refused(); code != codeNotImplemented {
		t.Errorf("refused with %d, want a prefetch in bytes said to be unimplemented", code)
	}
}

func TestEverythingAfterAChannelExceptionWaitsForTheCloseOk(t *testing.T) {
	address, _ := serve(t, "", nil)
	client := dialRaw(t, address)
	client.handshake()
	client.openChannel(1)

	client.method(1, encode(90<<16|10)) // refused: Tx is not implemented
	if code, _ := client.refused(); code != codeNotImplemented {
		t.Fatal("the channel was not closed")
	}
	client.declareQueue(1, "ignored")      // discarded, because the channel is closing
	client.method(1, encode(channelClose)) // also discarded
	client.method(1, encode(channelCloseOk))

	client.openChannel(1) // the number is free again
	client.declareQueue(1, "jobs")
	client.expect(queueDeclareOk)
}

func (c *rawClient) declareQueue(number uint16, name string) {
	out := encode(queueDeclare)
	out.short(0)
	out.shortstr(name)
	out.flags(false, false, false, false, false)
	out.table(nil)
	c.method(number, out)
}

func TestAClientMayAskNotToBeAnswered(t *testing.T) {
	client := connected(t)

	out := encode(queueDeclare)
	out.short(0)
	out.shortstr("jobs")
	out.flags(false, false, false, false, true) // no-wait
	out.table(nil)
	client.method(1, out)

	// Nothing comes back for the declaration, so the next thing on the wire is
	// the answer to something that did ask for one.
	client.declareQueue(1, "jobs")
	client.expect(queueDeclareOk)
}

func TestAHeartbeatFromTheClientNeedsNoAnswer(t *testing.T) {
	client := connected(t)

	client.send(frame{kind: frameHeartbeat, channel: 0})
	client.declareQueue(1, "jobs")

	client.expect(queueDeclareOk)
}

func TestAClientMayHangUpFromEitherSide(t *testing.T) {
	t.Run("the client says Connection.Close", func(t *testing.T) {
		client := connected(t)
		client.send(closure(0, connectionClose, 200, "goodbye", noMethod))
		client.expect(connectionCloseOk)
		client.gone()
	})

	t.Run("the client answers a Close it was not sent", func(t *testing.T) {
		client := connected(t)
		client.method(0, encode(connectionCloseOk))
		client.gone()
	})
}

func TestAFaultMessageTooLongForItsFieldIsCutRatherThanCorrupting(t *testing.T) {
	// A reply text is a shortstr. The message here is 256 bytes and ends in a
	// two-byte rune, so the cut has to land before it rather than in the middle.
	long := strings.Repeat("x", 254) + "é"
	address, _ := serve(t, "", []control.Rule{
		{Match: "queue.declare", Action: control.ActionError, Message: long},
	})
	client := dialRaw(t, address)
	client.handshake()
	client.openChannel(1)

	client.declareQueue(1, "jobs")

	_, reason := client.refused()
	if reason != strings.Repeat("x", 254) {
		t.Errorf("reply text = %q (%d bytes), want it cut on a rune boundary", reason, len(reason))
	}
}

func TestARuleMayNameTheReplyCodeItWantsAClientToSee(t *testing.T) {
	for name, expectation := range map[string]struct {
		code string
		want uint16
	}{
		"a code the rule named":  {"404", 404},
		"a code that is not one": {"NOT_FOUND", defaultFaultCode},
		"no code at all":         {"", defaultFaultCode},
	} {
		t.Run(name, func(t *testing.T) {
			address, _ := serve(t, "", []control.Rule{
				{Match: "queue.declare", Action: control.ActionError, Code: expectation.code, Message: "refused"},
			})
			client := dialRaw(t, address)
			client.handshake()
			client.openChannel(1)

			client.declareQueue(1, "jobs")

			if code, _ := client.refused(); code != expectation.want {
				t.Errorf("reply code = %d, want %d", code, expectation.want)
			}
		})
	}
}

func TestAFailureNobodyGaveAReplyCodeIsStillReported(t *testing.T) {
	// Nothing in emu produces one today. The branch exists so that a backend
	// which grows a plain error closes the channel rather than the run.
	if code := replyCodeOf(errors.New("something gave way")); code != codeInternalError {
		t.Errorf("reply code = %d, want an internal error", code)
	}
}

func TestEmuAnswersOnTheQueuePortUnderTheNameARuleUses(t *testing.T) {
	protocol := New(queues.New())

	if protocol.Name() != "queue" || protocol.Port() != 5672 {
		t.Errorf("%s on %d, want queue on 5672", protocol.Name(), protocol.Port())
	}
}

func TestAHandshakeTheClientAbandonsMidWayEndsTheConnection(t *testing.T) {
	t.Run("nothing after Start-Ok", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.startOk()
		client.expect(connectionTune)
		client.halfClose()
		client.gone()
	})

	t.Run("the wrong method where Tune-Ok belongs", func(t *testing.T) {
		client := dialRaw(t, addressOf(t))
		client.startOk()
		client.expect(connectionTune)
		client.method(0, encode(connectionCloseOk))
		client.gone()
	})
}

func TestAFrameThatStopsPartWayThroughEndsTheConnection(t *testing.T) {
	client := connected(t)

	// A header promising ten bytes of method, and then nothing at all.
	client.write([]byte{frameMethod, 0, 1, 0, 0, 0, 10})
	client.halfClose()

	client.gone()
}

// halfClose stops writing without stopping reading, so that emu sees the client
// go quiet while the test can still see what emu did about it.
func (c *rawClient) halfClose() {
	c.t.Helper()

	if err := c.conn.(*net.TCPConn).CloseWrite(); err != nil {
		c.t.Fatalf("half-closing: %v", err)
	}
}

func (c *rawClient) publishBody(number uint16, routingKey, body string) {
	c.t.Helper()

	c.publishMethod(number, "", routingKey)
	c.sendHeader(number, uint64(len(body)))
	c.send(frame{kind: frameBody, channel: number, payload: []byte(body)})
}

func (c *rawClient) consumeFrom(number uint16, name, tag string) {
	c.t.Helper()

	out := encode(basicConsume)
	out.short(0)
	out.shortstr(name)
	out.shortstr(tag)
	out.flags(false, false, false, false)
	out.table(nil)
	c.method(number, out)
	c.expect(basicConsumeOk)
}

func TestAClientMayTurnConfirmsOnWithoutWaitingToBeToldItDid(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	client := dialRaw(t, address)
	client.handshake()
	client.openChannel(1)

	out := encode(confirmSelect)
	out.flags(true) // no-wait
	client.method(1, out)
	client.publishBody(1, "jobs", "x")

	// No Confirm.Select-Ok, but the publish is still confirmed.
	arguments := client.expect(basicAck)
	if sequence := arguments.longlong(); sequence != 1 {
		t.Errorf("confirmed publish %d, want the first", sequence)
	}
}

func TestAFaultOnACancellationLeavesTheChannelShutAndItsDeliveriesDropped(t *testing.T) {
	// A rule that fails cancellations stops the teardown a faulted operation
	// starts. emu must not talk over the channel exception it already sent, and
	// must not write a delivery to a channel the client has been told is gone.
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, []control.Rule{
		{Match: "queue.ack", Action: control.ActionError, Message: "no acknowledgements today"},
		{Match: "queue.cancel", Action: control.ActionError, Message: "and no cancellations either"},
	})
	client := dialRaw(t, address)
	client.handshake()
	client.openChannel(1)
	client.openChannel(2)
	client.consumeFrom(1, "jobs", "worker")

	client.publishBody(2, "jobs", "a")
	delivered := client.expect(basicDeliver)
	delivered.shortstr()
	tag := delivered.longlong()
	client.receive() // the content header
	client.receive() // the body

	out := encode(basicAck)
	out.longlong(tag)
	out.flags(false)
	client.method(1, out)
	if code, _ := client.refused(); code != defaultFaultCode {
		t.Fatalf("channel 1 closed with %d, want the rule's own code", code)
	}

	client.publishBody(2, "jobs", "b")
	client.declareQueue(2, "jobs")

	// The next thing on the wire is the answer to the declaration: nothing more
	// was said about channel 1, and nothing was delivered on it.
	client.expect(queueDeclareOk)
}
