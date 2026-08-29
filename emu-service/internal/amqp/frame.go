package amqp

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
)

// The frame types AMQP 0-9-1 has. Everything on the wire is one of these four.
const (
	frameMethod    byte = 1
	frameHeader    byte = 2
	frameBody      byte = 3
	frameHeartbeat byte = 8
)

// frameEnd terminates every frame. It exists so that a peer that has lost sync
// can find the next boundary, and emu treats a frame that does not carry it as
// exactly that: a stream it can no longer follow.
const frameEnd byte = 0xCE

// frameOverhead is the type octet, the channel, the size, and the end octet —
// the bytes a frame costs beyond its payload.
const (
	frameHeaderSize = 7
	frameOverhead   = frameHeaderSize + 1
)

// protocolHeader is what a client opens the connection with, and what emu
// answers a mismatch with so that the client can see which version it reached.
var protocolHeader = []byte{'A', 'M', 'Q', 'P', 0, 0, 9, 1}

type frame struct {
	kind    byte
	channel uint16
	payload []byte
}

// readFrame reads one frame, refusing anything larger than the maximum the two
// sides agreed on. Without that a client could ask emu to allocate four
// gigabytes by writing seven bytes, and the sandbox's memory limit is shared
// with the student's own process.
func readFrame(from *bufio.Reader, limit uint32) (frame, error) {
	head := make([]byte, frameHeaderSize)
	if _, err := io.ReadFull(from, head); err != nil {
		return frame{}, err
	}

	size := binary.BigEndian.Uint32(head[3:])
	if size > limit {
		return frame{}, fmt.Errorf("amqp: a %d byte frame is over the %d byte maximum", size, limit)
	}

	body := make([]byte, size+1) // the frame-end octet rides along
	if _, err := io.ReadFull(from, body); err != nil {
		return frame{}, err
	}
	if body[size] != frameEnd {
		return frame{}, fmt.Errorf("amqp: a frame ended with %#x rather than %#x", body[size], frameEnd)
	}

	return frame{kind: head[0], channel: binary.BigEndian.Uint16(head[1:3]), payload: body[:size]}, nil
}

// encodeFrame lays a frame out as the one write it should be. Building the
// bytes rather than writing them in pieces is what lets the session ignore
// write errors until it flushes, the way every buffered writer is meant to be
// used.
func encodeFrame(sending frame) []byte {
	out := make([]byte, 0, frameOverhead+len(sending.payload))
	out = append(out, sending.kind)
	out = binary.BigEndian.AppendUint16(out, sending.channel)
	out = binary.BigEndian.AppendUint32(out, uint32(len(sending.payload)))
	out = append(out, sending.payload...)
	return append(out, frameEnd)
}
