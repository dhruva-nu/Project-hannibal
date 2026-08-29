package mongowire

import (
	"encoding/binary"
	"fmt"
	"io"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// The opcodes emu speaks. OP_MSG is what every driver written since MongoDB 3.6
// uses for everything, and it is the only one emu answers a command on.
//
// OP_QUERY is here because the handshake still arrives on it. A driver cannot
// know a server accepts OP_MSG until it has asked, and the asking is itself a
// command — so the spec has every driver send its first `hello` the legacy way
// and switch once the reply says `helloOk`. pymongo and the Go driver both do.
// Without those forty lines nothing ever connects.
const (
	opReply = 1
	opQuery = 2004
	opMsg   = 2013
)

// headerSize is the MsgHeader every message on the wire starts with: length,
// request id, what it responds to, and the opcode.
const headerSize = 16

// The limits the handshake promises, and therefore the ones emu has to hold
// itself to. A message longer than it said it would accept is a client that has
// lost the frame boundary, and reading it would be reading garbage.
const (
	maxBSONObjectSize   = 16 * 1024 * 1024
	maxMessageSizeBytes = 48_000_000
	maxWriteBatchSize   = 100_000
)

// OP_MSG's flag bits. checksumPresent puts a CRC after the sections;
// moreToCome on a request means the client is not waiting for a reply, which is
// how an unacknowledged write is sent.
const (
	flagChecksumPresent = 1 << 0
	flagMoreToCome      = 1 << 1
	checksumSize        = 4
)

// The two kinds of section an OP_MSG carries: the command document itself, and a
// named run of documents pulled out of it. Drivers use the second for the bulk
// of a write — an insert's documents travel beside the command rather than
// inside it — so a server that only reads the body sees an insert of nothing.
const (
	sectionBody     = 0
	sectionSequence = 1
)

type header struct {
	length     int32
	requestID  int32
	responseTo int32
	opCode     int32
}

func readMessage(reader io.Reader) (header, []byte, error) {
	var framing [headerSize]byte
	if _, err := io.ReadFull(reader, framing[:]); err != nil {
		return header{}, nil, err
	}

	message := header{
		length:     int32(binary.LittleEndian.Uint32(framing[0:])),
		requestID:  int32(binary.LittleEndian.Uint32(framing[4:])),
		responseTo: int32(binary.LittleEndian.Uint32(framing[8:])),
		opCode:     int32(binary.LittleEndian.Uint32(framing[12:])),
	}
	if message.length < headerSize || message.length > maxMessageSizeBytes {
		return header{}, nil, fmt.Errorf("mongowire: a message claiming %d bytes is not one", message.length)
	}

	body := make([]byte, message.length-headerSize)
	if _, err := io.ReadFull(reader, body); err != nil {
		return header{}, nil, err
	}
	return message, body, nil
}

func writeMessage(writer io.Writer, requestID, responseTo, opCode int32, body []byte) error {
	frame := make([]byte, headerSize+len(body))
	binary.LittleEndian.PutUint32(frame[0:], uint32(len(frame)))
	binary.LittleEndian.PutUint32(frame[4:], uint32(requestID))
	binary.LittleEndian.PutUint32(frame[8:], uint32(responseTo))
	binary.LittleEndian.PutUint32(frame[12:], uint32(opCode))
	copy(frame[headerSize:], body)

	_, err := writer.Write(frame)
	return err
}

// decodeMsg reads an OP_MSG into the one command document it describes, folding
// each document sequence back in as the array field it was lifted out of. The
// sections may arrive in either order, so the body is found before anything is
// appended to it.
func decodeMsg(body []byte) (bson.D, bool, error) {
	if len(body) < 4 {
		return nil, false, fmt.Errorf("mongowire: an OP_MSG of %d bytes carries no flags", len(body))
	}
	flags := binary.LittleEndian.Uint32(body)
	body = body[4:]

	if flags&flagChecksumPresent != 0 {
		// emu never asks for a checksum and never sends one. Validating a client's
		// would only report that a loopback socket inside a sandbox flipped a bit.
		if len(body) < checksumSize {
			return nil, false, fmt.Errorf("mongowire: an OP_MSG promised a checksum and carries none")
		}
		body = body[:len(body)-checksumSize]
	}

	command, sequences, err := readSections(body)
	if err != nil {
		return nil, false, err
	}
	if command == nil {
		return nil, false, fmt.Errorf("mongowire: an OP_MSG with no command in it")
	}
	return append(command, sequences...), flags&flagMoreToCome != 0, nil
}

func readSections(body []byte) (command bson.D, sequences []bson.E, err error) {
	for len(body) > 0 {
		kind := body[0]
		body = body[1:]

		switch kind {
		case sectionBody:
			if command, body, err = takeDocument(body); err != nil {
				return nil, nil, err
			}
		case sectionSequence:
			var sequence bson.E
			if sequence, body, err = takeSequence(body); err != nil {
				return nil, nil, err
			}
			sequences = append(sequences, sequence)
		default:
			return nil, nil, fmt.Errorf("mongowire: section kind %d is not one emu knows", kind)
		}
	}
	return command, sequences, nil
}

// takeDocument reads one BSON document off the front, which is possible only
// because a document begins with its own length.
func takeDocument(body []byte) (bson.D, []byte, error) {
	if len(body) < 4 {
		return nil, nil, fmt.Errorf("mongowire: %d bytes is not a BSON document", len(body))
	}
	length := int(int32(binary.LittleEndian.Uint32(body)))
	if length < 5 || length > len(body) {
		return nil, nil, fmt.Errorf("mongowire: a document claiming %d bytes of %d", length, len(body))
	}

	var document bson.D
	if err := bson.Unmarshal(body[:length], &document); err != nil {
		return nil, nil, fmt.Errorf("mongowire: reading a document: %w", err)
	}
	return document, body[length:], nil
}

// takeSequence reads a document sequence: its own length, the field name it
// belongs under, and then documents until that length runs out.
func takeSequence(body []byte) (bson.E, []byte, error) {
	if len(body) < 4 {
		return bson.E{}, nil, fmt.Errorf("mongowire: %d bytes is not a document sequence", len(body))
	}
	size := int(int32(binary.LittleEndian.Uint32(body)))
	if size < 5 || size > len(body) {
		return bson.E{}, nil, fmt.Errorf("mongowire: a sequence claiming %d bytes of %d", size, len(body))
	}

	section, rest := body[4:size], body[size:]
	name, section, err := takeCString(section)
	if err != nil {
		return bson.E{}, nil, err
	}

	documents := bson.A{}
	for len(section) > 0 {
		var document bson.D
		if document, section, err = takeDocument(section); err != nil {
			return bson.E{}, nil, err
		}
		documents = append(documents, document)
	}
	return mongocmd.Field(name, documents), rest, nil
}

func takeCString(body []byte) (string, []byte, error) {
	for index, character := range body {
		if character == 0 {
			return string(body[:index]), body[index+1:], nil
		}
	}
	return "", nil, fmt.Errorf("mongowire: a name with no end to it")
}

// decodeQuery reads the legacy OP_QUERY the handshake arrives on. Only a command
// namespace is accepted: a legacy query against a real collection is a driver
// old enough that emu's answers would mislead it, and saying so beats guessing.
func decodeQuery(body []byte) (bson.D, error) {
	const preamble = 4 // flags, which say nothing a handshake needs

	if len(body) < preamble {
		return nil, fmt.Errorf("mongowire: an OP_QUERY of %d bytes", len(body))
	}
	namespace, rest, err := takeCString(body[preamble:])
	if err != nil {
		return nil, err
	}
	if !isCommandNamespace(namespace) {
		return nil, fmt.Errorf("mongowire: emu answers OP_QUERY only on <db>.$cmd, not %q", namespace)
	}

	const skipAndReturn = 8
	if len(rest) < skipAndReturn {
		return nil, fmt.Errorf("mongowire: an OP_QUERY on %s with no query in it", namespace)
	}
	command, _, err := takeDocument(rest[skipAndReturn:])
	return command, err
}

func isCommandNamespace(namespace string) bool {
	const suffix = ".$cmd"
	return len(namespace) > len(suffix) && namespace[len(namespace)-len(suffix):] == suffix
}

// encodeMsg frames a reply as the one body section an OP_MSG reply ever has.
func encodeMsg(document []byte) []byte {
	body := make([]byte, 0, 5+len(document))
	body = append(body, 0, 0, 0, 0) // no flags: emu never streams a reply
	body = append(body, sectionBody)
	return append(body, document...)
}

// encodeReply frames a reply the legacy way, which is what an OP_QUERY handshake
// is waiting for.
func encodeReply(document []byte) []byte {
	// Response flags, cursor id, and startingFrom are all zero for a handshake
	// reply; numberReturned is the one field that has to say anything.
	const preamble = 20
	body := make([]byte, preamble, preamble+len(document))
	binary.LittleEndian.PutUint32(body[16:], 1)
	return append(body, document...)
}
