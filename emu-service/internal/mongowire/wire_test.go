package mongowire

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// A frame emu cannot read is a client that has lost the boundary between one
// message and the next, and carrying on would be reading garbage. Every one of
// these says which part it could not read.

func encoded(t *testing.T, document bson.D) []byte {
	t.Helper()

	raw, err := bson.Marshal(document)
	if err != nil {
		t.Fatalf("marshalling %v: %v", document, err)
	}
	return raw
}

func body(sections ...[]byte) []byte {
	return append([]byte{0, 0, 0, 0}, bytes.Join(sections, nil)...)
}

func bodySection(document []byte) []byte {
	return append([]byte{sectionBody}, document...)
}

func sequenceSection(name string, documents ...[]byte) []byte {
	inner := append([]byte(name), 0)
	inner = append(inner, bytes.Join(documents, nil)...)

	section := make([]byte, 5, 5+len(inner))
	section[0] = sectionSequence
	binary.LittleEndian.PutUint32(section[1:], uint32(4+len(inner)))
	return append(section, inner...)
}

func framed(opCode int32, payload []byte) []byte {
	frame := make([]byte, headerSize, headerSize+len(payload))
	binary.LittleEndian.PutUint32(frame[0:], uint32(headerSize+len(payload)))
	binary.LittleEndian.PutUint32(frame[12:], uint32(opCode))
	return append(frame, payload...)
}

func TestAMessageIsReadOffItsOwnLength(t *testing.T) {
	payload := body(bodySection(encoded(t, bson.D{mongocmd.Field("ping", int32(1))})))

	message, read, err := readMessage(bytes.NewReader(framed(opMsg, payload)))

	if err != nil || message.opCode != opMsg || !bytes.Equal(read, payload) {
		t.Errorf("readMessage = %+v, %v", message, err)
	}
}

func TestAMessageThatIsNotOneIsRefused(t *testing.T) {
	oversized := make([]byte, headerSize)
	binary.LittleEndian.PutUint32(oversized, uint32(maxMessageSizeBytes+1))
	tooSmall := make([]byte, headerSize)
	binary.LittleEndian.PutUint32(tooSmall, 4)

	for _, want := range []struct {
		frame  []byte
		blamed string
	}{
		{nil, "EOF"},
		{oversized, "is not one"},
		{tooSmall, "is not one"},
		{framed(opMsg, make([]byte, 8))[:headerSize+2], "EOF"},
	} {
		_, _, err := readMessage(bytes.NewReader(want.frame))

		if err == nil || !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("readMessage(%d bytes) = %v, want %q", len(want.frame), err, want.blamed)
		}
	}
}

// A driver puts the bulk of a write in a document sequence beside the command
// rather than inside it, so a server that only reads the body sees an insert of
// nothing.
func TestADocumentSequenceIsFoldedBackIntoTheCommand(t *testing.T) {
	command := encoded(t, bson.D{mongocmd.Field("insert", "orders")})
	first := encoded(t, bson.D{mongocmd.Field("sku", "a")})
	second := encoded(t, bson.D{mongocmd.Field("sku", "b")})

	// The sequence before the body, because the sections may arrive either way
	// round and only the body says which command they belong to.
	document, silent, err := decodeMsg(body(sequenceSection("documents", first, second), bodySection(command)))

	if err != nil || silent {
		t.Fatalf("decodeMsg = %v, %v", err, silent)
	}
	documents, present := mongocmd.Lookup(document, "documents")
	if !present || len(documents.(bson.A)) != 2 {
		t.Errorf("decodeMsg = %v, want both documents under their field", document)
	}
}

// An unacknowledged write sets moreToCome and then reads nothing, so a reply to
// it would be read as the answer to the client's next command.
func TestMoreToComeIsReportedSoNothingIsRepliedTo(t *testing.T) {
	payload := body(bodySection(encoded(t, bson.D{mongocmd.Field("insert", "orders")})))
	binary.LittleEndian.PutUint32(payload, flagMoreToCome)

	_, silent, err := decodeMsg(payload)

	if err != nil || !silent {
		t.Errorf("decodeMsg = %v, %v, want it marked silent", silent, err)
	}
}

// emu never asks for a checksum. Validating a client's would only report that a
// loopback socket inside a sandbox flipped a bit.
func TestAChecksumIsAcceptedAndIgnored(t *testing.T) {
	payload := body(bodySection(encoded(t, bson.D{mongocmd.Field("ping", int32(1))})))
	binary.LittleEndian.PutUint32(payload, flagChecksumPresent)
	payload = append(payload, 1, 2, 3, 4)

	document, _, err := decodeMsg(payload)

	if err != nil || len(document) != 1 || document[0].Key != "ping" {
		t.Errorf("decodeMsg = %v, %v", document, err)
	}
}

func TestAnOpMsgEmuCannotReadIsRefusedByPart(t *testing.T) {
	document := encoded(t, bson.D{mongocmd.Field("ping", int32(1))})

	badLength := append([]byte{}, document...)
	binary.LittleEndian.PutUint32(badLength, 4)

	// A five-byte document is a length and a terminator, so one that ends in
	// anything else is the right length and still not a document.
	unreadable := []byte{5, 0, 0, 0, 5}

	for _, want := range []struct {
		payload []byte
		blamed  string
	}{
		{[]byte{0, 0}, "carries no flags"},
		{[]byte{flagChecksumPresent, 0, 0, 0, 1, 2}, "promised a checksum"},
		{body([]byte{9}), "section kind 9"},
		{body(sequenceSection("documents", document)), "no command in it"},
		{body(bodySection([]byte{1, 2})), "is not a BSON document"},
		{body(bodySection(badLength)), "claiming 4 bytes"},
		{body(bodySection(unreadable)), "reading a document"},
		{body([]byte{sectionSequence, 1, 2}), "is not a document sequence"},
		{body([]byte{sectionSequence, 1, 0, 0, 0}), "sequence claiming 1 bytes"},
		{body(sequenceSectionWithoutName()), "a name with no end"},
		{body(sequenceSection("documents", unreadable)), "reading a document"},
	} {
		_, _, err := decodeMsg(want.payload)

		if err == nil || !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("decodeMsg(%v) = %v, want %q blamed", want.payload, err, want.blamed)
		}
	}
}

// A sequence whose field name never ends runs off the end of its own section.
func sequenceSectionWithoutName() []byte {
	section := make([]byte, 5)
	section[0] = sectionSequence
	binary.LittleEndian.PutUint32(section[1:], 8)
	return append(section, 'a', 'b', 'c', 'd')
}

func TestTheLegacyHandshakeIsReadOffACommandNamespace(t *testing.T) {
	command := encoded(t, bson.D{mongocmd.Field("isMaster", int32(1))})
	payload := append([]byte{0, 0, 0, 0}, append([]byte("admin.$cmd"), 0)...)
	payload = append(payload, make([]byte, 8)...)

	document, err := decodeQuery(append(payload, command...))

	if err != nil || document[0].Key != "isMaster" {
		t.Errorf("decodeQuery = %v, %v", document, err)
	}
}

// A legacy query against a real collection is a driver old enough that emu's
// answers would mislead it.
func TestAnOpQueryEmuWillNotAnswerIsRefused(t *testing.T) {
	collection := append([]byte{0, 0, 0, 0}, append([]byte("shop.orders"), 0)...)
	truncated := append([]byte{0, 0, 0, 0}, append([]byte("admin.$cmd"), 0)...)

	for _, want := range []struct {
		payload []byte
		blamed  string
	}{
		{[]byte{0, 0}, "an OP_QUERY of 2 bytes"},
		{[]byte{0, 0, 0, 0, 'a'}, "a name with no end"},
		{collection, `not "shop.orders"`},
		{truncated, "with no query in it"},
		{append(truncated, make([]byte, 8)...), "is not a BSON document"},
	} {
		_, err := decodeQuery(want.payload)

		if err == nil || !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("decodeQuery(%v) = %v, want %q blamed", want.payload, err, want.blamed)
		}
	}
}

func TestThePortIsTheOneAConnectionStringAlreadyNames(t *testing.T) {
	protocol := New(nil)

	if protocol.Port() != Port || protocol.Name() != name || Port != 27017 {
		t.Errorf("the protocol is %s on %d", protocol.Name(), protocol.Port())
	}
}
