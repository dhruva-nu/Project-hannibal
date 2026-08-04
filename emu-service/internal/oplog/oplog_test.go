package oplog

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestRecordNumbersEntriesFromOne(t *testing.T) {
	log := New(10)

	for want := 1; want <= 3; want++ {
		if got := log.Record(Entry{Op: "COMMIT"}); got.N != want {
			t.Errorf("ordinal = %d, want %d", got.N, want)
		}
	}
}

func TestEntriesReturnsOldestFirst(t *testing.T) {
	log := New(10)
	for _, kind := range []string{"CONNECT", "QUERY", "COMMIT"} {
		log.Record(Entry{Op: kind})
	}

	entries := log.Entries()
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(entries))
	}
	if entries[0].Op != "CONNECT" || entries[2].Op != "COMMIT" {
		t.Errorf("entries = %v, want CONNECT first and COMMIT last", entries)
	}
}

func TestRecordDropsTheOldestOnceFull(t *testing.T) {
	// The op log is the one place a tight student loop turns into unbounded
	// memory, so it is a ring — but ordinals stay unique so the gap is visible.
	log := New(2)
	for _, kind := range []string{"first", "second", "third"} {
		log.Record(Entry{Op: kind})
	}

	entries := log.Entries()
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want the limit of 2", len(entries))
	}
	if entries[0].Op != "second" || entries[1].Op != "third" {
		t.Errorf("entries = %v, want second then third", entries)
	}
	if entries[0].N != 2 || entries[1].N != 3 {
		t.Errorf("ordinals = %d,%d, want 2,3 — ordinals are never reused", entries[0].N, entries[1].N)
	}
}

func TestNewFallsBackToTheDefaultLimit(t *testing.T) {
	for _, limit := range []int{0, -1} {
		if got := cap(New(limit).entries); got != DefaultLimit {
			t.Errorf("New(%d) limit = %d, want %d", limit, got, DefaultLimit)
		}
	}
}

func TestDumpToWritesOneTaggedLine(t *testing.T) {
	log := New(10)
	log.Record(Entry{Emulator: "postgres", Op: "COMMIT", Fault: "error"})
	log.Record(Entry{Control: "fault add redis.*"})

	var out strings.Builder
	if err := log.DumpTo(&out); err != nil {
		t.Fatalf("DumpTo: %v", err)
	}
	if lines := strings.Count(strings.TrimSpace(out.String()), "\n"); lines != 0 {
		t.Errorf("dump spans %d newlines, want one line rce-service can split out", lines+1)
	}

	var dumped struct {
		Entries []Entry `json:"emu_oplog"`
		Dropped int     `json:"emu_oplog_dropped"`
	}
	if err := json.Unmarshal([]byte(out.String()), &dumped); err != nil {
		t.Fatalf("the dump is not JSON: %v", err)
	}
	if len(dumped.Entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(dumped.Entries))
	}
	if dumped.Entries[0].Fault != "error" || dumped.Entries[1].Control == "" {
		t.Errorf("entries = %+v, want the fault and the control mutation both kept", dumped.Entries)
	}
	if dumped.Dropped != 0 {
		t.Errorf("dropped = %d, want it omitted when nothing was lost", dumped.Dropped)
	}
}

func TestDumpToReportsWhatItDropped(t *testing.T) {
	log := New(1)
	log.Record(Entry{Op: "first"})
	log.Record(Entry{Op: "second"})

	var out strings.Builder
	if err := log.DumpTo(&out); err != nil {
		t.Fatalf("DumpTo: %v", err)
	}
	if !strings.Contains(out.String(), `"emu_oplog_dropped":1`) {
		t.Errorf("dump = %s, want the dropped count so truncation is never silent", out.String())
	}
}

func TestDumpToEmitsAnEmptyArrayRatherThanNull(t *testing.T) {
	var out strings.Builder
	if err := New(4).DumpTo(&out); err != nil {
		t.Fatalf("DumpTo: %v", err)
	}
	if !strings.Contains(out.String(), `"emu_oplog":[]`) {
		t.Errorf("dump = %s, want an empty array", out.String())
	}
}

func TestDumpToReportsAWriteFailure(t *testing.T) {
	if err := New(4).DumpTo(failingWriter{}); err == nil {
		t.Error("err = nil, want the write failure reported")
	}
}

func TestRecordIsSafeForConcurrentEmulators(t *testing.T) {
	const writers = 8
	const each = 50
	log := New(writers * each)

	var group sync.WaitGroup
	group.Add(writers)
	for range writers {
		go func() {
			defer group.Done()
			for range each {
				log.Record(Entry{Op: "SET"})
			}
		}()
	}
	group.Wait()

	seen := make(map[int]bool, writers*each)
	for _, entry := range log.Entries() {
		if seen[entry.N] {
			t.Fatalf("ordinal %d was assigned twice", entry.N)
		}
		seen[entry.N] = true
	}
	if len(seen) != writers*each {
		t.Errorf("ordinals = %d, want %d", len(seen), writers*each)
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("stdout is gone") }
