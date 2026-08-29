package docstore

import (
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// operators are the update operators emu applies. Three of them, deliberately:
// they are what insert/find/update lessons are written against, and an operator
// emu half-implemented would be worse than one it refuses by name.
var operators = map[string]func(bson.D, string, any) (bson.D, error){
	"$set":   setField,
	"$inc":   incrementField,
	"$unset": unsetField,
}

// applyUpdate answers what a document becomes. A document with no $ operator in
// it is a replacement, which is what a driver's replace_one sends, and the _id
// survives it — a replacement changes what a document holds, never which
// document it is.
func applyUpdate(document, update bson.D) (bson.D, error) {
	if err := checkUpdateShape(update); err != nil {
		return nil, err
	}
	if len(update) > 0 && !strings.HasPrefix(update[0].Key, "$") {
		return replace(document, update), nil
	}

	updated := cloneDocument(document)
	for _, operator := range update {
		applied, err := applyOperator(updated, operator)
		if err != nil {
			return nil, err
		}
		updated = applied
	}
	return updated, nil
}

// checkUpdateShape refuses a document that is half replacement and half
// operators. MongoDB does the same, because there is no reading of it that is
// not a mistake.
func checkUpdateShape(update bson.D) error {
	var withOperators, withFields []string
	for _, element := range update {
		if strings.HasPrefix(element.Key, "$") {
			withOperators = append(withOperators, element.Key)
			continue
		}
		withFields = append(withFields, element.Key)
	}
	if len(withOperators) > 0 && len(withFields) > 0 {
		return mongocmd.Fail(mongocmd.CodeFailedToParse,
			"an update is operators or a replacement, not both: %v beside %v", withOperators, withFields)
	}
	return nil
}

func applyOperator(document bson.D, operator bson.E) (bson.D, error) {
	apply, known := operators[operator.Key]
	if !known {
		return nil, mongocmd.Unsupported("the %s update operator", operator.Key)
	}
	changes, isDocument := operator.Value.(bson.D)
	if !isDocument {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch,
			"%s is %T, want a document of fields", operator.Key, operator.Value)
	}

	for _, change := range changes {
		updated, err := apply(document, change.Key, change.Value)
		if err != nil {
			return nil, err
		}
		document = updated
	}
	return document, nil
}

func setField(document bson.D, path string, value any) (bson.D, error) {
	return setPath(document, strings.Split(path, "."), clone(value))
}

func unsetField(document bson.D, path string, _ any) (bson.D, error) {
	return unsetPath(document, strings.Split(path, ".")), nil
}

// incrementField refuses to increment something that is not a number, rather
// than replacing it with one. A lesson whose $inc silently overwrote a string
// with 1 would teach that MongoDB does something it does not.
func incrementField(document bson.D, path string, by any) (bson.D, error) {
	if !isNumber(by) {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch, "$inc on %s is %T, want a number", path, by)
	}

	steps := strings.Split(path, ".")
	current, present := valueAt(document, steps)
	if !present {
		return setPath(document, steps, by)
	}
	if !isNumber(current) {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch,
			"$inc on %s, which holds %T rather than a number", path, current)
	}
	return setPath(document, steps, sum(current, by))
}

// sum keeps a whole-number field whole. BSON tells int64 from double, and a
// counter that turned into 3.0 the first time it was incremented would print
// back to the student as 3.0 forever.
func sum(current, by any) any {
	if isWhole(current) && isWhole(by) {
		return wholeOf(current) + wholeOf(by)
	}
	return numberOf(current) + numberOf(by)
}

func isWhole(value any) bool {
	switch value.(type) {
	case int32, int64, int:
		return true
	default:
		return false
	}
}

func wholeOf(value any) int64 {
	switch typed := value.(type) {
	case int32:
		return int64(typed)
	case int:
		return int64(typed)
	default:
		return typed.(int64)
	}
}

// valueAt reads a path without descending into arrays, which is what an update
// needs: a filter asks "does any element match", an update asks "which field
// exactly".
func valueAt(document bson.D, path []string) (any, bool) {
	value, present := mongocmd.Lookup(document, path[0])
	switch {
	case !present:
		return nil, false
	case len(path) == 1:
		return value, true
	}
	embedded, isDocument := value.(bson.D)
	if !isDocument {
		return nil, false
	}
	return valueAt(embedded, path[1:])
}

// setPath writes a field, building the documents on the way to it. A path that
// runs through something that is not a document fails: MongoDB will not turn a
// number into a document to make room for a field, and neither will emu.
func setPath(document bson.D, path []string, value any) (bson.D, error) {
	if len(path) == 1 {
		return withField(document, path[0], value), nil
	}

	held, present := mongocmd.Lookup(document, path[0])
	if !present {
		held = bson.D{}
	}
	embedded, isDocument := held.(bson.D)
	if !isDocument {
		return nil, mongocmd.Invalid("cannot create %q inside %s, which holds %T",
			strings.Join(path[1:], "."), path[0], held)
	}

	updated, err := setPath(embedded, path[1:], value)
	if err != nil {
		return nil, err
	}
	return withField(document, path[0], updated), nil
}

// withField replaces a field where it already is, so that updating a document
// never reorders it, and appends it at the end otherwise — which is where
// MongoDB puts a field it has just been given.
func withField(document bson.D, key string, value any) bson.D {
	for index, element := range document {
		if element.Key == key {
			updated := slicesClone(document)
			updated[index].Value = value
			return updated
		}
	}
	return append(slicesClone(document), mongocmd.Field(key, value))
}

func unsetPath(document bson.D, path []string) bson.D {
	if len(path) == 1 {
		return without(document, path[0])
	}

	held, present := mongocmd.Lookup(document, path[0])
	if !present {
		return document
	}
	embedded, isDocument := held.(bson.D)
	if !isDocument {
		return document
	}
	return withField(document, path[0], unsetPath(embedded, path[1:]))
}

func without(document bson.D, key string) bson.D {
	kept := make(bson.D, 0, len(document))
	for _, element := range document {
		if element.Key != key {
			kept = append(kept, element)
		}
	}
	return kept
}

// replace keeps the _id and takes everything else from the replacement, which
// is what a driver's replace_one means.
func replace(document, replacement bson.D) bson.D {
	replaced := cloneDocument(replacement)
	if identifier, present := mongocmd.Lookup(document, identifierField); present {
		return withIdentifier(without(replaced, identifierField), identifier)
	}
	return replaced
}

// upsert builds the document an update creates when it matched nothing. The
// equality conditions of the filter are part of it, because a client that asked
// for {sku: "abc"} and got a document without one would have to wonder where it
// went.
func upsert(filter, update bson.D) (bson.D, error) {
	seeded, err := equalityFields(filter)
	if err != nil {
		return nil, err
	}
	created, err := applyUpdate(seeded, update)
	if err != nil {
		return nil, err
	}
	return withIdentifier(created, identifierOf(created)), nil
}

// equalityFields is the part of a filter that describes a document rather than a
// search: {sku: "abc"} does, {price: {$gt: 5}} does not.
func equalityFields(filter bson.D) (bson.D, error) {
	seeded := bson.D{}
	for _, condition := range filter {
		if strings.HasPrefix(condition.Key, "$") {
			continue
		}
		if _, isOperators := operatorDocument(condition.Value); isOperators {
			continue
		}
		updated, err := setPath(seeded, strings.Split(condition.Key, "."), clone(condition.Value))
		if err != nil {
			return nil, err
		}
		seeded = updated
	}
	return seeded, nil
}

func slicesClone(document bson.D) bson.D {
	copied := make(bson.D, len(document))
	copy(copied, document)
	return copied
}
