package kv

import (
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// expiryUnits are the two SET options that take a number of them.
var expiryUnits = map[string]time.Duration{"EX": time.Second, "PX": time.Millisecond}

func get(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindString)
	if err != nil || held == nil {
		return value(nil), err
	}
	return value(held.text), nil
}

// set writes a string over whatever was there. Redis lets it overwrite a list or
// a hash without complaint — SET is not a typed write — so this is one of the few
// commands that never answers WRONGTYPE.
//
// A plain SET drops any TTL the key had. That is Redis's rule and it is the one
// students trip over: a cached value refreshed with SET outlives the expiry the
// lesson set on it, and the cache silently stops being a cache.
func set(e *executor, args []string) (emulator.Result, error) {
	options, err := readSetOptions(args[2:])
	if err != nil {
		return emulator.Result{}, err
	}

	space := e.space()
	existing := space.at(args[0])
	if (options.onlyIfNew && existing != nil) || (options.onlyIfOld && existing == nil) {
		return value(nil), nil
	}

	written := &entry{kind: kindString, text: args[1]}
	if options.keepTTL && existing != nil {
		written.expires = existing.expires
	}
	if !options.dies.IsZero() {
		written.expires = options.dies
	}
	space.entries[args[0]] = written
	return status("OK"), nil
}

// setOptions is what a SET's trailing words asked for.
type setOptions struct {
	dies      time.Time
	keepTTL   bool
	onlyIfNew bool
	onlyIfOld bool
}

// readSetOptions refuses a word it does not know rather than ignoring it. A SET
// whose NX was silently dropped would let a lesson about locks pass everyone.
func readSetOptions(args []string) (setOptions, error) {
	var options setOptions
	for index := 0; index < len(args); index++ {
		word := strings.ToUpper(args[index])
		unit, timed := expiryUnits[word]
		switch {
		case timed:
			index++
			if index >= len(args) {
				return options, ErrSyntax
			}
			dies, err := parseDeadline(args[index], unit, "set")
			if err != nil {
				return options, err
			}
			options.dies = dies
		case word == "NX":
			options.onlyIfNew = true
		case word == "XX":
			options.onlyIfOld = true
		case word == "KEEPTTL":
			options.keepTTL = true
		default:
			return options, ErrSyntax
		}
	}
	if options.onlyIfNew && options.onlyIfOld {
		return options, ErrSyntax
	}
	return options, nil
}

func setex(e *executor, args []string) (emulator.Result, error) {
	dies, err := parseDeadline(args[1], time.Second, "setex")
	if err != nil {
		return emulator.Result{}, err
	}
	e.space().entries[args[0]] = &entry{kind: kindString, text: args[2], expires: dies}
	return status("OK"), nil
}

func getset(e *executor, args []string) (emulator.Result, error) {
	space := e.space()
	previous, err := space.of(args[0], kindString)
	if err != nil {
		return emulator.Result{}, err
	}

	space.entries[args[0]] = &entry{kind: kindString, text: args[1]}
	if previous == nil {
		return value(nil), nil
	}
	return value(previous.text), nil
}

// mget answers nil for a key that holds something other than a string rather
// than failing the whole call, which is Redis's behaviour and the only one that
// makes a bulk read usable.
func mget(e *executor, args []string) (emulator.Result, error) {
	space := e.space()
	found := make([]any, 0, len(args))
	for _, key := range args {
		held := space.at(key)
		if held == nil || held.kind != kindString {
			found = append(found, nil)
			continue
		}
		found = append(found, held.text)
	}
	return value(found), nil
}

func mset(e *executor, args []string) (emulator.Result, error) {
	if len(args)%2 != 0 {
		return emulator.Result{}, wrongArity("MSET")
	}
	space := e.space()
	for index := 0; index < len(args); index += 2 {
		space.entries[args[index]] = &entry{kind: kindString, text: args[index+1]}
	}
	return status("OK"), nil
}

func appendTo(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().mutable(args[0], kindString)
	if err != nil {
		return emulator.Result{}, err
	}
	held.text += args[1]
	return value(len(held.text)), nil
}

func strlen(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindString)
	if err != nil || held == nil {
		return value(0), err
	}
	return value(len(held.text)), nil
}

// incrementBy is INCR and DECR: a fixed step.
func incrementBy(step int64) handler {
	return func(e *executor, args []string) (emulator.Result, error) {
		return increment(e, args[0], step)
	}
}

// incrementByArgument is INCRBY and DECRBY, where sign is which way the
// argument points.
func incrementByArgument(sign int64) handler {
	return func(e *executor, args []string) (emulator.Result, error) {
		step, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil {
			return emulator.Result{}, ErrNotInteger
		}
		// Negating the most negative int64 is the one step that has no opposite,
		// and it would otherwise wrap round to itself and increment.
		if sign < 0 && step == math.MinInt64 {
			return emulator.Result{}, ErrOverflow
		}
		return increment(e, args[0], sign*step)
	}
}

// increment is the whole reason a cache is worth emulating rather than mocking:
// it is atomic, and it is atomic here for the same reason it is in Redis — one
// command runs at a time. A rate limiter built on it behaves under emu the way it
// will in production, which a stub returning canned counts cannot promise.
//
// A missing key counts as zero. A key holding something that is not a number is
// the error a student meets when they SET a JSON blob and then INCR it.
func increment(e *executor, key string, step int64) (emulator.Result, error) {
	space := e.space()
	held, err := space.of(key, kindString)
	if err != nil {
		return emulator.Result{}, err
	}

	current := int64(0)
	if held != nil {
		if current, err = strconv.ParseInt(held.text, 10, 64); err != nil {
			return emulator.Result{}, ErrNotInteger
		}
	}

	total := current + step
	if (step > 0 && total < current) || (step < 0 && total > current) {
		return emulator.Result{}, ErrOverflow
	}

	if held == nil {
		held = newEntry(kindString)
		space.entries[key] = held
	}
	held.text = strconv.FormatInt(total, 10)
	// int is 64 bits on every platform emu is built for, which is what makes it
	// the right type for a Redis integer reply — see the vocabulary in commands.go.
	return value(int(total)), nil
}

// parseDeadline reads a TTL argument and turns it into the moment the key dies.
func parseDeadline(argument string, unit time.Duration, kind string) (time.Time, error) {
	count, err := strconv.ParseInt(argument, 10, 64)
	if err != nil {
		return time.Time{}, ErrNotInteger
	}
	return deadline(count, unit, kind)
}
