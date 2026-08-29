package docstore

import (
	"slices"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

const ranked = `{"things": [
	{"sku": "c", "n": 3},
	{"sku": "a", "n": 1},
	{"sku": "b", "n": 2},
	{"sku": "d"}
]}`

func skusOf(found []bson.D) []string {
	skus := make([]string, 0, len(found))
	for _, document := range found {
		value, _ := mongocmd.Lookup(document, "sku")
		skus = append(skus, value.(string))
	}
	return skus
}

func TestFindReturnsDocumentsInInsertionOrderUnlessAskedOtherwise(t *testing.T) {
	store := seeded(t, ranked)

	natural := run(t, store, bson.D{f("find", "things")})
	ascending := run(t, store, bson.D{f("find", "things"), f("sort", bson.D{f("sku", int32(1))})})
	descending := run(t, store, bson.D{f("find", "things"), f("sort", bson.D{f("sku", int32(-1))})})

	if got := skusOf(documents(t, natural, "firstBatch")); !slices.Equal(got, []string{"c", "a", "b", "d"}) {
		t.Errorf("unsorted = %v, want insertion order", got)
	}
	if got := skusOf(documents(t, ascending, "firstBatch")); !slices.Equal(got, []string{"a", "b", "c", "d"}) {
		t.Errorf("ascending = %v", got)
	}
	if got := skusOf(documents(t, descending, "firstBatch")); !slices.Equal(got, []string{"d", "c", "b", "a"}) {
		t.Errorf("descending = %v", got)
	}
}

// A document without the sort key sorts as if it held null, which puts it before
// every number — MongoDB's answer, and not the one a student expects.
func TestAMissingSortKeySortsAsNull(t *testing.T) {
	store := seeded(t, ranked)

	found := run(t, store, bson.D{f("find", "things"), f("sort", bson.D{f("n", int32(1))})})

	if got := skusOf(documents(t, found, "firstBatch")); !slices.Equal(got, []string{"d", "a", "b", "c"}) {
		t.Errorf("sorted by n = %v, want the document with no n first", got)
	}
}

func TestSkipAndLimitApplyInThatOrder(t *testing.T) {
	store := seeded(t, ranked)

	windowed := run(t, store, bson.D{
		f("find", "things"),
		f("sort", bson.D{f("sku", int32(1))}),
		f("skip", int32(1)),
		f("limit", int32(2)),
	})
	past := run(t, store, bson.D{f("find", "things"), f("skip", int32(99))})

	if got := skusOf(documents(t, windowed, "firstBatch")); !slices.Equal(got, []string{"b", "c"}) {
		t.Errorf("skip 1 limit 2 = %v", got)
	}
	if found := documents(t, past, "firstBatch"); len(found) != 0 {
		t.Errorf("skipping past the end = %v, want nothing", found)
	}
}

// A negative limit is the wire protocol's own shorthand for "one batch is all I
// want", which is what find_one still sends in some drivers.
func TestANegativeLimitIsOneBatchOfThatMany(t *testing.T) {
	store := seeded(t, ranked)

	found := run(t, store, bson.D{f("find", "things"), f("limit", int32(-2)), f("batchSize", int32(1))})

	if got := documents(t, found, "firstBatch"); len(got) != 2 {
		t.Errorf("limit -2 with batchSize 1 = %d documents, want both in one batch", len(got))
	}
	if cursorOf(t, found) != 0 {
		t.Errorf("a single batch left cursor %d open", cursorOf(t, found))
	}
}

func cursorOf(t *testing.T, reply bson.D) int64 {
	t.Helper()

	cursor, _ := mongocmd.Lookup(reply, "cursor")
	identifier, _ := mongocmd.Lookup(cursor.(bson.D), "id")
	return identifier.(int64)
}

func TestAResultLongerThanABatchIsPagedThroughGetMore(t *testing.T) {
	store := seeded(t, ranked)

	first := run(t, store, bson.D{f("find", "things"), f("batchSize", int32(2))})
	identifier := cursorOf(t, first)
	if identifier == 0 {
		t.Fatalf("%v left no cursor open", first)
	}

	second := run(t, store, bson.D{f("getMore", identifier), f("collection", "things"), f("batchSize", int32(1))})
	third := run(t, store, bson.D{f("getMore", identifier), f("collection", "things")})

	if got := len(documents(t, first, "firstBatch")); got != 2 {
		t.Errorf("the first batch held %d, want 2", got)
	}
	if got := len(documents(t, second, "nextBatch")); got != 1 || cursorOf(t, second) != identifier {
		t.Errorf("the second batch held %d and left cursor %d", got, cursorOf(t, second))
	}
	if got := len(documents(t, third, "nextBatch")); got != 1 || cursorOf(t, third) != 0 {
		t.Errorf("the last batch held %d and left cursor %d, want it closed", got, cursorOf(t, third))
	}
}

// An exhausted cursor is gone. Answering "no more documents" instead would look
// to the client like the collection was short.
func TestAGetMoreForACursorThatIsGoneIsAFailureRatherThanAnEmptyPage(t *testing.T) {
	store := seeded(t, ranked)

	err := refuse(t, store, bson.D{f("getMore", int64(99)), f("collection", "things")})

	code, _ := mongocmd.CodeOf(err)
	if code != mongocmd.CodeCursorNotFound {
		t.Errorf("getMore = %v (code %d), want %d", err, code, mongocmd.CodeCursorNotFound)
	}
}

func TestKillCursorsClosesWhatIsOpenAndSaysWhatWasNot(t *testing.T) {
	store := seeded(t, ranked)
	identifier := cursorOf(t, run(t, store, bson.D{f("find", "things"), f("batchSize", int32(1))}))

	reply := run(t, store, bson.D{f("killCursors", "things"), f("cursors", bson.A{identifier, int64(404)})})

	killed, _ := mongocmd.Lookup(reply, "cursorsKilled")
	missing, _ := mongocmd.Lookup(reply, "cursorsNotFound")
	if len(killed.(bson.A)) != 1 || len(missing.(bson.A)) != 1 {
		t.Errorf("reply = %v, want one killed and one not found", reply)
	}
	if refuse(t, store, bson.D{f("getMore", identifier), f("collection", "things")}) == nil {
		t.Error("the killed cursor still answers")
	}
}

func TestProjectionKeepsOrDropsFieldsAndAlwaysDecidesAboutTheIdentifier(t *testing.T) {
	store := seeded(t, `{"things": [{"sku": "a", "n": 1, "extra": true}]}`)

	including := documents(t, run(t, store, bson.D{f("find", "things"), f("projection", bson.D{f("sku", int32(1))})}), "firstBatch")[0]
	withoutID := documents(t, run(t, store, bson.D{f("find", "things"), f("projection", bson.D{f("_id", int32(0)), f("sku", int32(1))})}), "firstBatch")[0]
	excluding := documents(t, run(t, store, bson.D{f("find", "things"), f("projection", bson.D{f("extra", false)})}), "firstBatch")[0]

	if len(including) != 2 || including[0].Key != "_id" || including[1].Key != "sku" {
		t.Errorf("including sku = %v, want _id and sku", including)
	}
	if len(withoutID) != 1 || withoutID[0].Key != "sku" {
		t.Errorf("with _id dropped = %v, want sku alone", withoutID)
	}
	if _, present := mongocmd.Lookup(excluding, "extra"); present || len(excluding) != 3 {
		t.Errorf("excluding extra = %v", excluding)
	}
}

func TestADottedProjectionNarrowsWhatIsUnderTheFieldRatherThanReplacingIt(t *testing.T) {
	store := seeded(t, `{"things": [
		{"sku": "a", "address": {"city": "Leeds", "postcode": "LS1"}, "items": [{"code": 1, "note": "x"}]}
	]}`)

	narrowed := documents(t, run(t, store, bson.D{
		f("find", "things"),
		f("projection", bson.D{f("_id", int32(0)), f("address.city", int32(1)), f("items.code", int32(1))}),
	}), "firstBatch")[0]
	dropped := documents(t, run(t, store, bson.D{
		f("find", "things"), f("projection", bson.D{f("address.postcode", int32(0))}),
	}), "firstBatch")[0]

	if value(t, narrowed, "address.city") != "Leeds" || value(t, narrowed, "address.postcode") != nil {
		t.Errorf("narrowed = %v", narrowed)
	}
	if value(t, narrowed, "items.code") != int32(1) || value(t, narrowed, "items.note") != nil {
		t.Errorf("the array was not narrowed: %v", narrowed)
	}
	if value(t, dropped, "address.city") != "Leeds" || value(t, dropped, "address.postcode") != nil {
		t.Errorf("dropped = %v", dropped)
	}
}

// A projection with no _id in the document it narrows has none to put back.
func TestAProjectionOfADocumentWithNoIdentifierAddsNone(t *testing.T) {
	store := New()
	t.Cleanup(func() { _ = store.Close() })
	store.collect("things").documents = []bson.D{{f("sku", "a")}}

	found := documents(t, run(t, store, bson.D{f("find", "things"), f("projection", bson.D{f("sku", int32(1))})}), "firstBatch")

	if len(found[0]) != 1 {
		t.Errorf("projected = %v, want sku alone", found[0])
	}
}

func TestAFindEmuCannotAnswerIsRefusedByName(t *testing.T) {
	store := seeded(t, ranked)

	for _, want := range []struct {
		command bson.D
		blamed  string
	}{
		{bson.D{f("find", "things"), f("filter", "not a document")}, "find.filter is string"},
		{bson.D{f("find", "things"), f("projection", "no")}, "find.projection is string"},
		{bson.D{f("find", "things"), f("sort", "no")}, "find.sort is string"},
		{bson.D{f("find", "things"), f("skip", "no")}, "find.skip is string"},
		{bson.D{f("find", "things"), f("limit", "no")}, "find.limit is string"},
		{bson.D{f("find", "things"), f("batchSize", "no")}, "find.batchSize is string"},
		{bson.D{f("find", "things"), f("singleBatch", "no")}, "find.singleBatch is string"},
		{bson.D{f("find", "things"), f("sort", bson.D{f("sku", "up")})}, `sort on "sku"`},
		{bson.D{f("find", "things"), f("projection", bson.D{f("sku", int32(1)), f("n", int32(0))})}, "includes or excludes, not both"},
		{bson.D{f("find", "things"), f("projection", bson.D{f("sku", bson.D{f("$slice", int32(1))})})}, "not a simple include or exclude"},
		{bson.D{f("getMore", "seven"), f("collection", "things")}, "takes a cursor id"},
		{bson.D{f("getMore", int64(1)), f("collection", "things"), f("batchSize", "no")}, "getMore.batchSize is string"},
		{bson.D{f("killCursors", "things")}, "killCursors needs an array"},
		{bson.D{f("killCursors", "things"), f("cursors", bson.A{"seven"})}, "takes a cursor id"},
	} {
		err := refuse(t, store, want.command)

		if !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("%v = %v, want %q blamed", want.command, err, want.blamed)
		}
	}
}

// A dotted projection whose prefix holds something that is not a document has
// nothing to narrow, and leaves the value where it is.
func TestADottedProjectionOverAScalarLeavesItAlone(t *testing.T) {
	store := seeded(t, `{"things": [{"sku": "a", "n": 1}]}`)

	projected := documents(t, run(t, store, bson.D{
		f("find", "things"), f("projection", bson.D{f("_id", int32(0)), f("n.deep", int32(1))}),
	}), "firstBatch")[0]

	if len(projected) != 1 || projected[0].Key != "n" || projected[0].Value != int32(1) {
		t.Errorf("projected = %v, want n untouched", projected)
	}
}

// A projection of true or false means the same as one of 1 or 0, and drivers
// send both.
func TestAProjectionTakesBooleansAsWellAsNumbers(t *testing.T) {
	store := seeded(t, `{"things": [{"sku": "a", "n": 1}]}`)

	projected := documents(t, run(t, store, bson.D{
		f("find", "things"), f("projection", bson.D{f("_id", false), f("sku", true)}),
	}), "firstBatch")[0]

	if len(projected) != 1 || projected[0].Key != "sku" {
		t.Errorf("projected = %v, want sku alone", projected)
	}
}

// A cursor is server-scoped rather than connection-scoped, because a driver's
// pool is free to send the getMore down a different socket.
func TestACursorOpenedOnOneConnectionIsReadableFromAnother(t *testing.T) {
	store := seeded(t, ranked)
	identifier := cursorOf(t, run(t, store, bson.D{f("find", "things"), f("batchSize", int32(1))}))

	// attempt opens its own executor each time, which is a second connection as
	// far as the backend is concerned.
	if _, err := attempt(store, bson.D{f("getMore", identifier), f("collection", "things")}); err != nil {
		t.Errorf("getMore from another connection = %v", err)
	}
}
