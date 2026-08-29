package docstore

import (
	"slices"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// defaultBatchSize is how many documents MongoDB puts in a find's first batch
// when the client did not say. emu holds every document in memory and could
// always send the lot, but then getMore would never happen — and a lesson about
// paging a cursor has to be able to page one, and to have its second page fail.
const defaultBatchSize = 101

// A cursor is the rest of a result the client has not asked for yet. Cursors
// live on the backend rather than on the connection that opened one, because a
// driver's pool is free to send the getMore down a different socket.
type cursor struct {
	namespace string
	remaining []bson.D
}

// findOptions is a find command read whole, so that a mistake in any of it is
// reported before any of it is applied.
type findOptions struct {
	filter      bson.D
	projection  bson.D
	sort        bson.D
	skip        int
	limit       int
	batchSize   int
	singleBatch bool
}

func findCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	options, err := readFind(command)
	if err != nil {
		return nil, err
	}

	selected, err := store.collect(command.Target).find(options.filter)
	if err != nil {
		return nil, err
	}
	if err := sortDocuments(selected, options.sort); err != nil {
		return nil, err
	}

	projected, err := projectAll(window(selected, options.skip, options.limit), options.projection)
	if err != nil {
		return nil, err
	}
	return store.batch(command.Database+"."+command.Target, projected, options, "firstBatch"), nil
}

func readFind(command mongocmd.Command) (findOptions, error) {
	var options findOptions
	var err error

	if options.filter, err = documentField(command, "filter"); err != nil {
		return options, err
	}
	if options.projection, err = documentField(command, "projection"); err != nil {
		return options, err
	}
	if options.sort, err = documentField(command, "sort"); err != nil {
		return options, err
	}
	if options.skip, err = intField(command, "skip", 0); err != nil {
		return options, err
	}
	if options.limit, err = intField(command, "limit", 0); err != nil {
		return options, err
	}
	if options.batchSize, err = intField(command, "batchSize", defaultBatchSize); err != nil {
		return options, err
	}
	options.singleBatch, err = boolField(command, "singleBatch", false)
	return options.normalised(), err
}

// normalised folds the two ways a client says "one batch is all I want". A
// negative limit is the wire protocol's own shorthand for it, and find_one in
// every driver still reaches for one or the other.
func (o findOptions) normalised() findOptions {
	if o.limit < 0 {
		o.limit, o.singleBatch = -o.limit, true
	}
	return o
}

// window applies skip and limit, in that order, as MongoDB does.
func window(documents []bson.D, skip, limit int) []bson.D {
	if skip >= len(documents) {
		return nil
	}
	documents = documents[skip:]
	if limit > 0 && limit < len(documents) {
		documents = documents[:limit]
	}
	return documents
}

// batch answers the cursor document a find or an aggregate replies with, holding
// what did not fit for a getMore to collect.
func (b *Backend) batch(namespace string, documents []bson.D, options findOptions, key string) bson.D {
	size := len(documents)
	if !options.singleBatch && options.batchSize > 0 && options.batchSize < size {
		size = options.batchSize
	}

	identifier := int64(0)
	if size < len(documents) {
		b.lastCursor++
		identifier = b.lastCursor
		b.cursors[identifier] = &cursor{namespace: namespace, remaining: documents[size:]}
	}

	return bson.D{mongocmd.Field("cursor", bson.D{
		mongocmd.Field(key, arrayOf(documents[:size])),
		mongocmd.Field("id", identifier),
		mongocmd.Field("ns", namespace),
	})}
}

// getMoreCommand hands over the next page. A cursor emu does not know about is a
// real failure and not an empty page: the client is iterating something that was
// killed or that already ran out, and telling it "no more documents" would look
// like the collection was short.
func getMoreCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	identifier, err := cursorID(command, command.Document[0].Value)
	if err != nil {
		return nil, err
	}
	size, err := intField(command, "batchSize", 0)
	if err != nil {
		return nil, err
	}
	held, open := store.cursors[identifier]
	if !open {
		return nil, mongocmd.Fail(mongocmd.CodeCursorNotFound, "cursor id %d not found", identifier)
	}

	// No batch size means everything that is left, which is what a real server
	// does too once the result fits inside one message.
	if size <= 0 || size > len(held.remaining) {
		size = len(held.remaining)
	}
	page := held.remaining[:size]
	held.remaining = held.remaining[size:]

	next := identifier
	if len(held.remaining) == 0 {
		delete(store.cursors, identifier)
		next = 0
	}
	return bson.D{mongocmd.Field("cursor", bson.D{
		mongocmd.Field("nextBatch", arrayOf(page)),
		mongocmd.Field("id", next),
		mongocmd.Field("ns", held.namespace),
	})}, nil
}

// killCursorsCommand closes cursors the client abandoned, and says which of them
// it had never heard of — a driver checks that, and a lesson that leaks cursors
// can be read out of the answer.
func killCursorsCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	listed, present := mongocmd.Lookup(command.Document, "cursors")
	identifiers, isList := listed.(bson.A)
	if !present || !isList {
		return nil, mongocmd.Invalid("killCursors needs an array of cursor ids")
	}

	killed, missing := bson.A{}, bson.A{}
	for _, entry := range identifiers {
		identifier, err := cursorID(command, entry)
		if err != nil {
			return nil, err
		}
		if _, open := store.cursors[identifier]; !open {
			missing = append(missing, identifier)
			continue
		}
		delete(store.cursors, identifier)
		killed = append(killed, identifier)
	}
	return bson.D{
		mongocmd.Field("cursorsKilled", killed),
		mongocmd.Field("cursorsNotFound", missing),
		mongocmd.Field("cursorsAlive", bson.A{}),
		mongocmd.Field("cursorsUnknown", bson.A{}),
	}, nil
}

func cursorID(command mongocmd.Command, value any) (int64, error) {
	identifier, isNumber := value.(int64)
	if !isNumber {
		return 0, mongocmd.Fail(mongocmd.CodeTypeMismatch,
			"%s takes a cursor id, got %T", command.Name, value)
	}
	return identifier, nil
}

// sortDocuments orders in place, stably, so that documents a sort key does not
// separate stay in the order the collection holds them.
func sortDocuments(documents []bson.D, specification bson.D) error {
	for _, key := range specification {
		if direction(key.Value) == 0 {
			return mongocmd.Invalid("sort on %q is %v, want 1 or -1", key.Key, key.Value)
		}
	}

	slices.SortStableFunc(documents, func(left, right bson.D) int {
		for _, key := range specification {
			if order := compare(sortKey(left, key.Key), sortKey(right, key.Key)); order != 0 {
				return order * direction(key.Value)
			}
		}
		return 0
	})
	return nil
}

// sortKey is the value a document sorts by, which is nothing at all when it does
// not have the field — and nothing sorts before every number and string, which
// is where MongoDB puts a missing field too.
func sortKey(document bson.D, path string) any {
	values := valuesAt(document, path)
	if len(values) == 0 {
		return nil
	}
	return values[0]
}

func direction(value any) int {
	if !isNumber(value) {
		return 0
	}
	return sign(int(numberOf(value)))
}

func projectAll(documents []bson.D, projection bson.D) ([]bson.D, error) {
	projected := make([]bson.D, 0, len(documents))
	for _, document := range documents {
		result, err := project(document, projection)
		if err != nil {
			return nil, err
		}
		projected = append(projected, result)
	}
	return projected, nil
}

// project narrows a document to the fields the client asked for. A projection is
// either a list of fields to keep or a list to drop, never both — except _id,
// which is kept unless it is named, because it is the one field MongoDB returns
// whether or not it was asked for.
func project(document, projection bson.D) (bson.D, error) {
	if len(projection) == 0 {
		return cloneDocument(document), nil
	}

	including, err := projectionMode(projection)
	if err != nil {
		return nil, err
	}

	// _id is left out of the paths and decided on its own, because it is the one
	// field a projection can name against the grain of the rest: {_id: 0, sku: 1}
	// is an inclusion that also drops the identifier, and it is the commonest
	// projection anybody writes.
	paths := map[string]bool{}
	for _, field := range projection {
		if field.Key != identifierField {
			paths[field.Key] = true
		}
	}
	kept := without(filterFields(cloneDocument(document), "", paths, including), identifierField)

	identifier, present := mongocmd.Lookup(document, identifierField)
	if !present || !keepsIdentifier(projection) {
		return kept, nil
	}
	return withIdentifier(kept, clone(identifier)), nil
}

// keepsIdentifier reports whether the projection leaves _id in. It comes back
// unless the projection said otherwise, whichever way round the rest of it goes.
func keepsIdentifier(projection bson.D) bool {
	value, named := mongocmd.Lookup(projection, identifierField)
	return !named || truthy(value)
}

// projectionMode reads whether the projection lists what to keep or what to
// drop, refusing one that does both. _id does not decide it: {_id: 0, name: 1}
// is an inclusion that also drops the identifier, and it is the commonest
// projection anyone writes.
func projectionMode(projection bson.D) (bool, error) {
	var including, excluding []string
	for _, field := range projection {
		if !isNumber(field.Value) && rankOf(field.Value) != rankBool {
			return false, mongocmd.Unsupported("the projection %q, which is not a simple include or exclude", field.Key)
		}
		if truthy(field.Value) {
			including = append(including, field.Key)
			continue
		}
		if field.Key != identifierField {
			excluding = append(excluding, field.Key)
		}
	}
	if len(including) > 0 && len(excluding) > 0 {
		return false, mongocmd.Invalid("a projection includes or excludes, not both: %v beside %v", including, excluding)
	}
	return len(including) > 0, nil
}

func truthy(value any) bool {
	if flag, isBool := value.(bool); isBool {
		return flag
	}
	return numberOf(value) != 0
}

// filterFields keeps or drops fields by path, descending wherever a longer path
// asks it to — so "address.city" narrows the address rather than replacing it.
func filterFields(document bson.D, prefix string, paths map[string]bool, including bool) bson.D {
	kept := make(bson.D, 0, len(document))
	for _, element := range document {
		path := prefix + element.Key
		switch {
		case paths[path]:
			if including {
				kept = append(kept, element)
			}
		case deeper(paths, path):
			kept = append(kept, mongocmd.Field(element.Key, filterEmbedded(element.Value, path, paths, including)))
		case !including:
			kept = append(kept, element)
		}
	}
	return kept
}

// filterEmbedded applies a dotted projection to whatever is under the field it
// names, including each document of an array — which is how MongoDB narrows a
// list of line items to their skus.
func filterEmbedded(value any, path string, paths map[string]bool, including bool) any {
	switch typed := value.(type) {
	case bson.D:
		return filterFields(typed, path+".", paths, including)
	case bson.A:
		narrowed := make(bson.A, len(typed))
		for index, element := range typed {
			narrowed[index] = filterEmbedded(element, path, paths, including)
		}
		return narrowed
	default:
		return value
	}
}

func deeper(paths map[string]bool, path string) bool {
	for candidate := range paths {
		if strings.HasPrefix(candidate, path+".") {
			return true
		}
	}
	return false
}

func arrayOf(documents []bson.D) bson.A {
	listed := make(bson.A, len(documents))
	for index, document := range documents {
		listed[index] = document
	}
	return listed
}
