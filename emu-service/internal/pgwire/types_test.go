package pgwire

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

func TestPostgresLivesWhereAConnectionStringExpectsIt(t *testing.T) {
	if port := New().Port(); port != 5432 {
		t.Errorf("Port = %d, want the one a lesson's connection string already has", port)
	}
}

func TestEveryColumnTypeIsDescribedAsSomethingAClientCanRead(t *testing.T) {
	for kind, want := range map[emulator.Type]uint32{
		emulator.TypeText:      oidText,
		emulator.TypeInteger:   oidInt8,
		emulator.TypeFloat:     oidFloat8,
		emulator.TypeBool:      oidBool,
		emulator.TypeTimestamp: oidTimestamp,
		emulator.TypeBytes:     oidBytea,
		emulator.Type(99):      oidText, // a type from a backend this build does not have
	} {
		if got := oidFor(kind); got != want {
			t.Errorf("oidFor(%v) = %d, want %d", kind, got, want)
		}
	}
}

func TestStorageSizesAreReportedForTheTypesThatHaveOne(t *testing.T) {
	if width := widthOf(oidInt8); width != 8 {
		t.Errorf("widthOf(int8) = %d, want 8", width)
	}
	if width := widthOf(oidText); width != -1 {
		t.Errorf("widthOf(text) = %d, want -1 for a variable width", width)
	}
}

func TestValuesAreRenderedAsPostgresWritesThem(t *testing.T) {
	moment := time.Date(2024, time.January, 2, 3, 4, 5, 600_000_000, time.UTC)

	for name, testCase := range map[string]struct {
		kind  emulator.Type
		value any
		want  string
	}{
		"an integer":               {emulator.TypeInteger, int64(-7), "-7"},
		"a real":                   {emulator.TypeFloat, 1.5, "1.5"},
		"text":                     {emulator.TypeText, "héllo", "héllo"},
		"text held as bytes":       {emulator.TypeText, []byte("raw"), "raw"},
		"something unaccountable":  {emulator.TypeText, struct{ A int }{1}, "{1}"},
		"a true from SQLite's 1":   {emulator.TypeBool, int64(1), "t"},
		"a false from SQLite's 0":  {emulator.TypeBool, int64(0), "f"},
		"a Go bool":                {emulator.TypeBool, true, "t"},
		"a truthy real":            {emulator.TypeBool, 1.0, "t"},
		"a truthy word":            {emulator.TypeBool, "true", "t"},
		"an untruthy word":         {emulator.TypeBool, "no", "f"},
		"a bool that is neither":   {emulator.TypeBool, struct{}{}, "f"},
		"binary data":              {emulator.TypeBytes, []byte{0, 1, 255}, `\x0001ff`},
		"binary data held as text": {emulator.TypeBytes, "AB", `\x4142`},
		"binary data that is not":  {emulator.TypeBytes, int64(1), "1"},
		"a moment":                 {emulator.TypeTimestamp, moment, "2024-01-02 03:04:05.6"},
		"a moment held as text":    {emulator.TypeTimestamp, "2024-01-02", "2024-01-02"},
	} {
		t.Run(name, func(t *testing.T) {
			if got := encode(testCase.kind, testCase.value); got != testCase.want {
				t.Errorf("encode(%v, %#v) = %q, want %q", testCase.kind, testCase.value, got, testCase.want)
			}
		})
	}
}

func TestANullFieldIsAbsentRatherThanEmpty(t *testing.T) {
	columns := []emulator.Column{{Type: emulator.TypeText}, {Type: emulator.TypeText}}

	encoded := encodeRow(columns, []any{nil, ""})

	if encoded[0] != nil {
		t.Errorf("NULL was written as %q, want nothing at all", encoded[0])
	}
	if encoded[1] == nil || len(encoded[1]) != 0 {
		t.Errorf("the empty string was written as %v, want an empty field", encoded[1])
	}
}

func TestTheClientIsToldWhichFailureItIs(t *testing.T) {
	for name, testCase := range map[string]struct {
		err  error
		want string
	}{
		"an injected fault with no code of its own": {
			&control.FaultError{Message: "injected fault"},
			defaultFaultState,
		},
		"an injected fault the rule named": {
			&control.FaultError{Code: "53300", Message: "too many clients"},
			"53300",
		},
		"a backend failure that carries its own": {
			codedError{state: "23505"},
			"23505",
		},
		"something with nothing to go on": {
			errors.New("who knows"),
			"XX000",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if got := stateOf(testCase.err); got != testCase.want {
				t.Errorf("stateOf(%v) = %q, want %q", testCase.err, got, testCase.want)
			}
		})
	}
}

type codedError struct{ state string }

func (c codedError) Error() string    { return "a coded failure" }
func (c codedError) SQLState() string { return c.state }

func TestParameterTypesAreAnsweredForWhatTheClientDidNotSay(t *testing.T) {
	for name, testCase := range map[string]struct {
		oids         []uint32
		placeholders int
		want         []uint32
	}{
		"the client named them all":     {[]uint32{oidInt8, oidBool}, 2, []uint32{oidInt8, oidBool}},
		"the client named none":         {nil, 2, []uint32{oidText, oidText}},
		"the client left a gap":         {[]uint32{0, oidInt8}, 2, []uint32{oidText, oidInt8}},
		"the client named more than $N": {[]uint32{oidInt8}, 0, []uint32{oidInt8}},
	} {
		t.Run(name, func(t *testing.T) {
			got := resolved(testCase.oids, testCase.placeholders)

			if !reflect.DeepEqual(got, testCase.want) {
				t.Errorf("resolved = %v, want %v", got, testCase.want)
			}
		})
	}
}
