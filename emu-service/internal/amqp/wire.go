package amqp

import (
	"encoding/binary"
	"unicode/utf8"
)

// maxShortString is what a shortstr's single length octet can hold. Almost
// everything emu writes as one arrived as one, but a fault rule's message is
// whatever the lesson author typed, and a reply text too long for its field
// would corrupt the frame rather than merely read oddly.
const maxShortString = 255

// widestField is the largest fixed-width field AMQP has, which is all the
// zeroes a failed read ever has to hand back.
const widestField = 8

var absent = make([]byte, widestField)

// A reader takes AMQP's field types off a method's arguments.
//
// It remembers that a read ran off the end rather than returning an error from
// every one of them: a frame that is short is short, and threading an error
// through fifteen two-line decoders would bury what those decoders say. The
// caller asks once, with done, before trusting anything it read.
type reader struct {
	data      []byte
	at        int
	truncated bool
}

func (r *reader) take(count int) []byte {
	if r.truncated || count < 0 || r.at+count > len(r.data) {
		r.truncated = true
		return absent[:min(count, widestField)]
	}
	taken := r.data[r.at : r.at+count]
	r.at += count
	return taken
}

func (r *reader) octet() uint8     { return r.take(1)[0] }
func (r *reader) short() uint16    { return binary.BigEndian.Uint16(r.take(2)) }
func (r *reader) long() uint32     { return binary.BigEndian.Uint32(r.take(4)) }
func (r *reader) longlong() uint64 { return binary.BigEndian.Uint64(r.take(8)) }
func (r *reader) shortstr() string { return string(r.take(int(r.octet()))) }
func (r *reader) longstr() []byte  { return r.take(int(r.long())) }

// table skips over a field table and hands back its bytes. emu never looks
// inside one: the only tables a client sends are its own properties, a
// declaration's arguments, and a message's headers, and the one that matters is
// carried through to the consumer exactly as it arrived.
func (r *reader) table() []byte { return r.longstr() }

// rest is everything left, which is how a content header's property block is
// taken: the fourteen optional fields are the publisher's business and emu
// hands them on untouched.
func (r *reader) rest() []byte { return r.take(len(r.data) - r.at) }

// done reports that everything read came out of bytes that were really there. A
// method that ran off the end of its frame is a client emu cannot follow, not a
// request it can answer approximately.
func (r *reader) done() bool { return !r.truncated }

// bits is one octet of packed flags. Every method emu decodes has five or fewer,
// so there is never a second octet to carry.
type bits uint8

func (b bits) at(index int) bool { return b&(1<<index) != 0 }

func (r *reader) bits() bits { return bits(r.octet()) }

// A writer lays the same field types back down.
type writer struct{ out []byte }

func (w *writer) octet(value uint8) { w.out = append(w.out, value) }

func (w *writer) short(value uint16) {
	w.out = binary.BigEndian.AppendUint16(w.out, value)
}

func (w *writer) long(value uint32) {
	w.out = binary.BigEndian.AppendUint32(w.out, value)
}

func (w *writer) longlong(value uint64) {
	w.out = binary.BigEndian.AppendUint64(w.out, value)
}

func (w *writer) shortstr(value string) {
	trimmed := clip(value, maxShortString)
	w.octet(uint8(len(trimmed)))
	w.raw([]byte(trimmed))
}

func (w *writer) longstr(value []byte) {
	w.long(uint32(len(value)))
	w.raw(value)
}

func (w *writer) table(value []byte) { w.longstr(value) }

func (w *writer) raw(value []byte) { w.out = append(w.out, value...) }

// flags packs booleans into one octet, lowest bit first, which is the order the
// specification lists a method's own flags in.
func (w *writer) flags(values ...bool) {
	var packed uint8
	for index, value := range values {
		if value {
			packed |= 1 << index
		}
	}
	w.octet(packed)
}

// clip cuts a string to fit a field, on a rune boundary so that what survives is
// still text.
func clip(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut]
}

// fields builds the one field table emu ever writes: what it says about itself
// in Connection.Start. Everything a client sends is carried through as bytes, so
// there is no general encoder here and nothing that could disagree with a
// decoder.
type fields struct{ writer }

func (f *fields) text(key, value string) {
	f.shortstr(key)
	f.octet('S')
	f.longstr([]byte(value))
}

func (f *fields) flag(key string, value bool) {
	f.shortstr(key)
	f.octet('t')
	var set uint8
	if value {
		set = 1
	}
	f.octet(set)
}

func (f *fields) nested(key string, inner *fields) {
	f.shortstr(key)
	f.octet('F')
	f.table(inner.out)
}
