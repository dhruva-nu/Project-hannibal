package docstore

import (
	"slices"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// A student who writes the wrong filter has to get the wrong documents back.
// These are the semantics that promise it, and every one of them is a way a
// canned fixture would have quietly agreed with whatever was asked.

const things = `{"things": [
	{"sku": "a", "n": 1,     "tags": ["red", "blue"], "nested": {"deep": 5},  "text": "Hello"},
	{"sku": "b", "n": 10,    "tags": ["blue"],        "nested": {"deep": 50}, "text": "world"},
	{"sku": "c", "n": "ten", "items": [{"code": 1}, {"code": 2}]},
	{"sku": "d"}
]}`

func matching(t *testing.T, filter bson.D, want ...string) {
	t.Helper()

	found := find(t, seeded(t, things), filter)

	if !slices.Equal(found, want) {
		t.Errorf("%v matched %v, want %v", filter, found, want)
	}
}

func TestEqualityReachesInsideAnArrayWithoutBeingAsked(t *testing.T) {
	matching(t, bson.D{f("n", int32(1))}, "a")
	matching(t, bson.D{f("tags", "blue")}, "a", "b")
	matching(t, bson.D{f("tags", bson.A{"red", "blue"})}, "a")
}

func TestADottedPathDescendsIntoDocumentsAndArraysAlike(t *testing.T) {
	matching(t, bson.D{f("nested.deep", int32(50))}, "b")
	matching(t, bson.D{f("items.code", int32(2))}, "c")
	matching(t, bson.D{f("tags.0", "red")}, "a")
	matching(t, bson.D{f("nested.deep.deeper", int32(1))})
}

// MongoDB's rule, and the one most likely to surprise: a filter for null finds
// the documents that do not have the field at all.
func TestAFilterForNullFindsAMissingFieldToo(t *testing.T) {
	matching(t, bson.D{f("nested", nil)}, "c", "d")
}

// Comparison operators compare within a BSON type and no further, so a filter
// for numbers over five does not find the document whose n is "ten".
func TestComparisonStaysInsideOneType(t *testing.T) {
	matching(t, bson.D{f("n", bson.D{f("$gt", int32(5))})}, "b")
	matching(t, bson.D{f("n", bson.D{f("$gte", int32(1))})}, "a", "b")
	matching(t, bson.D{f("n", bson.D{f("$lt", int32(10))})}, "a")
	matching(t, bson.D{f("n", bson.D{f("$lte", int32(10))})}, "a", "b")
}

func TestEqualityAndItsNegation(t *testing.T) {
	matching(t, bson.D{f("sku", bson.D{f("$eq", "b")})}, "b")
	matching(t, bson.D{f("sku", bson.D{f("$ne", "b")})}, "a", "c", "d")
}

func TestMembership(t *testing.T) {
	matching(t, bson.D{f("sku", bson.D{f("$in", bson.A{"a", "c"})})}, "a", "c")
	matching(t, bson.D{f("sku", bson.D{f("$nin", bson.A{"a", "c"})})}, "b", "d")
	matching(t, bson.D{f("tags", bson.D{f("$in", bson.A{"red"})})}, "a")
}

func TestMembershipTakesAPatternAmongTheValues(t *testing.T) {
	matching(t, bson.D{f("text", bson.D{f("$in", bson.A{bson.Regex{Pattern: "^Hel"}})})}, "a")
}

func TestExistence(t *testing.T) {
	matching(t, bson.D{f("tags", bson.D{f("$exists", true)})}, "a", "b")
	matching(t, bson.D{f("tags", bson.D{f("$exists", false)})}, "c", "d")
}

func TestTwoConditionsOnOneFieldBothHave(t *testing.T) {
	matching(t, bson.D{f("n", bson.D{f("$gte", int32(1)), f("$lt", int32(10))})}, "a")
}

func TestLogicalCombination(t *testing.T) {
	matching(t, bson.D{f("$and", bson.A{
		bson.D{f("tags", "blue")},
		bson.D{f("n", bson.D{f("$gt", int32(5))})},
	})}, "b")
	matching(t, bson.D{f("$or", bson.A{
		bson.D{f("sku", "a")},
		bson.D{f("sku", "d")},
	})}, "a", "d")
}

func TestNegation(t *testing.T) {
	matching(t, bson.D{f("n", bson.D{f("$not", bson.D{f("$gt", int32(5))})})}, "a", "c", "d")
	matching(t, bson.D{f("text", bson.D{f("$not", bson.Regex{Pattern: "^Hel"})})}, "b", "c", "d")
}

func TestPatterns(t *testing.T) {
	matching(t, bson.D{f("text", bson.D{f("$regex", "^hel"), f("$options", "i")})}, "a")
	matching(t, bson.D{f("text", bson.D{f("$regex", "^hel")})})
	matching(t, bson.D{f("text", bson.Regex{Pattern: "orl"})}, "b")
	matching(t, bson.D{f("text", bson.D{f("$regex", bson.Regex{Pattern: "^HEL", Options: "i"})})}, "a")
}

// An embedded document that is not a set of operators is a value to compare
// against whole, field order and all.
func TestAnEmbeddedDocumentIsComparedWhole(t *testing.T) {
	matching(t, bson.D{f("nested", bson.D{f("deep", int32(5))})}, "a")
	matching(t, bson.D{f("nested", bson.D{})})
}

func TestAFilterEmuCannotEvaluateIsRefusedByName(t *testing.T) {
	for _, want := range []struct {
		filter bson.D
		blamed string
	}{
		{bson.D{f("n", bson.D{f("$size", int32(2))})}, "$size"},
		{bson.D{f("$where", "true")}, "$where"},
		{bson.D{f("$and", "not a list")}, "$and needs a non-empty array"},
		{bson.D{f("$or", bson.A{})}, "$or needs a non-empty array"},
		{bson.D{f("$and", bson.A{"not a filter"})}, "$and[0] is string"},
		{bson.D{f("$and", bson.A{bson.D{f("$where", "true")}})}, "$where"},
		{bson.D{f("text", bson.D{f("$in", bson.A{bson.Regex{Pattern: "(["}})})}, "not a regular expression"},
		{bson.D{f("n", bson.D{f("$in", "not a list")})}, "$in needs an array"},
		{bson.D{f("n", bson.D{f("$exists", int32(1))})}, "$exists needs true or false"},
		{bson.D{f("n", bson.D{f("$options", "i")})}, "$options needs a $regex"},
		{bson.D{f("n", bson.D{f("$not", "neither")})}, "$not needs a set of operators"},
		{bson.D{f("text", bson.D{f("$regex", int32(1))})}, "$regex is int32"},
		{bson.D{f("text", bson.D{f("$regex", "([")})}, "not a regular expression emu can compile"},
		{bson.D{f("text", bson.D{f("$regex", "a"), f("$options", "x")})}, `the "x" regular expression option`},
		{bson.D{f("text", bson.D{f("$regex", bson.Regex{Pattern: "a"}), f("$options", "i")})}, "carries its own"},
	} {
		err := refuse(t, seeded(t, things), bson.D{f("find", "things"), f("filter", want.filter)})

		if !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("%v = %v, want %q blamed", want.filter, err, want.blamed)
		}
	}
}

// A filter emu cannot evaluate has to be refused wherever it is used, not only
// on the read path — a delete that quietly matched nothing would be worse.
func TestAnUnevaluatableFilterIsRefusedOnEveryPath(t *testing.T) {
	broken := bson.D{f("$where", "true")}
	store := seeded(t, things)

	for _, command := range []bson.D{
		{f("count", "things"), f("query", broken)},
		{f("update", "things"), f("updates", bson.A{bson.D{f("q", broken), f("u", bson.D{})}})},
		{f("delete", "things"), f("deletes", bson.A{bson.D{f("q", broken), f("limit", int32(0))}})},
		{f("aggregate", "things"), f("pipeline", bson.A{bson.D{f("$match", broken)}}), f("cursor", bson.D{})},
	} {
		if err := refuse(t, store, command); !strings.Contains(err.Error(), "$where") {
			t.Errorf("%v = %v, want $where blamed", command, err)
		}
	}
}
