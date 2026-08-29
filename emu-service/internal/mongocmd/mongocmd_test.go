package mongocmd

import (
	"errors"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

func TestACommandBecomesTheOperationARuleMatches(t *testing.T) {
	for _, want := range []struct {
		document bson.D
		kind     string
		target   string
	}{
		{bson.D{Field("insert", "orders"), Field("$db", "shop")}, KindInsert, "orders"},
		{bson.D{Field("find", "orders")}, KindFind, "orders"},
		{bson.D{Field("update", "orders")}, KindUpdate, "orders"},
		{bson.D{Field("delete", "orders")}, KindDelete, "orders"},
		{bson.D{Field("count", "orders")}, KindCount, "orders"},
		{bson.D{Field("aggregate", "orders")}, KindAggregate, "orders"},
		{bson.D{Field("createIndexes", "orders")}, KindCreateIndexes, "orders"},
		{bson.D{Field("drop", "orders")}, KindDrop, "orders"},
		{bson.D{Field("killCursors", "orders")}, KindKillCursors, "orders"},
		{bson.D{Field("getMore", int64(7)), Field("collection", "orders")}, KindGetMore, "orders"},
		{bson.D{Field("listCollections", int32(1)), Field("$db", "shop")}, KindListCollections, "shop"},
		{bson.D{Field("listDatabases", int32(1))}, KindListDatabases, Database},
		{bson.D{Field("dropDatabase", int32(1))}, KindDropDatabase, Database},
	} {
		command, err := Read(want.document)

		if err != nil {
			t.Fatalf("Read(%v) = %v", want.document, err)
		}
		if command.Kind != want.kind || command.Target != want.target {
			t.Errorf("Read(%v) = %s on %q, want %s on %q",
				want.document, command.Kind, command.Target, want.kind, want.target)
		}
	}
}

// A gauge is only worth reporting for a command that acts on one collection, and
// a rule that gates on a document count would otherwise read a database's.
func TestOnlyACollectionCommandCarriesADocumentCount(t *testing.T) {
	onCollection, _ := Read(bson.D{Field("find", "orders")})
	onDatabase, _ := Read(bson.D{Field("listDatabases", int32(1))})

	if !onCollection.Collection || onDatabase.Collection {
		t.Errorf("find reports a collection = %v, listDatabases = %v, want true and false",
			onCollection.Collection, onDatabase.Collection)
	}
}

// The handshake command has three spellings between the drivers that send it,
// and a rule must not depend on which one arrived.
func TestTheCommandsEmuAnswersAboutItselfNeverBecomeOperations(t *testing.T) {
	for _, name := range []string{"hello", "isMaster", "ismaster", "ping", "buildInfo", "getParameter", "endSessions"} {
		command, err := Read(bson.D{Field(name, int32(1))})

		if err != nil {
			t.Fatalf("Read(%s) = %v", name, err)
		}
		if !command.Server {
			t.Errorf("%s became the %q operation, want emu to answer it itself", name, command.Kind)
		}
	}
}

func TestACommandEmuDoesNotImplementIsRefusedByName(t *testing.T) {
	_, err := Read(bson.D{Field("findAndModify", "orders")})

	code, _ := CodeOf(err)
	if code != CodeCommandNotFound || !strings.Contains(err.Error(), "findAndModify") {
		t.Errorf("Read = %v (code %d), want the command named and %d", err, code, CodeCommandNotFound)
	}
}

func TestAnEmptyCommandDocumentIsRefused(t *testing.T) {
	_, err := Read(bson.D{})

	if code, _ := CodeOf(err); code != CodeCommandNotFound {
		t.Errorf("Read = %v, want %d", err, CodeCommandNotFound)
	}
}

func TestACommandThatDoesNotNameItsCollectionIsRefused(t *testing.T) {
	_, err := Read(bson.D{Field("find", int32(1))})

	if err == nil || !strings.Contains(err.Error(), "names its collection") {
		t.Errorf("Read = %v, want the collection blamed", err)
	}
}

func TestAGetMoreWithoutACollectionIsRefused(t *testing.T) {
	missing := bson.D{Field("getMore", int64(7))}
	wrongType := bson.D{Field("getMore", int64(7)), Field("collection", int32(1))}

	_, absent := Read(missing)
	_, mistyped := Read(wrongType)

	if absent == nil || !strings.Contains(absent.Error(), `"collection"`) {
		t.Errorf("Read(%v) = %v, want the missing field named", missing, absent)
	}
	if mistyped == nil || !strings.Contains(mistyped.Error(), "want a string") {
		t.Errorf("Read(%v) = %v, want the type blamed", wrongType, mistyped)
	}
}

// Every database a client addresses reaches the same collections, but the name
// it used still has to come back in a cursor's namespace.
func TestTheDatabaseIsTheOneTheClientAddressed(t *testing.T) {
	for _, want := range []struct {
		document bson.D
		database string
	}{
		{bson.D{Field("find", "orders"), Field("$db", "shop")}, "shop"},
		{bson.D{Field("find", "orders")}, Database},
		{bson.D{Field("find", "orders"), Field("$db", "")}, Database},
		{bson.D{Field("find", "orders"), Field("$db", int32(1))}, Database},
	} {
		command, err := Read(want.document)

		if err != nil || command.Database != want.database {
			t.Errorf("Read(%v) = %q, %v, want %q", want.document, command.Database, err, want.database)
		}
	}
}

func TestLookupReadsOneFieldOfAnOrderedDocument(t *testing.T) {
	document := bson.D{Field("a", 1), Field("b", 2)}

	value, present := Lookup(document, "b")
	_, absent := Lookup(document, "c")

	if !present || value != 2 || absent {
		t.Errorf("Lookup = %v %v %v, want 2, present, absent", value, present, absent)
	}
}

// The seam every emulator shares carries a SQL result set. A MongoDB reply is
// one document, and this is the convention that gets it across.
func TestAReplyTravelsAsTheOneCellOfAOneRowResult(t *testing.T) {
	document := bson.D{Field("ok", 1.0)}

	unwrapped, err := Document(Reply(document))

	if err != nil || len(unwrapped) != 1 || unwrapped[0].Key != "ok" {
		t.Errorf("Document(Reply(%v)) = %v, %v", document, unwrapped, err)
	}
}

func TestAResultThatIsNotAReplyIsReportedRatherThanGuessedAt(t *testing.T) {
	_, wrongShape := Document(emulator.Result{})
	_, wrongType := Document(emulator.Result{Rows: [][]any{{"not a document"}}})

	if wrongShape == nil || !strings.Contains(wrongShape.Error(), "one document") {
		t.Errorf("Document = %v, want the shape blamed", wrongShape)
	}
	if wrongType == nil || !strings.Contains(wrongType.Error(), "bson.D") {
		t.Errorf("Document = %v, want the type blamed", wrongType)
	}
}

func TestAFailureCarriesTheCodeADriverReactsTo(t *testing.T) {
	code, name := CodeOf(Fail(CodeDuplicateKey, "dup"))

	if code != CodeDuplicateKey || name != "DuplicateKey" {
		t.Errorf("CodeOf = %d %q, want %d DuplicateKey", code, name, CodeDuplicateKey)
	}
}

// Something that never named a code is emu's own bug, not a lesson's mistake.
func TestAFailureWithNoCodeIsReportedAsUnknownRatherThanAsSuccess(t *testing.T) {
	code, name := CodeOf(errors.New("something went wrong"))

	if code != CodeUnknown || name != "UnknownError" {
		t.Errorf("CodeOf = %d %q, want %d UnknownError", code, name, CodeUnknown)
	}
}

func TestUnsupportedSaysWhatEmuDoesNotDo(t *testing.T) {
	err := Unsupported("the $lookup stage")

	code, _ := CodeOf(err)
	if code != CodeCommandNotSupported || !strings.HasPrefix(err.Error(), "emu does not support ") {
		t.Errorf("Unsupported = %q (code %d), want it to say so", err, code)
	}
}

func TestInvalidCarriesBadValue(t *testing.T) {
	if code, _ := CodeOf(Invalid("no")); code != CodeBadValue {
		t.Errorf("Invalid carries %d, want %d", code, CodeBadValue)
	}
}
