// Package mongocmd is the little that has to be read off a MongoDB command
// document: which operation it is, what it acts on, and whether emu answers it
// about itself rather than about the data.
//
// Both halves of the document database need that vocabulary — mongowire to
// build the Op the control layer sees before anything runs, docstore to know
// what it was asked to do — and neither should have to learn the other's job to
// get it. It is the same seam sqltext is for the SQL database.
package mongocmd

import (
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// The operations a fault rule can match, spelled the way MongoDB spells the
// commands they come from: "mongo.insert", "mongo.getMore".
const (
	KindInsert          = "insert"
	KindFind            = "find"
	KindUpdate          = "update"
	KindDelete          = "delete"
	KindGetMore         = "getMore"
	KindKillCursors     = "killCursors"
	KindCount           = "count"
	KindAggregate       = "aggregate"
	KindCreateIndexes   = "createIndexes"
	KindListCollections = "listCollections"
	KindListDatabases   = "listDatabases"
	KindDrop            = "drop"
	KindDropDatabase    = "dropDatabase"
)

// Database is the one database emu has.
//
// A lesson seeds collections — `"mongo": {"orders": [...]}` — and never names a
// database, so there is nothing to key one on. Rather than invent a name the
// student's connection string would then have to guess, every database a client
// addresses reaches the same collections, and this is the name emu answers with
// when it has to name one itself. Multi-database lessons are out of scope for
// v1; a lesson that needs two namespaces uses two collections.
const Database = "emu"

// A scope says where a command's target comes from.
type scope int

const (
	onCollection scope = iota // the command's own value names it
	onCursor                  // the "collection" field beside the cursor id
	onDatabase                // the "$db" every OP_MSG carries
)

type entry struct {
	kind  string
	scope scope
}

// commands maps what a client sent onto the operation a rule matches. The key is
// folded to lower case because MongoDB accepts "ismaster" and "isMaster" for the
// same command, and a rule must not depend on which spelling a driver chose.
var commands = map[string]entry{
	"insert":          {KindInsert, onCollection},
	"find":            {KindFind, onCollection},
	"update":          {KindUpdate, onCollection},
	"delete":          {KindDelete, onCollection},
	"getmore":         {KindGetMore, onCursor},
	"killcursors":     {KindKillCursors, onCollection},
	"count":           {KindCount, onCollection},
	"aggregate":       {KindAggregate, onCollection},
	"createindexes":   {KindCreateIndexes, onCollection},
	"drop":            {KindDrop, onCollection},
	"listcollections": {KindListCollections, onDatabase},
	"listdatabases":   {KindListDatabases, onDatabase},
	"dropdatabase":    {KindDropDatabase, onDatabase},
}

// serverCommands are the ones emu answers about itself rather than about the
// data — a handshake, a liveness check, a version string. They never become an
// Op, for the reason pgwire keeps DEALLOCATE out of the op log: a student is
// graded on what their code did, not on what their driver did to keep the
// connection alive.
var serverCommands = map[string]bool{
	"hello":        true,
	"ismaster":     true,
	"ping":         true,
	"buildinfo":    true,
	"getparameter": true,
	"endsessions":  true,
}

// A Command is one decoded command document: what it is, what it acts on, and
// the document itself, which is the backend's business to read any further.
type Command struct {
	// Name is how the client spelled it, which is what an error should quote.
	Name string
	// Kind is the operation a fault rule matches. For a server command it is the
	// folded name, which never reaches a rule.
	Kind string
	// Target is the collection the command acts on, or the database for the
	// commands that act on all of them.
	Target string
	// Collection is whether Target names a collection, which decides whether a
	// document count is a gauge worth reporting alongside the operation.
	Collection bool
	// Database is the "$db" the client addressed. A cursor's namespace has to
	// echo it back, so it is kept even though emu has only one database.
	Database string
	// Document is the command whole.
	Document bson.D
	// Server is whether emu answers it about itself rather than about the data.
	Server bool
}

// Read decodes a command document far enough for the control layer to reason
// about it. Everything past that is the backend's to read.
func Read(document bson.D) (Command, error) {
	if len(document) == 0 {
		return Command{}, &Error{
			Code:    CodeCommandNotFound,
			Name:    "CommandNotFound",
			Message: "an empty command document names no command",
		}
	}

	name := document[0].Key
	command := Command{Name: name, Document: document, Database: databaseOf(document)}

	folded := strings.ToLower(name)
	if serverCommands[folded] {
		command.Server, command.Kind = true, folded
		return command, nil
	}

	known, implemented := commands[folded]
	if !implemented {
		return Command{}, Fail(CodeCommandNotFound, "emu does not implement the %q command", name)
	}
	command.Kind = known.kind
	command.Collection = known.scope != onDatabase

	target, err := known.scope.targetOf(command)
	if err != nil {
		return Command{}, err
	}
	command.Target = target
	return command, nil
}

// targetOf answers what the command acts on, and refuses a command whose own
// value is not the collection name it is required to be — a client that sends
// one has misunderstood the protocol, and guessing on its behalf would hide it.
func (s scope) targetOf(command Command) (string, error) {
	switch s {
	case onDatabase:
		return command.Database, nil
	case onCursor:
		return stringField(command, "collection")
	}

	name, named := command.Document[0].Value.(string)
	if !named {
		return "", Invalid("the %s command names its collection as its own value, got %T",
			command.Name, command.Document[0].Value)
	}
	return name, nil
}

func stringField(command Command, key string) (string, error) {
	value, present := Lookup(command.Document, key)
	if !present {
		return "", Invalid("the %s command needs a %q field", command.Name, key)
	}
	text, isText := value.(string)
	if !isText {
		return "", Invalid("%s.%s is %T, want a string", command.Name, key, value)
	}
	return text, nil
}

// databaseOf reads the database an OP_MSG addressed. The legacy handshake has no
// such field, and it asks nothing about the data, so the one database emu has is
// the only answer that could be right.
func databaseOf(document bson.D) string {
	if value, present := Lookup(document, "$db"); present {
		if name, named := value.(string); named && name != "" {
			return name
		}
	}
	return Database
}

// Lookup reads one top-level field. bson.D is ordered rather than keyed, which
// is the whole reason to use it — a document comes back in the order it went in
// — and this is the price.
func Lookup(document bson.D, key string) (any, bool) {
	for _, element := range document {
		if element.Key == key {
			return element.Value, true
		}
	}
	return nil, false
}

// Field builds one. go vet requires keyed fields in another package's struct
// literal, which is right in general and unreadable in a file that writes fifty
// of them.
func Field(key string, value any) bson.E { return bson.E{Key: key, Value: value} }

// Reply carries a MongoDB reply document across the seam every emulator shares.
//
// emulator.Result is shaped for a SQL result set, because the SQL database is
// the emulator that proved the seam. A MongoDB reply is one BSON document, so it
// travels in the single cell of a single-row result: a convention between the
// two halves of this emulator rather than a change to the interface all four
// depend on.
func Reply(document bson.D) emulator.Result {
	return emulator.Result{Rows: [][]any{{document}}}
}

// Document unpacks what Reply wrapped.
func Document(result emulator.Result) (bson.D, error) {
	if len(result.Rows) != 1 || len(result.Rows[0]) != 1 {
		return nil, fmt.Errorf("a MongoDB reply is one document, got %d rows", len(result.Rows))
	}
	document, wrapped := result.Rows[0][0].(bson.D)
	if !wrapped {
		return nil, fmt.Errorf("a MongoDB reply is a bson.D, got %T", result.Rows[0][0])
	}
	return document, nil
}
