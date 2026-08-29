package kv

import (
	"encoding/json"
	"errors"
	"slices"
	"time"
)

// A kind is what a key holds. Redis reports these words to TYPE, so they are the
// wire vocabulary and not an internal enum.
type kind string

const (
	kindString kind = "string"
	kindHash   kind = "hash"
	kindList   kind = "list"
	kindSet    kind = "set"
)

// An entry is one key's value, whatever shape it has. One struct with four
// fields rather than an interface with four implementations: the alternative
// buys polymorphism nothing here, because every command already knows which
// kind it wants before it looks.
type entry struct {
	kind    kind
	text    string
	hash    map[string]string
	list    []string
	members map[string]struct{}
	// expires is when the key dies, zero when it never does. Expiry is lazy —
	// checked on the way past — because that is what Redis does and because a
	// sweeper is a background ticker, which the plan's memory budget rules out.
	expires time.Time
}

func newEntry(want kind) *entry {
	return &entry{
		kind:    want,
		hash:    map[string]string{},
		members: map[string]struct{}{},
	}
}

// empty reports whether a collection has nothing left in it, which in Redis
// means the key is gone rather than present and empty. A string is never empty
// in that sense: SET k "" leaves a key holding nothing, and EXISTS says so.
func (e *entry) empty() bool {
	return e.kind != kindString && len(e.hash)+len(e.list)+len(e.members) == 0
}

// A space is one numbered database.
type space struct{ entries map[string]*entry }

func newSpace() *space { return &space{entries: map[string]*entry{}} }

// at returns the live entry for key, dropping it first if its TTL has passed.
// Every read of the map goes through here, which is what makes expiry real
// without anything watching the clock.
func (s *space) at(key string) *entry {
	held, present := s.entries[key]
	if !present {
		return nil
	}
	if !held.expires.IsZero() && !time.Now().Before(held.expires) {
		delete(s.entries, key)
		return nil
	}
	return held
}

// of returns the live entry for key only if it holds want. A nil entry with a
// nil error means the key is absent, which most commands answer rather than
// fail.
func (s *space) of(key string, want kind) (*entry, error) {
	held := s.at(key)
	if held == nil {
		return nil, nil
	}
	if held.kind != want {
		return nil, ErrWrongType
	}
	return held, nil
}

// mutable returns the entry a write is about to change, creating an empty one of
// kind want when the key is absent — the way LPUSH into nothing makes a list.
func (s *space) mutable(key string, want kind) (*entry, error) {
	held, err := s.of(key, want)
	if err != nil || held != nil {
		return held, err
	}
	held = newEntry(want)
	s.entries[key] = held
	return held, nil
}

// prune drops a collection that a removal emptied. Redis has no such thing as an
// empty list, and a lesson that checked EXISTS would otherwise be told a lie.
func (s *space) prune(key string, held *entry) {
	if held.empty() {
		delete(s.entries, key)
	}
}

func (s *space) remove(key string) bool {
	if s.at(key) == nil {
		return false
	}
	delete(s.entries, key)
	return true
}

// live lists every key that has not expired, sorted. Real Redis returns them in
// hash-table order, which is to say unpredictably; emu sorts because the plan
// wants two runs of one lesson to produce the same op log and the same output,
// and a student who depends on KEYS ordering has learnt something false either
// way.
func (s *space) live() []string {
	keys := make([]string, 0, len(s.entries))
	for key := range s.entries {
		if s.at(key) != nil {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	return keys
}

func (s *space) flush() { s.entries = map[string]*entry{} }

// seed installs one key from the lesson's config, reading the shape off the
// JSON: a string is a string, an array is a list, an object is a hash.
func (s *space) seed(key string, raw json.RawMessage) error {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		s.entries[key] = &entry{kind: kindString, text: text}
		return nil
	}

	var list []string
	if json.Unmarshal(raw, &list) == nil {
		s.entries[key] = &entry{kind: kindList, list: list}
		return nil
	}

	var fields map[string]string
	if json.Unmarshal(raw, &fields) != nil {
		return errors.New("want a string, a list of strings, or an object of fields to values")
	}
	s.entries[key] = &entry{kind: kindHash, hash: fields}
	return nil
}
