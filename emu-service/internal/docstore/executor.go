package docstore

import (
	"fmt"
	"maps"
	"slices"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// handlers is what each decoded command does. A kind that reaches here without
// one is emu contradicting itself, which Exec reports rather than panicking on.
var handlers = map[string]func(*Backend, mongocmd.Command) (bson.D, error){
	mongocmd.KindInsert:          insertCommand,
	mongocmd.KindFind:            findCommand,
	mongocmd.KindUpdate:          updateCommand,
	mongocmd.KindDelete:          deleteCommand,
	mongocmd.KindGetMore:         getMoreCommand,
	mongocmd.KindKillCursors:     killCursorsCommand,
	mongocmd.KindCount:           countCommand,
	mongocmd.KindAggregate:       aggregateCommand,
	mongocmd.KindCreateIndexes:   createIndexesCommand,
	mongocmd.KindListCollections: listCollectionsCommand,
	mongocmd.KindListDatabases:   listDatabasesCommand,
	mongocmd.KindDrop:            dropCommand,
	mongocmd.KindDropDatabase:    dropDatabaseCommand,
}

// An executor runs one client connection's commands. Every one of them reaches
// the same state under the same mutex: MongoDB has no per-connection
// transaction, so there is nothing here for a connection to own.
type executor struct{ store *Backend }

func (e *executor) Exec(op control.Op) (emulator.Result, error) {
	if op.Kind == emulator.KindConnect {
		return emulator.Result{}, nil
	}
	command, decoded := op.Payload.(mongocmd.Command)
	if !decoded {
		return emulator.Result{}, fmt.Errorf("the document backend was handed a %s with no command", op.Kind)
	}
	handle, implemented := handlers[op.Kind]
	if !implemented {
		return emulator.Result{}, mongocmd.Unsupported("the %s command", command.Name)
	}

	e.store.mutex.Lock()
	defer e.store.mutex.Unlock()

	document, err := handle(e.store, command)
	if err != nil {
		return emulator.Result{}, err
	}
	// Every reply a MongoDB client accepts ends in ok, and the client reads it
	// before it reads anything else in the document.
	return mongocmd.Reply(append(document, mongocmd.Field("ok", 1.0))), nil
}

// Abort is what the SQL database uses to roll a faulted COMMIT back. There is
// nothing to undo here: emu's document database has no multi-document
// transaction, so a faulted operation is one the store never saw.
func (e *executor) Abort(control.Op) {}

func (e *executor) Close() error { return nil }

// insertCommand stores documents and reports the ones it could not, the way a
// batch write does — a duplicate _id is a write error inside a successful
// command, not a failed command, and a driver raises DuplicateKeyError off it.
func insertCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	documents, err := documentList(command, "documents")
	if err != nil {
		return nil, err
	}
	ordered, err := boolField(command, "ordered", true)
	if err != nil {
		return nil, err
	}

	held, inserted := store.collect(command.Target), 0
	var failures bson.A
	for index, document := range documents {
		if err := held.insert(document); err != nil {
			failures = append(failures, writeError(index, err))
			if ordered {
				break // an ordered batch stops where it broke
			}
			continue
		}
		inserted++
	}
	return withWriteErrors(bson.D{mongocmd.Field("n", int32(inserted))}, failures), nil
}

func updateCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	specifications, err := documentList(command, "updates")
	if err != nil {
		return nil, err
	}

	held := store.collect(command.Target)
	matched, modified, created := 0, 0, bson.A{}
	for index, specification := range specifications {
		outcome, err := held.update(specification)
		if err != nil {
			return nil, err
		}
		matched, modified = matched+outcome.matched, modified+outcome.modified
		if outcome.upserted != nil {
			created = append(created, bson.D{
				mongocmd.Field("index", int32(index)),
				mongocmd.Field(identifierField, outcome.upserted),
			})
		}
	}

	reply := bson.D{mongocmd.Field("n", int32(matched)), mongocmd.Field("nModified", int32(modified))}
	if len(created) > 0 {
		reply = append(reply, mongocmd.Field("upserted", created))
	}
	return reply, nil
}

func deleteCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	specifications, err := documentList(command, "deletes")
	if err != nil {
		return nil, err
	}

	held, deleted := store.collect(command.Target), 0
	for _, specification := range specifications {
		removed, err := held.remove(specification)
		if err != nil {
			return nil, err
		}
		deleted += removed
	}
	return bson.D{mongocmd.Field("n", int32(deleted))}, nil
}

// countCommand is the cheap count: no cursor, no pipeline. It is what a driver's
// estimated_document_count sends, and what a lesson that writes the command by
// hand reaches for.
func countCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	filter, err := documentField(command, "query")
	if err != nil {
		return nil, err
	}
	selected, err := store.collect(command.Target).find(filter)
	if err != nil {
		return nil, err
	}
	skip, err := intField(command, "skip", 0)
	if err != nil {
		return nil, err
	}
	limit, err := intField(command, "limit", 0)
	if err != nil {
		return nil, err
	}
	return bson.D{mongocmd.Field("n", int32(len(window(selected, skip, limit))))}, nil
}

// createIndexesCommand succeeds without building anything. emu scans every
// document for every query, so an index changes how long a lesson takes and
// nothing about what it returns — and a lesson that calls create_index must not
// fall over on a line that is not what it is teaching.
func createIndexesCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	store.collect(command.Target)
	return bson.D{
		mongocmd.Field("createdCollectionAutomatically", false),
		mongocmd.Field("numIndexesBefore", int32(1)),
		mongocmd.Field("numIndexesAfter", int32(1)),
		mongocmd.Field("note", "emu does not build indexes: every query is a collection scan"),
	}, nil
}

func listCollectionsCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	var described []bson.D
	for _, name := range slices.Sorted(maps.Keys(store.collections)) {
		described = append(described, bson.D{
			mongocmd.Field("name", name),
			mongocmd.Field("type", "collection"),
			mongocmd.Field("options", bson.D{}),
			mongocmd.Field("info", bson.D{mongocmd.Field("readOnly", false)}),
		})
	}
	return store.batch(command.Database+".$cmd.listCollections", described, findOptions{}, "firstBatch"), nil
}

// listDatabasesCommand reports the one database emu has. A client that addressed
// another name reached these same collections; see mongocmd.Database for why.
func listDatabasesCommand(store *Backend, _ mongocmd.Command) (bson.D, error) {
	return bson.D{
		mongocmd.Field("databases", bson.A{bson.D{
			mongocmd.Field("name", mongocmd.Database),
			mongocmd.Field("sizeOnDisk", int64(0)),
			mongocmd.Field("empty", len(store.collections) == 0),
		}}),
		mongocmd.Field("totalSize", int64(0)),
	}, nil
}

func dropCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	if _, exists := store.collections[command.Target]; !exists {
		return nil, mongocmd.Fail(mongocmd.CodeNamespaceNotFound, "ns not found: %s.%s",
			command.Database, command.Target)
	}
	delete(store.collections, command.Target)
	return bson.D{
		mongocmd.Field("ns", command.Database+"."+command.Target),
		mongocmd.Field("nIndexesWas", int32(1)),
	}, nil
}

// dropDatabaseCommand empties the store, cursors included: a cursor over a
// collection that no longer exists has nothing left to hand out.
func dropDatabaseCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	store.collections = map[string]*collection{}
	store.cursors = map[int64]*cursor{}
	return bson.D{mongocmd.Field("dropped", command.Database)}, nil
}

func writeError(index int, err error) bson.D {
	code, name := mongocmd.CodeOf(err)
	return bson.D{
		mongocmd.Field("index", int32(index)),
		mongocmd.Field("code", int32(code)),
		mongocmd.Field("codeName", name),
		mongocmd.Field("errmsg", err.Error()),
	}
}

func withWriteErrors(reply bson.D, failures bson.A) bson.D {
	if len(failures) == 0 {
		return reply
	}
	return append(reply, mongocmd.Field("writeErrors", failures))
}
