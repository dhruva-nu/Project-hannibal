package docstore

import (
	"bytes"
	"slices"
	"strconv"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// MongoDB compares values of different types by a fixed order of the types
// themselves, so that a sort never has to say two values are incomparable. These
// are those ranks, in MongoDB's own sequence. A student who sorts a field that
// holds numbers in some documents and strings in others must get MongoDB's
// answer, not Go's — that is the whole reason emu evaluates queries rather than
// canning them.
const (
	rankMinKey = iota
	rankNull
	rankNumber
	rankString
	rankObject
	rankArray
	rankBinary
	rankObjectID
	rankBool
	rankDate
	rankTimestamp
	rankRegex
	rankMaxKey
	// rankUnknown is where a BSON type emu was never taught to order goes. It
	// sorts after everything and compares equal to its own kind, which is wrong
	// in the small and much better than a panic in a student's query.
	rankUnknown
)

func rankOf(value any) int {
	switch value.(type) {
	case bson.MinKey:
		return rankMinKey
	case nil, bson.Null, bson.Undefined:
		return rankNull
	case int32, int64, float64, int:
		return rankNumber
	case string:
		return rankString
	case bson.D, bson.M:
		return rankObject
	case bson.A:
		return rankArray
	case bson.Binary:
		return rankBinary
	case bson.ObjectID:
		return rankObjectID
	case bool:
		return rankBool
	case bson.DateTime:
		return rankDate
	case bson.Timestamp:
		return rankTimestamp
	case bson.Regex:
		return rankRegex
	case bson.MaxKey:
		return rankMaxKey
	default:
		return rankUnknown
	}
}

// compare orders two BSON values the way MongoDB does: by type first, then
// within the type. It is what $lt, $gt, and sort are all built out of.
func compare(left, right any) int {
	leftRank, rightRank := rankOf(left), rankOf(right)
	if leftRank != rightRank {
		return sign(leftRank - rightRank)
	}

	switch leftRank {
	case rankNumber:
		return compareFloat(numberOf(left), numberOf(right))
	case rankString:
		return strings.Compare(left.(string), right.(string))
	case rankObject:
		return compareDocuments(asDocument(left), asDocument(right))
	case rankArray:
		return compareArrays(left.(bson.A), right.(bson.A))
	case rankBinary:
		return bytes.Compare(left.(bson.Binary).Data, right.(bson.Binary).Data)
	case rankObjectID:
		leftID, rightID := left.(bson.ObjectID), right.(bson.ObjectID)
		return bytes.Compare(leftID[:], rightID[:])
	case rankBool:
		return sign(boolRank(left.(bool)) - boolRank(right.(bool)))
	case rankDate:
		return compareInt(int64(left.(bson.DateTime)), int64(right.(bson.DateTime)))
	case rankTimestamp:
		return compareTimestamps(left.(bson.Timestamp), right.(bson.Timestamp))
	case rankRegex:
		return compareRegexes(left.(bson.Regex), right.(bson.Regex))
	default:
		// MinKey, MaxKey, null, and anything emu cannot order carry no value to
		// order by: every one of them equals every other of its own type.
		return 0
	}
}

// equal is comparison narrowed to what $eq means, which is not the same thing:
// two values of different types are never equal however the sort orders them.
func equal(left, right any) bool {
	return rankOf(left) == rankOf(right) && compare(left, right) == 0
}

// numberOf flattens the three widths BSON writes numbers in. Comparing them as
// float64 loses precision past 2^53, which is the same place a student's own
// arithmetic in Python or JavaScript loses it.
func numberOf(value any) float64 {
	switch typed := value.(type) {
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	default:
		return value.(float64)
	}
}

func isNumber(value any) bool { return rankOf(value) == rankNumber }

// asDocument reads either shape a document arrives in. bson.M loses field order
// and emu never produces one, but a value that came out of a client's own
// marshalling can be either.
func asDocument(value any) bson.D {
	if document, ordered := value.(bson.D); ordered {
		return document
	}
	keyed := value.(bson.M)
	document := make(bson.D, 0, len(keyed))
	for key, held := range keyed {
		document = append(document, mongocmd.Field(key, held))
	}
	// Sorted, because a map has no order and a comparison that depends on Go's
	// map iteration would order two identical documents differently each run.
	slices.SortFunc(document, func(left, right bson.E) int {
		return strings.Compare(left.Key, right.Key)
	})
	return document
}

// compareDocuments compares field by field, key before value, as MongoDB does.
// Field order is part of a BSON document's identity, so {a:1,b:2} and {b:2,a:1}
// are not the same value.
func compareDocuments(left, right bson.D) int {
	for index := range min(len(left), len(right)) {
		if order := strings.Compare(left[index].Key, right[index].Key); order != 0 {
			return order
		}
		if order := compare(left[index].Value, right[index].Value); order != 0 {
			return order
		}
	}
	return sign(len(left) - len(right))
}

func compareArrays(left, right bson.A) int {
	for index := range min(len(left), len(right)) {
		if order := compare(left[index], right[index]); order != 0 {
			return order
		}
	}
	return sign(len(left) - len(right))
}

func compareTimestamps(left, right bson.Timestamp) int {
	if order := compareInt(int64(left.T), int64(right.T)); order != 0 {
		return order
	}
	return compareInt(int64(left.I), int64(right.I))
}

func compareRegexes(left, right bson.Regex) int {
	if order := strings.Compare(left.Pattern, right.Pattern); order != 0 {
		return order
	}
	return strings.Compare(left.Options, right.Options)
}

func compareFloat(left, right float64) int {
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	default:
		return 0
	}
}

func compareInt(left, right int64) int { return sign(int(left - right)) }

func boolRank(value bool) int {
	if value {
		return 1
	}
	return 0
}

func sign(difference int) int {
	switch {
	case difference < 0:
		return -1
	case difference > 0:
		return 1
	default:
		return 0
	}
}

// resolve follows a dotted path and answers every value it reaches — plural,
// because MongoDB descends into arrays without being asked: "items.sku" reaches
// the sku of every element of items, which is why a filter on it matches a
// document whose items are a list.
func resolve(value any, path []string) []any {
	if len(path) == 0 {
		return []any{value}
	}

	switch container := value.(type) {
	case bson.D:
		held, present := mongocmd.Lookup(container, path[0])
		if !present {
			return nil
		}
		return resolve(held, path[1:])
	case bson.A:
		return resolveArray(container, path)
	default:
		return nil
	}
}

// resolveArray reads an array both ways MongoDB does: a numeric step is an
// index, and every step also reaches into each element that is a document.
func resolveArray(array bson.A, path []string) []any {
	var found []any
	if index, numeric := strconv.Atoi(path[0]); numeric == nil && index >= 0 && index < len(array) {
		found = append(found, resolve(array[index], path[1:])...)
	}
	for _, element := range array {
		if _, document := element.(bson.D); document {
			found = append(found, resolve(element, path)...)
		}
	}
	return found
}

func valuesAt(document bson.D, path string) []any {
	return resolve(document, strings.Split(path, "."))
}

// clone deep-copies a document, because the store hands documents to a client
// and takes updates back, and a shared slice would let one client's read see
// another client's half-finished write.
func clone(value any) any {
	switch typed := value.(type) {
	case bson.D:
		copied := make(bson.D, len(typed))
		for index, element := range typed {
			copied[index] = mongocmd.Field(element.Key, clone(element.Value))
		}
		return copied
	case bson.A:
		copied := make(bson.A, len(typed))
		for index, element := range typed {
			copied[index] = clone(element)
		}
		return copied
	default:
		return value
	}
}

func cloneDocument(document bson.D) bson.D { return clone(document).(bson.D) }
