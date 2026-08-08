package kv

import (
	"fmt"
	"strings"
)

// An Error is a failure in Redis's own words, prefix and all. A Redis client
// reads the first token of an error reply and nothing else: redis-py turns
// WRONGTYPE and OOM into their own exception classes and everything else into a
// bare ResponseError, so the prefix is the part that decides whether a student's
// `except` clause can tell two failures apart. Carrying the whole line here — the
// way sqlitedb carries a SQLSTATE — is what lets resp write it out untouched.
type Error string

func (e Error) Error() string { return string(e) }

// RedisError is what resp reads to know this failure already names itself. An
// error without it is an emu bug rather than a Redis one, and resp says ERR.
func (e Error) RedisError() string { return string(e) }

// The failures a client is expected to meet, verbatim from Redis. A student
// debugging against emu has to see what Redis would have said, or the habits
// they build here do not transfer.
const (
	ErrWrongType   Error = "WRONGTYPE Operation against a key holding the wrong kind of value"
	ErrNotInteger  Error = "ERR value is not an integer or out of range"
	ErrOverflow    Error = "ERR increment or decrement would overflow"
	ErrSyntax      Error = "ERR syntax error"
	ErrDBIndex     Error = "ERR DB index is out of range"
	ErrCursor      Error = "ERR invalid cursor"
	ErrNegativeLen Error = "ERR value is out of range, must be positive"
)

// wrongArity names the command in lower case, as Redis does: the message quotes
// the command's canonical name rather than whatever case the client typed.
func wrongArity(kind string) Error {
	return Error(fmt.Sprintf("ERR wrong number of arguments for '%s' command", strings.ToLower(kind)))
}

// invalidExpire is what Redis says about a TTL it will not accept, and it names
// the command because SET and SETEX reject different things.
func invalidExpire(kind string) Error {
	return Error(fmt.Sprintf("ERR invalid expire time in '%s' command", strings.ToLower(kind)))
}

// unknownCommand echoes what the client actually sent, in the case it sent it.
// Redis quotes the verb and then every argument, which is how a student finds
// the typo without a server log they cannot read.
func unknownCommand(argv []string) Error {
	var message strings.Builder
	fmt.Fprintf(&message, "ERR unknown command '%s', with args beginning with: ", argv[0])
	for _, arg := range argv[1:] {
		fmt.Fprintf(&message, "'%s', ", arg)
	}
	return Error(message.String())
}
