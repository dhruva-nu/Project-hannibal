package mongocmd

import (
	"errors"
	"fmt"
)

// The MongoDB error codes emu raises. A driver reacts to the code and not to the
// sentence — pymongo turns 11000 into DuplicateKeyError and 43 into
// CursorNotFound, while the same words under a code it does not know are just a
// string — so every failure emu invents has to pick one deliberately.
const (
	// CodeBadValue is a value the command could not have meant.
	CodeBadValue = 2
	// CodeUnknown is a failure emu had no better name for.
	CodeUnknown = 8
	// CodeFailedToParse is a command emu could not read.
	CodeFailedToParse = 9
	// CodeTypeMismatch is a field of the wrong BSON type.
	CodeTypeMismatch = 14
	// CodeNamespaceNotFound is a collection that was never created.
	CodeNamespaceNotFound = 26
	// CodeCursorNotFound is a getMore for a cursor that was killed or exhausted.
	CodeCursorNotFound = 43
	// CodeCommandNotFound is a command emu does not implement.
	CodeCommandNotFound = 59
	// CodeImmutableField is an update that would change a document's _id.
	CodeImmutableField = 66
	// CodeCommandNotSupported is a command emu implements, asked to do something
	// it does not — an aggregation stage, an update operator, a query operator.
	CodeCommandNotSupported = 115
	// CodeWriteConflict is what an injected fault raises unless a rule names
	// something else. It is MongoDB's serialization failure: the one write
	// failure a client is written to notice and retry, which is the behaviour a
	// fault lesson is about.
	CodeWriteConflict = 112
	// CodeDuplicateKey is a second document with an _id the collection already
	// holds.
	CodeDuplicateKey = 11000
)

// names are the codeName a real server sends beside the numeric code. Drivers do
// not require it; a student reading the exception does.
var names = map[int]string{
	CodeBadValue:            "BadValue",
	CodeUnknown:             "UnknownError",
	CodeFailedToParse:       "FailedToParse",
	CodeTypeMismatch:        "TypeMismatch",
	CodeNamespaceNotFound:   "NamespaceNotFound",
	CodeCursorNotFound:      "CursorNotFound",
	CodeCommandNotFound:     "CommandNotFound",
	CodeImmutableField:      "ImmutableField",
	CodeCommandNotSupported: "CommandNotSupported",
	CodeWriteConflict:       "WriteConflict",
	CodeDuplicateKey:        "DuplicateKey",
}

// CodeOf reads the MongoDB code off a failure, for the reply that has to carry
// one. Anything that never named a code is an emu bug rather than a lesson's
// mistake, and UnknownError is what a real server calls that too.
func CodeOf(err error) (code int, name string) {
	var coded interface{ MongoError() (int, string) }
	if errors.As(err, &coded) {
		return coded.MongoError()
	}
	return CodeUnknown, names[CodeUnknown]
}

// An Error is a failure carrying the code MongoDB gives it, so that a lesson can
// catch pymongo.errors.DuplicateKeyError rather than match on a sentence.
type Error struct {
	Code    int
	Name    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// MongoError is what mongowire reads to build the error document. It is an
// interface satisfied by shape rather than a shared type, the way pgwire reads
// SQLState off whatever the SQL engine raised.
func (e *Error) MongoError() (code int, name string) { return e.Code, e.Name }

// Fail builds an error with the codeName that goes with its code.
func Fail(code int, format string, arguments ...any) *Error {
	return &Error{Code: code, Name: names[code], Message: fmt.Sprintf(format, arguments...)}
}

// Invalid is a command emu understood and refused.
func Invalid(format string, arguments ...any) *Error {
	return Fail(CodeBadValue, format, arguments...)
}

// Unsupported is the loud half of "no aggregation pipeline in v1". A lesson that
// asks for something emu does not do gets told so by name, because the failure
// mode that has to be impossible is emu quietly returning the wrong answer.
func Unsupported(format string, arguments ...any) *Error {
	return Fail(CodeCommandNotSupported, "emu does not support "+format, arguments...)
}
