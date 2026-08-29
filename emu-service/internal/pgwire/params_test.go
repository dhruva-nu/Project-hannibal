package pgwire

import (
	"encoding/binary"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgproto3"
)

func binaryFormats(count int) []int16 {
	formats := make([]int16, count)
	for index := range formats {
		formats[index] = pgproto3.BinaryFormat
	}
	return formats
}

func bytesOf(value uint64, width int) []byte {
	raw := make([]byte, 8)
	binary.BigEndian.PutUint64(raw, value)
	return raw[8-width:]
}

func TestTextParametersAreReadAsTheirDeclaredType(t *testing.T) {
	for name, testCase := range map[string]struct {
		oid  uint32
		text string
		want any
	}{
		"an integer":           {oidInt4, "42", int64(42)},
		"a big integer":        {oidInt8, "-9007199254740993", int64(-9007199254740993)},
		"an oid":               {oidOID, "16", int64(16)},
		"a real":               {oidFloat8, "1.5", 1.5},
		"a decimal":            {oidNumeric, "12.25", 12.25},
		"a true":               {oidBool, "t", int64(1)},
		"a false":              {oidBool, "f", int64(0)},
		"binary data":          {oidBytea, `\x0102`, []byte{1, 2}},
		"a timestamp":          {oidTimestamp, "2024-01-02 03:04:05", "2024-01-02 03:04:05"},
		"an unspecified type":  {0, "anything", "anything"},
		"a number that is not": {oidInt4, "twelve", "twelve"},
		"a real that is not":   {oidFloat8, "half", "half"},
		"hex that is not":      {oidBytea, `\xzz`, `\xzz`},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := decodeParams([]uint32{testCase.oid}, nil, [][]byte{[]byte(testCase.text)})

			if err != nil {
				t.Fatalf("decodeParams = %v", err)
			}
			if !reflect.DeepEqual(got[0], testCase.want) {
				t.Errorf("got %#v, want %#v", got[0], testCase.want)
			}
		})
	}
}

func TestBinaryParametersAreDecodedBecausePsycopgSendsThem(t *testing.T) {
	for name, testCase := range map[string]struct {
		oid  uint32
		raw  []byte
		want any
	}{
		"a small integer":         {oidInt2, bytesOf(7, 2), int64(7)},
		"a negative int4":         {oidInt4, bytesOf(math.MaxUint32-4, 4), int64(-5)},
		"a big integer":           {oidInt8, bytesOf(1<<40, 8), int64(1 << 40)},
		"an oid":                  {oidOID, bytesOf(16, 4), int64(16)},
		"a true":                  {oidBool, []byte{1}, int64(1)},
		"a false":                 {oidBool, []byte{0}, int64(0)},
		"a float4":                {oidFloat4, bytesOf(uint64(math.Float32bits(1.5)), 4), 1.5},
		"a float8":                {oidFloat8, bytesOf(math.Float64bits(2.5), 8), 2.5},
		"text":                    {oidText, []byte("héllo"), "héllo"},
		"an unstated type":        {0, []byte("raw"), "raw"},
		"binary data":             {oidBytea, []byte{0, 1, 255}, []byte{0, 1, 255}},
		"a uuid":                  {oidUUID, make([]byte, 16), "00000000-0000-0000-0000-000000000000"},
		"jsonb":                   {oidJSONB, append([]byte{1}, []byte(`{"a":1}`)...), `{"a":1}`},
		"a date before the epoch": {oidDate, bytesOf(uint64(math.MaxUint32-364), 4), "1999-01-01"},
		"a timestamp":             {oidTimestamp, bytesOf(uint64(756_003_045_500_000), 8), "2023-12-16 00:50:45.5"},
		"a timestamptz":           {oidTimestampTZ, bytesOf(0, 8), "2000-01-01 00:00:00"},
		"a decimal":               {oidNumeric, []byte{0, 2, 0, 0, 0, 0, 0, 2, 0, 12, 9, 196}, 12.25},
		"a negative decimal": {
			oidNumeric,
			[]byte{0, 1, 0, 0, 0x40, 0, 0, 0, 0, 7},
			-7.0,
		},
		"a decimal with no digits": {oidNumeric, []byte{0, 0, 0, 0, 0, 0, 0, 0}, 0.0},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := decodeParams([]uint32{testCase.oid}, binaryFormats(1), [][]byte{testCase.raw})

			if err != nil {
				t.Fatalf("decodeParams = %v", err)
			}
			if !reflect.DeepEqual(got[0], testCase.want) {
				t.Errorf("got %#v, want %#v", got[0], testCase.want)
			}
		})
	}
}

func TestABinaryParameterEmuCannotReadIsRefusedRatherThanGuessed(t *testing.T) {
	for name, testCase := range map[string]struct {
		oid   uint32
		raw   []byte
		names string
	}{
		"a type with no decoder":  {1186, []byte{0}, "cannot decode"},
		"an integer of odd width": {oidInt4, []byte{1, 2}, "4 bytes in binary"},
		"a float of odd width":    {oidFloat8, []byte{1}, "8 bytes in binary"},
		"a short float4":          {oidFloat4, []byte{1}, "4 bytes in binary"},
		"a truncated date":        {oidDate, []byte{1}, "4 bytes in binary"},
		"a stunted uuid":          {oidUUID, []byte{1}, "16 bytes"},
		"jsonb of another era":    {oidJSONB, []byte{9}, "version 1"},
		"a headless numeric":      {oidNumeric, []byte{0, 1}, "at least 8 bytes"},
		"a numeric that lied":     {oidNumeric, []byte{0, 9, 0, 0, 0, 0, 0, 0}, "9 digits"},
		"a numeric NaN":           {oidNumeric, []byte{0, 0, 0, 0, 0xC0, 0, 0, 0}, "NaN"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := decodeParams([]uint32{testCase.oid}, binaryFormats(1), [][]byte{testCase.raw})

			if err == nil || !strings.Contains(err.Error(), testCase.names) {
				t.Errorf("err = %v, want it to say %q", err, testCase.names)
			}
			if err != nil && !strings.HasPrefix(err.Error(), "parameter 1:") {
				t.Errorf("err = %v, want it to name which parameter", err)
			}
		})
	}
}

func TestFormatCodesAreReadTheFourWaysBindMayWriteThem(t *testing.T) {
	// The protocol lets Bind send no format codes, one for everything, or one per
	// parameter. Anything else is a client that miscounted, and text is what a
	// parameter with nothing said about it is.
	for name, testCase := range map[string]struct {
		formats []int16
		values  [][]byte
		want    []any
	}{
		"none, meaning all text": {
			nil,
			[][]byte{[]byte("1")},
			[]any{int64(1)},
		},
		"one, meaning all of them": {
			[]int16{pgproto3.BinaryFormat},
			[][]byte{bytesOf(1, 4), bytesOf(2, 4)},
			[]any{int64(1), int64(2)},
		},
		"one per parameter": {
			[]int16{pgproto3.BinaryFormat, pgproto3.TextFormat},
			[][]byte{bytesOf(1, 4), []byte("2")},
			[]any{int64(1), int64(2)},
		},
		"fewer codes than parameters": {
			[]int16{pgproto3.TextFormat, pgproto3.TextFormat},
			[][]byte{[]byte("1"), []byte("2"), []byte("3")},
			[]any{int64(1), int64(2), int64(3)},
		},
	} {
		t.Run(name, func(t *testing.T) {
			oids := make([]uint32, len(testCase.values))
			for index := range oids {
				oids[index] = oidInt4
			}

			got, err := decodeParams(oids, testCase.formats, testCase.values)

			if err != nil {
				t.Fatalf("decodeParams = %v", err)
			}
			if !reflect.DeepEqual(got, testCase.want) {
				t.Errorf("got %#v, want %#v", got, testCase.want)
			}
		})
	}
}

func TestAParameterWithNoTypeAndNoFormatIsStillReadAsWhatArrived(t *testing.T) {
	got, err := decodeParams(nil, nil, [][]byte{[]byte("value"), nil})

	if err != nil {
		t.Fatalf("decodeParams = %v", err)
	}
	if !reflect.DeepEqual(got, []any{"value", nil}) {
		t.Errorf("got %#v, want the second parameter kept as SQL NULL", got)
	}
}
