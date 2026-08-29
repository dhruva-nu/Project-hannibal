package kv

import (
	"maps"
	"slices"
	"strconv"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// an end says which end of a list a command works on, so LPUSH and RPUSH are one
// function and not two nearly identical ones.
type end bool

const (
	atFront end = true
	atBack  end = false
)

func hset(e *executor, args []string) (emulator.Result, error) {
	if len(args)%2 != 1 {
		return emulator.Result{}, wrongArity("HSET")
	}
	held, err := e.space().mutable(args[0], kindHash)
	if err != nil {
		return emulator.Result{}, err
	}

	// Redis counts the fields that did not exist before, not the ones written, so
	// HSET over an existing field answers zero.
	added := 0
	for index := 1; index < len(args); index += 2 {
		if _, present := held.hash[args[index]]; !present {
			added++
		}
		held.hash[args[index]] = args[index+1]
	}
	return value(added), nil
}

func hget(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindHash)
	if err != nil || held == nil {
		return value(nil), err
	}
	field, present := held.hash[args[1]]
	if !present {
		return value(nil), nil
	}
	return value(field), nil
}

func hdel(e *executor, args []string) (emulator.Result, error) {
	space := e.space()
	held, err := space.of(args[0], kindHash)
	if err != nil || held == nil {
		return value(0), err
	}

	removed := 0
	for _, field := range args[1:] {
		if _, present := held.hash[field]; present {
			removed++
			delete(held.hash, field)
		}
	}
	space.prune(args[0], held)
	return value(removed), nil
}

// hgetall answers with a map and lets resp decide what a map looks like: RESP3
// has a frame for one and RESP2 flattens it into an array, and which of those a
// client gets is a protocol question rather than a cache one.
//
// The map is copied because the original is the cache's own, and handing it out
// would let a client read it after the lock that protects it is gone.
func hgetall(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindHash)
	if err != nil || held == nil {
		return value(map[string]string{}), err
	}
	return value(maps.Clone(held.hash)), nil
}

// hfields is HKEYS and HVALS, which differ only in which half of each pair they
// return. Fields come back sorted for the same reason KEYS does: a lesson has to
// run the same way twice.
func hfields(pick func(field, held string) string) handler {
	return func(e *executor, args []string) (emulator.Result, error) {
		held, err := e.space().of(args[0], kindHash)
		if err != nil || held == nil {
			return value([]string{}), err
		}

		picked := make([]string, 0, len(held.hash))
		for _, field := range slices.Sorted(maps.Keys(held.hash)) {
			picked = append(picked, pick(field, held.hash[field]))
		}
		return value(picked), nil
	}
}

func hashKeys(field, _ string) string  { return field }
func hashValues(_, held string) string { return held }

func push(at end) handler {
	return func(e *executor, args []string) (emulator.Result, error) {
		held, err := e.space().mutable(args[0], kindList)
		if err != nil {
			return emulator.Result{}, err
		}
		for _, item := range args[1:] {
			if at == atFront {
				held.list = append([]string{item}, held.list...)
			} else {
				held.list = append(held.list, item)
			}
		}
		return value(len(held.list)), nil
	}
}

func pop(at end) handler {
	return func(e *executor, args []string) (emulator.Result, error) {
		space := e.space()
		held, err := space.of(args[0], kindList)
		if err != nil || held == nil {
			return value(nil), err
		}

		// A list is never present and empty — prune saw to that — so there is
		// always something to take.
		var item string
		if at == atFront {
			item, held.list = held.list[0], held.list[1:]
		} else {
			item, held.list = held.list[len(held.list)-1], held.list[:len(held.list)-1]
		}
		space.prune(args[0], held)
		return value(item), nil
	}
}

func lrange(e *executor, args []string) (emulator.Result, error) {
	first, firstErr := strconv.Atoi(args[1])
	last, lastErr := strconv.Atoi(args[2])
	if firstErr != nil || lastErr != nil {
		return emulator.Result{}, ErrNotInteger
	}

	held, err := e.space().of(args[0], kindList)
	if err != nil || held == nil {
		return value([]string{}), err
	}
	from, to := span(first, last, len(held.list))
	return value(slices.Clone(held.list[from:to])), nil
}

func llen(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindList)
	if err != nil || held == nil {
		return value(0), err
	}
	return value(len(held.list)), nil
}

// span turns LRANGE's inclusive, negative-aware indices into a Go half-open
// slice range. -1 is the last element, an out-of-range end clamps rather than
// failing, and a range that ends before it starts is empty — all of which Redis
// does and none of which a Go slice does on its own.
func span(first, last, length int) (int, int) {
	if first < 0 {
		first += length
	}
	if last < 0 {
		last += length
	}
	first, last = max(first, 0), min(last, length-1)
	if first > last {
		return 0, 0
	}
	return first, last + 1
}

func sadd(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().mutable(args[0], kindSet)
	if err != nil {
		return emulator.Result{}, err
	}

	added := 0
	for _, member := range args[1:] {
		if _, present := held.members[member]; !present {
			added++
			held.members[member] = struct{}{}
		}
	}
	return value(added), nil
}

func srem(e *executor, args []string) (emulator.Result, error) {
	space := e.space()
	held, err := space.of(args[0], kindSet)
	if err != nil || held == nil {
		return value(0), err
	}

	removed := 0
	for _, member := range args[1:] {
		if _, present := held.members[member]; present {
			removed++
			delete(held.members, member)
		}
	}
	space.prune(args[0], held)
	return value(removed), nil
}

// smembers sorts, where Redis does not. A set has no order to preserve, so the
// only thing sorting costs is the illusion that emu's arbitrary order is
// meaningful — and what it buys is a lesson that prints the same thing twice.
func smembers(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindSet)
	if err != nil || held == nil {
		return value([]string{}), err
	}
	return value(slices.Sorted(maps.Keys(held.members))), nil
}

func sismember(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindSet)
	if err != nil || held == nil {
		return value(0), err
	}
	if _, present := held.members[args[1]]; !present {
		return value(0), nil
	}
	return value(1), nil
}

func scard(e *executor, args []string) (emulator.Result, error) {
	held, err := e.space().of(args[0], kindSet)
	if err != nil || held == nil {
		return value(0), err
	}
	return value(len(held.members)), nil
}
