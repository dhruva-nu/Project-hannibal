package pgwire

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgproto3"
)

// Parameters do not arrive as text just because a query is text. psycopg dumps
// an integer straight into four big-endian bytes and says so in the Bind, so a
// server that only reads text sees a query with garbage in it — which is why
// this file exists at all.

// binaryWidths are the fixed-width types, and how many bytes each occupies. They
// share one decoder because sign-extending a big-endian integer is the same work
// at every width.
var binaryWidths = map[uint32]int{
	oidBool: 1,
	oidInt2: 2,
	oidInt4: 4,
	oidInt8: 8,
	oidOID:  4,
}

// textualOIDs are the types whose binary form is simply their characters, so the
// bytes are the value. An unspecified parameter type (0) is here because a client
// that did not say what it sent means "whatever this reads as".
var textualOIDs = map[uint32]bool{
	0:          true,
	oidText:    true,
	oidVarchar: true,
	oidName:    true,
	oidBPChar:  true,
	oidUnknown: true,
	oidJSON:    true,
}

// momentWidths are the date and time types, which arrive in binary as a count
// from the Postgres epoch rather than as anything a person would recognise.
var momentWidths = map[uint32]int{oidDate: 4, oidTimestamp: 8, oidTimestampTZ: 8}

// integerOIDs and realOIDs are the types whose *text* form has to be read as a
// number rather than passed through: SQLite compares '10' to 9 as text and gets
// the wrong answer.
var integerOIDs = map[uint32]bool{oidInt2: true, oidInt4: true, oidInt8: true, oidOID: true}

var realOIDs = map[uint32]bool{oidFloat4: true, oidFloat8: true, oidNumeric: true}

// decodeParams turns one Bind's parameters into the values the backend binds to
// the statement.
func decodeParams(oids []uint32, formats []int16, values [][]byte) ([]any, error) {
	decoded := make([]any, len(values))
	for index, raw := range values {
		if raw == nil {
			continue // a NULL parameter, which stays nil
		}
		value, err := decodeParam(oidAt(oids, index), formatAt(formats, index), raw)
		if err != nil {
			return nil, fmt.Errorf("parameter %d: %w", index+1, err)
		}
		decoded[index] = value
	}
	return decoded, nil
}

func decodeParam(oid uint32, format int16, raw []byte) (any, error) {
	if format == pgproto3.BinaryFormat {
		return decodeBinary(oid, raw)
	}
	return decodeText(oid, raw), nil
}

// oidAt answers 0 — unspecified — for a parameter the client did not type, which
// is what Postgres itself would then infer from the query.
func oidAt(oids []uint32, index int) uint32 {
	if index < len(oids) {
		return oids[index]
	}
	return 0
}

// formatAt reads the Bind's format codes, where none means all text and one
// means that code for every parameter.
func formatAt(formats []int16, index int) int16 {
	switch {
	case len(formats) == 0:
		return pgproto3.TextFormat
	case len(formats) == 1:
		return formats[0]
	case index < len(formats):
		return formats[index]
	default:
		return pgproto3.TextFormat
	}
}

func decodeText(oid uint32, raw []byte) any {
	text := string(raw)
	switch {
	case integerOIDs[oid]:
		if number, err := strconv.ParseInt(text, 10, 64); err == nil {
			return number
		}
	case realOIDs[oid]:
		if number, err := strconv.ParseFloat(text, 64); err == nil {
			return number
		}
	case oid == oidBool:
		return boolValue(text)
	case oid == oidBytea:
		if decoded, err := hex.DecodeString(strings.TrimPrefix(text, `\x`)); err == nil {
			return decoded
		}
	}
	// Anything unreadable as its declared type still reaches the backend as what
	// the client actually sent, which is what the resulting error should say.
	return text
}

func decodeBinary(oid uint32, raw []byte) (any, error) {
	if width, fixed := binaryWidths[oid]; fixed {
		return binaryInteger(raw, width, oid)
	}
	if width, moment := momentWidths[oid]; moment {
		return binaryMoment(raw, width, oid)
	}
	switch {
	case textualOIDs[oid]:
		return string(raw), nil
	case oid == oidBytea:
		return append([]byte(nil), raw...), nil
	case oid == oidFloat4:
		bits, err := binaryBits(raw, 4, oid)
		return float64(math.Float32frombits(uint32(bits))), err
	case oid == oidFloat8:
		bits, err := binaryBits(raw, 8, oid)
		return math.Float64frombits(bits), err
	case oid == oidNumeric:
		return binaryNumeric(raw)
	case oid == oidUUID:
		return binaryUUID(raw)
	case oid == oidJSONB:
		return binaryJSONB(raw)
	default:
		return nil, fmt.Errorf("arrived in binary as type %d, which emu cannot decode — send it as text", oid)
	}
}

// binaryInteger covers bool, int2, int4, int8, and oid in one place: the only
// difference between them is how many bytes to sign-extend from.
func binaryInteger(raw []byte, width int, oid uint32) (any, error) {
	value, err := binarySigned(raw, width, oid)
	if err != nil {
		return nil, err
	}
	if oid == oidBool {
		return boolValue(strconv.FormatInt(value, 10)), nil
	}
	return value, nil
}

// binaryMoment turns a count from the Postgres epoch into the ISO text SQLite
// stores a date in.
func binaryMoment(raw []byte, width int, oid uint32) (any, error) {
	offset, err := binarySigned(raw, width, oid)
	if err != nil {
		return nil, err
	}
	if oid == oidDate {
		return postgresEpoch.AddDate(0, 0, int(offset)).Format(dateLayout), nil
	}
	// Seconds and microseconds separately, because a far-future timestamp in
	// microseconds overflows the nanoseconds a time.Duration counts in.
	const perSecond = 1_000_000
	moment := time.Unix(postgresEpoch.Unix()+offset/perSecond, offset%perSecond*1000).UTC()
	return moment.Format(timestampLayout), nil
}

func binarySigned(raw []byte, width int, oid uint32) (int64, error) {
	bits, err := binaryBits(raw, width, oid)
	if err != nil {
		return 0, err
	}
	shift := 64 - width*8
	return int64(bits<<shift) >> shift, nil
}

func binaryBits(raw []byte, width int, oid uint32) (uint64, error) {
	if len(raw) != width {
		return 0, fmt.Errorf("type %d is %d bytes in binary, got %d", oid, width, len(raw))
	}
	var bits uint64
	for _, part := range raw {
		bits = bits<<8 | uint64(part)
	}
	return bits, nil
}

// boolValue answers 1 or 0, because SQLite has no boolean and comparing a Go
// bool against a column holding 1 would never match.
func boolValue(text string) int64 {
	switch strings.ToLower(text) {
	case "t", "true", "1", "y", "yes", "on":
		return 1
	default:
		return 0
	}
}

// binaryNumeric reads Postgres's base-10000 decimal into a float64. SQLite has
// no exact decimal type, so this is where arbitrary precision is lost — the same
// place it would be lost storing the value.
func binaryNumeric(raw []byte) (any, error) {
	const header = 8
	if len(raw) < header {
		return nil, fmt.Errorf("a binary numeric is at least %d bytes, got %d", header, len(raw))
	}

	digits := int(binary.BigEndian.Uint16(raw))
	weight := int(int16(binary.BigEndian.Uint16(raw[2:])))
	sign := binary.BigEndian.Uint16(raw[4:])
	if len(raw) != header+digits*2 {
		return nil, fmt.Errorf("a binary numeric of %d digits is %d bytes, got %d", digits, header+digits*2, len(raw))
	}
	if sign == 0xC000 {
		return nil, fmt.Errorf("a numeric NaN has no SQLite equivalent")
	}

	value := 0.0
	for index := range digits {
		value += float64(binary.BigEndian.Uint16(raw[header+index*2:])) * math.Pow(10000, float64(weight-index))
	}
	if sign != 0 {
		value = -value
	}
	return value, nil
}

func binaryUUID(raw []byte) (any, error) {
	if len(raw) != 16 {
		return nil, fmt.Errorf("a binary uuid is 16 bytes, got %d", len(raw))
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}

// binaryJSONB carries a version byte the text form does not.
func binaryJSONB(raw []byte) (any, error) {
	if len(raw) < 1 || raw[0] != 1 {
		return nil, fmt.Errorf("a binary jsonb starts with version 1")
	}
	return string(raw[1:]), nil
}
