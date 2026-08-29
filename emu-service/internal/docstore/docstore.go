// Package docstore answers document-database semantics for the emulated MongoDB.
//
// The control layer mocks *behaviour* — this insert fails, this find is slow.
// Something still has to answer *semantics*: evaluate the filter, apply the
// update, order the results. A student who writes the wrong filter and gets the
// right documents has no feedback loop left, and hand-authored fixtures make
// every new lesson a new set of them.
//
// Unlike the SQL database, there is no library to embed here: MongoDB has no
// pure-Go engine the way SQLite does. So the engine is emu's own, small and
// honest about its edges — everything it cannot evaluate fails by name rather
// than returning a plausible wrong answer.
package docstore

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"sync"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// identifierField is the one field MongoDB gives every document whether or not
// the client asked for it, and the one it enforces uniqueness on.
const identifierField = "_id"

// A collection is documents in the order they were inserted, which is the order
// MongoDB returns them in when nothing asked for another.
type collection struct {
	name      string
	documents []bson.D
}

// A Backend is one emulated document database.
//
// Its state is shared across connections and guarded by one mutex. That is not a
// simplification: MongoDB has no per-connection transaction to keep apart, so
// there is nothing for a per-connection handle to own — every client sees every
// write the moment it lands, which is what a lesson describes.
type Backend struct {
	mutex       sync.Mutex
	collections map[string]*collection
	cursors     map[int64]*cursor
	lastCursor  int64
}

func New() *Backend {
	return &Backend{collections: map[string]*collection{}, cursors: map[int64]*cursor{}}
}

// Seed loads the lesson's documents, collection by collection:
//
//	"mongo": {"orders": [{"sku": "abc", "total": 50}]}
//
// Documents are read as MongoDB's extended JSON, so a lesson that needs a real
// ObjectId or date can write {"$oid": "..."} or {"$date": "..."} and get one
// rather than a string that looks like one.
func (b *Backend) Seed(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}

	var collections map[string]json.RawMessage
	if err := json.Unmarshal(raw, &collections); err != nil {
		return fmt.Errorf("seed for mongo: want an object of collection name to documents: %w", err)
	}

	// Sorted, so that a seed that is going to fail fails on the same collection
	// every run.
	for _, name := range slices.Sorted(maps.Keys(collections)) {
		if err := b.seedCollection(name, collections[name]); err != nil {
			return err
		}
	}
	return nil
}

func (b *Backend) seedCollection(name string, raw json.RawMessage) error {
	var listed []json.RawMessage
	if err := json.Unmarshal(raw, &listed); err != nil {
		return fmt.Errorf("seed for mongo, collection %q: want a list of documents: %w", name, err)
	}

	held := b.collect(name)
	for index, entry := range listed {
		var document bson.D
		if err := bson.UnmarshalExtJSON(entry, false, &document); err != nil {
			return fmt.Errorf("seed for mongo, %s document %d: %w", name, index+1, err)
		}
		if err := held.insert(document); err != nil {
			return fmt.Errorf("seed for mongo, %s document %d: %w", name, index+1, err)
		}
	}
	return nil
}

// Open hands out the handle one client connection runs its commands through.
// Every one of them reaches the same state; the interface exists because a SQL
// session's transaction does not.
func (b *Backend) Open() (emulator.Executor, error) { return &executor{store: b}, nil }

// Close drops every document and every open cursor. Nothing persists between
// runs, and nothing here ever reached a disk to begin with.
func (b *Backend) Close() error {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.collections, b.cursors = map[string]*collection{}, map[int64]*cursor{}
	return nil
}

// Count is the gauge every operation carries, so that a rule can say
// `when: {documents_gte: 100}` and mean "once this collection is full".
func (b *Backend) Count(name string) int {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	held, exists := b.collections[name]
	if !exists {
		return 0
	}
	return len(held.documents)
}

// collect answers the named collection, creating it the way MongoDB does: the
// first write to a name brings it into being.
func (b *Backend) collect(name string) *collection {
	held, exists := b.collections[name]
	if !exists {
		held = &collection{name: name}
		b.collections[name] = held
	}
	return held
}

// find answers the documents a filter selects, in insertion order.
func (c *collection) find(filter bson.D) ([]bson.D, error) {
	var selected []bson.D
	for _, document := range c.documents {
		held, err := matches(document, filter)
		if err != nil {
			return nil, err
		}
		if held {
			selected = append(selected, document)
		}
	}
	return selected, nil
}

// insert stores a document, assigning the _id MongoDB assigns when the client
// did not, and refusing one the collection already holds.
func (c *collection) insert(document bson.D) error {
	stored := withIdentifier(cloneDocument(document), identifierOf(document))
	identifier, _ := mongocmd.Lookup(stored, identifierField)

	if _, taken := c.locate(identifier); taken {
		return mongocmd.Fail(mongocmd.CodeDuplicateKey,
			"E11000 duplicate key error collection: %s.%s index: _id_ dup key: { _id: %v }",
			mongocmd.Database, c.name, identifier)
	}
	c.documents = append(c.documents, stored)
	return nil
}

// locate finds a document by _id, which is the only lookup emu indexes on —
// every other query is a scan, the way a collection with no index behaves.
func (c *collection) locate(identifier any) (int, bool) {
	for index, document := range c.documents {
		held, _ := mongocmd.Lookup(document, identifierField)
		if equal(held, identifier) {
			return index, true
		}
	}
	return 0, false
}

// identifierOf answers the _id a document has, or the one MongoDB would have
// given it. An ObjectId rather than a counter, because a student who prints a
// document has to see what a real driver would show them.
func identifierOf(document bson.D) any {
	if identifier, present := mongocmd.Lookup(document, identifierField); present {
		return identifier
	}
	return bson.NewObjectID()
}

// withIdentifier puts the _id first, which is where MongoDB puts it and
// therefore where a student expects to see it when they print the document.
func withIdentifier(document bson.D, identifier any) bson.D {
	ordered := make(bson.D, 0, len(document)+1)
	ordered = append(ordered, mongocmd.Field(identifierField, identifier))
	for _, element := range document {
		if element.Key != identifierField {
			ordered = append(ordered, element)
		}
	}
	return ordered
}
