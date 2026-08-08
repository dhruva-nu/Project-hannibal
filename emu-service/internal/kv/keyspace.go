package kv

import (
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// fullCursor is the cursor SCAN always hands back. emu walks the whole key space
// in one pass — see scan — so there is never a second page to ask for, and "0"
// is exactly how Redis says an iteration is complete.
const fullCursor = "0"

func del(e *executor, args []string) (emulator.Result, error) {
	space, removed := e.space(), 0
	for _, key := range args {
		if space.remove(key) {
			removed++
		}
	}
	return value(removed), nil
}

// exists counts a key once per time it is named, which is Redis's answer and not
// the one most people expect: EXISTS k k is 2.
func exists(e *executor, args []string) (emulator.Result, error) {
	space, found := e.space(), 0
	for _, key := range args {
		if space.at(key) != nil {
			found++
		}
	}
	return value(found), nil
}

// expire sets a TTL, or deletes the key outright when the TTL has already passed
// — which is what Redis does with a zero or negative one, rather than refusing
// it.
func expire(e *executor, args []string) (emulator.Result, error) {
	seconds, err := strconv.ParseInt(args[1], 10, 64)
	if err != nil {
		return emulator.Result{}, ErrNotInteger
	}

	space := e.space()
	held := space.at(args[0])
	if held == nil {
		return value(0), nil
	}
	if seconds <= 0 {
		space.remove(args[0])
		return value(1), nil
	}

	dies, err := deadline(seconds, time.Second, "expire")
	if err != nil {
		return emulator.Result{}, err
	}
	held.expires = dies
	return value(1), nil
}

// ttl answers in whole seconds, rounded up, and distinguishes the two ways a key
// can have no TTL: -2 is a key that is not there, -1 is one that never expires.
// A student who conflates them writes a cache that never refills.
func ttl(e *executor, args []string) (emulator.Result, error) {
	held := e.space().at(args[0])
	switch {
	case held == nil:
		return value(-2), nil
	case held.expires.IsZero():
		return value(-1), nil
	}
	remaining := time.Until(held.expires)
	return value(int((remaining + time.Second - 1) / time.Second)), nil
}

func typeOf(e *executor, args []string) (emulator.Result, error) {
	held := e.space().at(args[0])
	if held == nil {
		return status("none"), nil
	}
	return status(string(held.kind)), nil
}

func keys(e *executor, args []string) (emulator.Result, error) {
	return value(matching(e.space().live(), args[0])), nil
}

// scan returns the whole key space in one pass and reports the iteration
// complete. Redis itself does that whenever the table is small enough, so it is a
// legal SCAN rather than a shortcut — and a cursor emu never issues is one no
// client can hand back, so a cursor that is not zero has nothing left to give.
//
// The point of SCAN over KEYS is not to page a lesson's dozen keys; it is that a
// student writing scan_iter against emu is writing the code that will also be
// right against a production Redis with a million.
func scan(e *executor, args []string) (emulator.Result, error) {
	cursor, err := strconv.ParseUint(args[0], 10, 64)
	if err != nil {
		return emulator.Result{}, ErrCursor
	}
	pattern, err := scanOptions(args[1:])
	if err != nil {
		return emulator.Result{}, err
	}
	if cursor != 0 {
		return value([]any{fullCursor, []string{}}), nil
	}
	return value([]any{fullCursor, matching(e.space().live(), pattern)}), nil
}

// scanOptions reads MATCH and COUNT. COUNT is validated and then dropped: there
// is no batch for it to size when the whole space comes back at once, and a
// client that sends a nonsense COUNT should still be told so.
func scanOptions(args []string) (string, error) {
	pattern := "*"
	for index := 0; index < len(args); index += 2 {
		if index+1 >= len(args) {
			return "", ErrSyntax
		}
		switch strings.ToUpper(args[index]) {
		case "MATCH":
			pattern = args[index+1]
		case "COUNT":
			count, err := strconv.Atoi(args[index+1])
			if err != nil {
				return "", ErrNotInteger
			}
			if count < 1 {
				return "", ErrSyntax
			}
		default:
			return "", ErrSyntax
		}
	}
	return pattern, nil
}

func matching(keys []string, pattern string) []string {
	found := []string{}
	for _, key := range keys {
		if matches(pattern, key) {
			found = append(found, key)
		}
	}
	return found
}

// deadline turns a TTL into the moment the key dies, refusing one a time.Time
// cannot hold. Without the bound, SETEX with a number near the top of an int64
// overflows into a deadline in the past and the key vanishes the instant it is
// written — a failure that looks like emu losing data rather than like a lesson
// asking for something impossible.
func deadline(count int64, unit time.Duration, kind string) (time.Time, error) {
	if count <= 0 || count > math.MaxInt64/int64(unit) {
		return time.Time{}, invalidExpire(kind)
	}
	return time.Now().Add(time.Duration(count) * unit), nil
}
