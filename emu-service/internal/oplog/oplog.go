// Package oplog records what the emulators were asked to do, in an order that
// does not depend on the wall clock.
//
// The log is the graded artifact: it is what lets a lesson ask "did they retry
// the failed commit?" instead of grepping stdout. Ordinals are assigned by a
// logical counter so that two runs of the same program produce the same log.
package oplog

import (
	"encoding/json"
	"io"
	"sync"
)

// DefaultLimit bounds the log when a config does not say otherwise. Every
// operation a student performs appends an entry, so an unbounded log is the one
// place in emu where a tight loop turns into unbounded memory.
const DefaultLimit = 10_000

// An Entry is one recorded event. Operations carry Emulator/Op; control-plane
// mutations carry Control, so a run that had live control is identifiable after
// the fact rather than indistinguishable from one that did not.
type Entry struct {
	N        int    `json:"n"`
	Emulator string `json:"emu,omitempty"`
	Op       string `json:"op,omitempty"`
	Target   string `json:"target,omitempty"`
	Fault    string `json:"fault,omitempty"`
	Control  string `json:"control,omitempty"`
}

// A Log is a bounded, append-only record safe for concurrent use: emulators
// serve every connection on its own goroutine.
type Log struct {
	mutex   sync.Mutex
	entries []Entry // ring buffer; oldest at oldest once full
	oldest  int
	next    int // ordinal of the next entry, never reused
	dropped int
}

// dump is the single stdout line rce-service picks the log out of, tagged so it
// cannot be confused with student output.
type dump struct {
	Entries []Entry `json:"emu_oplog"`
	Dropped int     `json:"emu_oplog_dropped,omitempty"`
}

// New returns a log holding at most limit entries. A limit of zero or less means
// DefaultLimit.
func New(limit int) *Log {
	if limit <= 0 {
		limit = DefaultLimit
	}
	return &Log{entries: make([]Entry, 0, limit), next: 1}
}

// Record assigns the next logical ordinal to entry and appends it, returning the
// entry as stored. Once the log is full the oldest entry is overwritten and the
// count of lost entries is reported by the dump, so truncation is never silent.
func (l *Log) Record(entry Entry) Entry {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	entry.N = l.next
	l.next++

	if len(l.entries) < cap(l.entries) {
		l.entries = append(l.entries, entry)
		return entry
	}
	l.entries[l.oldest] = entry
	l.oldest = (l.oldest + 1) % len(l.entries)
	l.dropped++
	return entry
}

// Entries returns the retained entries, oldest first.
func (l *Log) Entries() []Entry {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	return l.snapshot()
}

// Since returns the retained entries numbered above ordinal, so a dashboard can
// poll for what it has not seen instead of refetching the whole log. Entries the
// ring dropped are gone; Dropped says how many.
func (l *Log) Since(ordinal int) []Entry {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	fresh := make([]Entry, 0, len(l.entries))
	for _, entry := range l.snapshot() {
		if entry.N > ordinal {
			fresh = append(fresh, entry)
		}
	}
	return fresh
}

// Dropped is how many entries the ring has overwritten.
func (l *Log) Dropped() int {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	return l.dropped
}

// DumpTo writes the log as one JSON line.
func (l *Log) DumpTo(writer io.Writer) error {
	l.mutex.Lock()
	payload := dump{Entries: l.snapshot(), Dropped: l.dropped}
	l.mutex.Unlock()

	return json.NewEncoder(writer).Encode(payload)
}

// snapshot copies the ring out in order. The caller holds the mutex, so that a
// dump reports entries and the dropped count from the same instant.
func (l *Log) snapshot() []Entry {
	ordered := make([]Entry, 0, len(l.entries))
	ordered = append(ordered, l.entries[l.oldest:]...)
	return append(ordered, l.entries[:l.oldest]...)
}
