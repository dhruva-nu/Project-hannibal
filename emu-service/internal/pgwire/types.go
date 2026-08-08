package pgwire

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// The Postgres type OIDs emu speaks. They are constants in the catalogue and
// have not changed since the protocol did, so naming them beats a dependency.
const (
	oidBool        = 16
	oidBytea       = 17
	oidName        = 19
	oidInt8        = 20
	oidInt2        = 21
	oidInt4        = 23
	oidText        = 25
	oidOID         = 26
	oidJSON        = 114
	oidFloat4      = 700
	oidFloat8      = 701
	oidUnknown     = 705
	oidBPChar      = 1042
	oidVarchar     = 1043
	oidDate        = 1082
	oidTimestamp   = 1114
	oidTimestampTZ = 1184
	oidNumeric     = 1700
	oidUUID        = 2950
	oidJSONB       = 3802
)

// oids maps what a backend says a column holds onto the type a client decodes it
// as. Integers are advertised as int8, not int4: SQLite's integers are 64-bit,
// and a column holding a value larger than int4 would otherwise be described to
// the client as a type that cannot contain it.
var oids = map[emulator.Type]uint32{
	emulator.TypeText:      oidText,
	emulator.TypeInteger:   oidInt8,
	emulator.TypeFloat:     oidFloat8,
	emulator.TypeBool:      oidBool,
	emulator.TypeTimestamp: oidTimestamp,
	emulator.TypeBytes:     oidBytea,
}

// widths are what Postgres reports as a type's storage size, negative meaning
// variable. A client is entitled to the answer even though nothing here uses it.
var widths = map[uint32]int16{
	oidBool:      1,
	oidInt8:      8,
	oidFloat8:    8,
	oidTimestamp: 8,
}

// The ISO layouts Postgres writes dates and timestamps in, which are also what
// SQLite reads one back out of.
const (
	timestampLayout = "2006-01-02 15:04:05.999999"
	dateLayout      = "2006-01-02"
)

// postgresEpoch is where the protocol counts dates and timestamps from.
var postgresEpoch = time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC)

func oidFor(kind emulator.Type) uint32 {
	if oid, known := oids[kind]; known {
		return oid
	}
	return oidText
}

func widthOf(oid uint32) int16 {
	if width, known := widths[oid]; known {
		return width
	}
	return -1
}

// encodeRow renders one row in the protocol's text format, where a nil field is
// SQL NULL rather than an empty string.
func encodeRow(columns []emulator.Column, row []any) [][]byte {
	encoded := make([][]byte, len(row))
	for index, value := range row {
		if value != nil {
			encoded[index] = []byte(encode(columns[index].Type, value))
		}
	}
	return encoded
}

func encode(kind emulator.Type, value any) string {
	switch kind {
	case emulator.TypeBool:
		return boolText(value)
	case emulator.TypeBytes:
		return byteaText(value)
	case emulator.TypeTimestamp:
		return timestampText(value)
	default:
		return plainText(value)
	}
}

// boolText answers what Postgres writes for a boolean. SQLite has no boolean
// type and stores 1 and 0, so the column's declaration is the only thing that
// makes a client see True rather than 1.
func boolText(value any) string {
	if truthy(value) {
		return "t"
	}
	return "f"
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case string:
		return typed == "t" || typed == "true" || typed == "1"
	default:
		return false
	}
}

// byteaText is the hex format every Postgres since 9.0 writes binary in.
func byteaText(value any) string {
	switch typed := value.(type) {
	case []byte:
		return `\x` + hex.EncodeToString(typed)
	case string:
		return `\x` + hex.EncodeToString([]byte(typed))
	default:
		return plainText(value)
	}
}

func timestampText(value any) string {
	if moment, ok := value.(time.Time); ok {
		return moment.Format(timestampLayout)
	}
	return plainText(value)
}

func plainText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'g', -1, 64)
	default:
		return fmt.Sprint(value)
	}
}
