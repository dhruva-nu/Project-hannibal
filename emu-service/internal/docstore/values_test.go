package docstore

import (
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// MongoDB orders values of different types by a fixed order of the types
// themselves. A student who sorts a field that holds numbers in some documents
// and strings in others has to get MongoDB's answer rather than Go's.
func TestTypesSortInMongoDBsOrder(t *testing.T) {
	ascending := []any{
		bson.MinKey{},
		nil,
		int32(1),
		"a",
		bson.D{f("a", int32(1))},
		bson.A{int32(1)},
		bson.Binary{Data: []byte{1}},
		bson.ObjectID{1},
		false,
		bson.DateTime(1),
		bson.Timestamp{T: 1},
		bson.Regex{Pattern: "a"},
		bson.MaxKey{},
		bson.Decimal128{}, // a type emu was never taught to order sorts last
	}

	for left := range ascending {
		for right := range ascending {
			want := sign(left - right)
			if got := compare(ascending[left], ascending[right]); got != want {
				t.Errorf("compare(%T, %T) = %d, want %d", ascending[left], ascending[right], got, want)
			}
		}
	}
}

func TestValuesOfOneTypeCompareWithinIt(t *testing.T) {
	for _, want := range []struct {
		left, right any
		order       int
	}{
		{int32(1), int64(2), -1},
		{int64(2), 2.5, -1},
		{2.5, int(3), -1},
		{int32(2), int64(2), 0},
		{"a", "b", -1},
		{bson.D{f("a", int32(1))}, bson.D{f("a", int32(2))}, -1},
		{bson.D{f("a", int32(1))}, bson.D{f("b", int32(1))}, -1},
		{bson.D{f("a", int32(1))}, bson.D{f("a", int32(1)), f("b", int32(2))}, -1},
		{bson.A{int32(1)}, bson.A{int32(2)}, -1},
		{bson.A{int32(1)}, bson.A{int32(1), int32(2)}, -1},
		{bson.Binary{Data: []byte{1}}, bson.Binary{Data: []byte{2}}, -1},
		{bson.ObjectID{1}, bson.ObjectID{2}, -1},
		{false, true, -1},
		{bson.DateTime(1), bson.DateTime(2), -1},
		{bson.Timestamp{T: 1, I: 9}, bson.Timestamp{T: 2}, -1},
		{bson.Timestamp{T: 1, I: 1}, bson.Timestamp{T: 1, I: 2}, -1},
		{bson.Regex{Pattern: "a"}, bson.Regex{Pattern: "b"}, -1},
		{bson.Regex{Pattern: "a", Options: "i"}, bson.Regex{Pattern: "a", Options: "m"}, -1},
		{bson.Null{}, bson.Undefined{}, 0},
		{bson.MinKey{}, bson.MinKey{}, 0},
	} {
		if got := compare(want.left, want.right); got != want.order {
			t.Errorf("compare(%v, %v) = %d, want %d", want.left, want.right, got, want.order)
		}
		if got := compare(want.right, want.left); got != -want.order {
			t.Errorf("compare(%v, %v) = %d, want %d", want.right, want.left, got, -want.order)
		}
	}
}

// Sorting places a number before a string; equality does not make them equal.
func TestEqualityIsNotOrdering(t *testing.T) {
	if equal(int32(1), "1") || !equal(int32(1), int64(1)) {
		t.Error("equality crossed a type boundary, or refused to cross a width")
	}
}

// A map has no order, so a comparison that read Go's map iteration would order
// two identical documents differently each run.
func TestAKeyedDocumentComparesTheSameWayEveryTime(t *testing.T) {
	keyed := bson.M{"b": int32(2), "a": int32(1)}
	ordered := bson.D{f("a", int32(1)), f("b", int32(2))}

	for range 20 {
		if compare(keyed, ordered) != 0 {
			t.Fatalf("compare(%v, %v) is not stable", keyed, ordered)
		}
	}
}

// The store hands documents to one client and takes updates back from another,
// and a shared slice would let a read see a half-finished write.
func TestCloningIsDeep(t *testing.T) {
	original := bson.D{f("nested", bson.D{f("list", bson.A{int32(1)})})}

	copied := cloneDocument(original)
	copied[0].Value.(bson.D)[0].Value.(bson.A)[0] = int32(99)

	if original[0].Value.(bson.D)[0].Value.(bson.A)[0] != int32(1) {
		t.Errorf("the original changed to %v", original)
	}
}

func TestAPathThroughSomethingThatIsNotADocumentReachesNothing(t *testing.T) {
	document := bson.D{f("n", int32(1)), f("list", bson.A{int32(1), int32(2)})}

	if values := valuesAt(document, "n.deeper"); values != nil {
		t.Errorf("n.deeper = %v, want nothing", values)
	}
	if values := valuesAt(document, "list.9"); values != nil {
		t.Errorf("list.9 = %v, want nothing", values)
	}
	if values := valuesAt(document, "list.0"); len(values) != 1 || values[0] != int32(1) {
		t.Errorf("list.0 = %v, want the first element", values)
	}
}
