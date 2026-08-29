package docstore

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// updating runs one entry of an update batch and answers the collection's first
// document, which is what the change has to be read off.
func updating(t *testing.T, store *Backend, specification bson.D) bson.D {
	t.Helper()

	run(t, store, bson.D{f("update", "things"), f("updates", bson.A{specification})})
	found := documents(t, run(t, store, bson.D{f("find", "things")}), "firstBatch")
	if len(found) == 0 {
		t.Fatalf("the collection is empty after %v", specification)
	}
	return found[0]
}

func value(t *testing.T, document bson.D, path string) any {
	t.Helper()

	values := valuesAt(document, path)
	if len(values) == 0 {
		return nil
	}
	return values[0]
}

const one = `{"things": [{"sku": "a", "n": 1, "nested": {"deep": 5}}]}`

func TestSetWritesAFieldAndBuildsThePathToIt(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{f("sku", "a")}),
		f("u", bson.D{f("$set", bson.D{f("n", int32(9)), f("nested.deep", int32(6)), f("a.b.c", "made")})}),
	})

	if value(t, updated, "n") != int32(9) || value(t, updated, "nested.deep") != int32(6) {
		t.Errorf("$set left %v", updated)
	}
	if value(t, updated, "a.b.c") != "made" {
		t.Errorf("$set did not build the path: %v", updated)
	}
}

// A counter that turned into 3.0 the first time it was incremented would print
// back to a student as 3.0 forever.
func TestIncrementKeepsAWholeNumberWhole(t *testing.T) {
	store := seeded(t, one)

	incremented := updating(t, store, bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("n", int32(2))})}),
	})
	if whole, isWhole := value(t, incremented, "n").(int64); !isWhole || whole != 3 {
		t.Errorf("n is %#v, want the whole number 3", value(t, incremented, "n"))
	}

	// A Go int reaches here only from a test or from emu's own code, and it is a
	// whole number wherever it came from.
	again := updating(t, store, bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("n", 1)})}),
	})
	if value(t, again, "n") != int64(4) {
		t.Errorf("n is %#v, want 4", value(t, again, "n"))
	}

	fractional := updating(t, store, bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("n", 0.5)})}),
	})
	if value(t, fractional, "n") != 4.5 {
		t.Errorf("n is %#v, want 4.5", value(t, fractional, "n"))
	}
}

func TestIncrementOfAFieldThatIsNotThereStartsFromIt(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("fresh", int32(4))})}),
	})

	if value(t, updated, "fresh") != int32(4) {
		t.Errorf("fresh is %#v, want 4", value(t, updated, "fresh"))
	}
}

func TestIncrementReachesANestedField(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("nested.deep", int32(1))})}),
	})

	if value(t, updated, "nested.deep") != int64(6) {
		t.Errorf("nested.deep is %#v, want 6", value(t, updated, "nested.deep"))
	}
}

func TestUnsetRemovesAFieldAtAnyDepth(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{}),
		f("u", bson.D{f("$unset", bson.D{f("sku.deeper", ""), f("n", ""), f("nested.deep", ""), f("absent", "")})}),
	})

	if _, present := mongocmd.Lookup(updated, "n"); present {
		t.Errorf("$unset left n behind: %v", updated)
	}
	if value(t, updated, "nested.deep") != nil {
		t.Errorf("$unset left nested.deep behind: %v", updated)
	}
}

// A replacement changes what a document holds, never which document it is.
func TestAReplacementKeepsTheIdentifier(t *testing.T) {
	store := seeded(t, one)
	before := documents(t, run(t, store, bson.D{f("find", "things")}), "firstBatch")[0]

	updated := updating(t, store, bson.D{
		f("q", bson.D{}), f("u", bson.D{f("only", "this")}),
	})

	if !equal(value(t, before, "_id"), value(t, updated, "_id")) {
		t.Errorf("the _id changed from %v to %v", value(t, before, "_id"), value(t, updated, "_id"))
	}
	if _, present := mongocmd.Lookup(updated, "sku"); present {
		t.Errorf("the replacement kept a field it did not carry: %v", updated)
	}
}

func TestAnUpdateThatMatchedNothingCreatesTheDocumentWhenAskedTo(t *testing.T) {
	store := seeded(t, one)

	reply := run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{f("sku", "fresh"), f("n", bson.D{f("$gt", int32(1))})}),
		f("u", bson.D{f("$set", bson.D{f("made", true)})}),
		f("upsert", true),
	}})})

	if number(t, reply, "n") != 1 {
		t.Errorf("an upsert reported n=%d, want 1", number(t, reply, "n"))
	}
	if _, created := mongocmd.Lookup(reply, "upserted"); !created {
		t.Errorf("%v does not report what it created", reply)
	}
	// The equality half of the filter describes the document; the $gt half is a
	// search and cannot.
	found := find(t, store, bson.D{f("made", true)})
	if len(found) != 1 || found[0] != "fresh" {
		t.Errorf("the upserted document is %v, want the filter's sku on it", found)
	}
}

func TestAnUpsertThatMatchedSomethingJustUpdatesIt(t *testing.T) {
	store := seeded(t, one)

	run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{f("sku", "a")}),
		f("u", bson.D{f("$set", bson.D{f("touched", true)})}),
		f("upsert", true),
	}})})

	if store.Count("things") != 1 {
		t.Errorf("the collection holds %d, want the one document updated in place", store.Count("things"))
	}
}

// The difference a driver reports as matched_count against modified_count, which
// is the whole of a lesson about idempotence.
func TestAnUpdateThatChangedNothingIsMatchedButNotModified(t *testing.T) {
	store := seeded(t, one)

	reply := run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("n", int32(1))})}),
	}})})

	if number(t, reply, "n") != 1 || number(t, reply, "nModified") != 0 {
		t.Errorf("reply = %v, want one matched and none modified", reply)
	}
}

func TestMultiUpdatesEveryMatchAndTheDefaultUpdatesOne(t *testing.T) {
	store := seeded(t, `{"things": [{"sku": "a"}, {"sku": "b"}]}`)

	firstOnly := run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("seen", int32(1))})}),
	}})})
	everyOne := run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("seen", int32(2))})}), f("multi", true),
	}})})

	if number(t, firstOnly, "n") != 1 {
		t.Errorf("without multi = %v, want one match", firstOnly)
	}
	if number(t, everyOne, "n") != 2 || number(t, everyOne, "nModified") != 2 {
		t.Errorf("with multi = %v, want both", everyOne)
	}
}

func TestAnUpdateEmuCannotApplyIsRefusedByName(t *testing.T) {
	store := seeded(t, one)

	for _, want := range []struct {
		specification bson.D
		blamed        string
	}{
		{bson.D{f("u", bson.D{})}, `an update needs a "q" field`},
		{bson.D{f("q", bson.D{})}, `an update needs a "u" field`},
		{bson.D{f("q", "not a document"), f("u", bson.D{})}, "an update.q is string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{}), f("multi", "yes")}, "an update.multi is string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$push", bson.D{f("tags", "x")})})}, "$push update operator"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$set", "not a document")})}, "$set is string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("x", 1)}), f("plain", 1)})}, "not both"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("n", "one")})})}, "$inc on n is string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("sku", int32(1))})})}, "which holds string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{}), f("upsert", "yes")}, "an update.upsert is string"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("n.deeper", int32(1))})})}, "cannot create"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("nested.deep.x", int32(1))})})}, "cannot create"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$inc", bson.D{f("sku.deeper", int32(1))})})}, "cannot create"},
		{bson.D{f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("_id", int32(99))})})}, "immutable field"},
	} {
		err := refuse(t, store, bson.D{f("update", "things"), f("updates", bson.A{want.specification})})

		if !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("%v = %v, want %q blamed", want.specification, err, want.blamed)
		}
	}
}

// An upsert builds its document out of the filter, so a filter that cannot
// describe a document has to fail there too.
func TestAnUpsertThatCannotBuildItsDocumentSaysSo(t *testing.T) {
	store := seeded(t, one)

	for _, specification := range []bson.D{
		{f("q", bson.D{f("a", int32(1)), f("a.b", int32(2))}), f("u", bson.D{f("$set", bson.D{f("x", int32(1))})}), f("upsert", true)},
		{f("q", bson.D{f("sku", "fresh")}), f("u", bson.D{f("$bad", bson.D{})}), f("upsert", true)},
	} {
		err := refuse(t, store, bson.D{f("update", "things"), f("updates", bson.A{specification})})

		if err == nil {
			t.Errorf("%v was accepted", specification)
		}
	}
}

// A second document with an _id the collection already holds is a duplicate
// however it got there.
func TestAnUpsertOntoATakenIdentifierIsADuplicate(t *testing.T) {
	store := seeded(t, `{"things": [{"_id": 1, "sku": "a"}]}`)

	err := refuse(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{f("_id", int32(1)), f("sku", "b")}),
		f("u", bson.D{f("$set", bson.D{f("x", int32(1))})}),
		f("upsert", true),
	}})})

	if !strings.Contains(err.Error(), "duplicate key") {
		t.Errorf("err = %v, want a duplicate key", err)
	}
}

// An upsert whose update is a replacement builds a document that has no _id yet,
// which is the one place a replacement has none to keep.
func TestAnUpsertOfAReplacementIsGivenAnIdentifier(t *testing.T) {
	store := seeded(t, one)

	run(t, store, bson.D{f("update", "things"), f("updates", bson.A{bson.D{
		f("q", bson.D{f("$or", bson.A{bson.D{f("sku", "fresh")}}), f("sku", "fresh")}),
		f("u", bson.D{f("made", true)}),
		f("upsert", true),
	}})})

	created := documents(t, run(t, store, bson.D{f("find", "things"), f("filter", bson.D{f("made", true)})}), "firstBatch")
	if len(created) != 1 || created[0][0].Key != identifierField {
		t.Errorf("the upserted document is %v, want an _id first", created)
	}
	// The $or half of the filter is a search rather than a description, so it is
	// not part of what was created.
	if _, present := mongocmd.Lookup(created[0], "$or"); present {
		t.Errorf("the filter's operators leaked into the document: %v", created[0])
	}
}

// $unset on a path whose first step is not there has nothing to remove and does
// not invent one on the way.
func TestUnsettingAPathThatIsNotThereChangesNothing(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$unset", bson.D{f("missing.deep", "")})}),
	})

	if _, invented := mongocmd.Lookup(updated, "missing"); invented {
		t.Errorf("$unset created what it was asked to remove: %v", updated)
	}
}

func TestUpdatingAFieldDoesNotReorderTheDocument(t *testing.T) {
	updated := updating(t, seeded(t, one), bson.D{
		f("q", bson.D{}), f("u", bson.D{f("$set", bson.D{f("sku", "z")})}),
	})

	if updated[1].Key != "sku" {
		t.Errorf("the document reordered to %v", updated)
	}
}
