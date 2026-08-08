package docstore

import (
	"slices"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

func TestInsertStoresDocumentsAndCreatesTheCollection(t *testing.T) {
	store := seeded(t, "")

	reply := run(t, store, bson.D{f("insert", "things"), f("documents", bson.A{
		bson.D{f("sku", "a")},
		bson.D{f("sku", "b")},
	})})

	if number(t, reply, "n") != 2 || store.Count("things") != 2 {
		t.Errorf("reply = %v, the collection holds %d", reply, store.Count("things"))
	}
}

// A duplicate _id is a write error inside a successful command rather than a
// failed command, which is what a driver turns into DuplicateKeyError.
func TestADuplicateIdentifierIsAWriteErrorRatherThanAFailedCommand(t *testing.T) {
	store := seeded(t, `{"things": [{"_id": 1}]}`)

	reply := run(t, store, bson.D{f("insert", "things"), f("documents", bson.A{
		bson.D{f("_id", int32(1))},
		bson.D{f("_id", int32(2))},
	})})

	failures, reported := mongocmd.Lookup(reply, "writeErrors")
	if !reported || len(failures.(bson.A)) != 1 {
		t.Fatalf("reply = %v, want one write error", reply)
	}
	failure := failures.(bson.A)[0].(bson.D)
	code, _ := mongocmd.Lookup(failure, "code")
	if code != int32(mongocmd.CodeDuplicateKey) {
		t.Errorf("the write error carries code %v, want %d", code, mongocmd.CodeDuplicateKey)
	}
	// The batch was ordered by default, so the second document never landed.
	if number(t, reply, "n") != 0 || store.Count("things") != 1 {
		t.Errorf("an ordered batch carried on past its failure: %v", reply)
	}
}

func TestAnUnorderedBatchCarriesOnPastAFailure(t *testing.T) {
	store := seeded(t, `{"things": [{"_id": 1}]}`)

	reply := run(t, store, bson.D{
		f("insert", "things"),
		f("documents", bson.A{bson.D{f("_id", int32(1))}, bson.D{f("_id", int32(2))}}),
		f("ordered", false),
	})

	if number(t, reply, "n") != 1 || store.Count("things") != 2 {
		t.Errorf("reply = %v, the collection holds %d, want the second document in", reply, store.Count("things"))
	}
}

// BSON has booleans and numbers, and drivers send flags as both.
func TestAFlagIsReadAsANumberAsWellAsABoolean(t *testing.T) {
	store := seeded(t, `{"things": [{"_id": 1}]}`)

	reply := run(t, store, bson.D{
		f("insert", "things"),
		f("documents", bson.A{bson.D{f("_id", int32(1))}, bson.D{f("_id", int32(2))}}),
		f("ordered", int32(0)),
	})

	if number(t, reply, "n") != 1 {
		t.Errorf("reply = %v, want the batch to have carried on", reply)
	}
}

func TestDeleteRemovesTheFirstMatchOrEveryOne(t *testing.T) {
	store := seeded(t, `{"things": [{"sku": "a"}, {"sku": "a"}, {"sku": "b"}]}`)

	one := run(t, store, bson.D{f("delete", "things"), f("deletes", bson.A{
		bson.D{f("q", bson.D{f("sku", "a")}), f("limit", int32(1))},
	})})
	all := run(t, store, bson.D{f("delete", "things"), f("deletes", bson.A{
		bson.D{f("q", bson.D{}), f("limit", int32(0))},
	})})

	if number(t, one, "n") != 1 {
		t.Errorf("limit 1 deleted %v", one)
	}
	if number(t, all, "n") != 2 || store.Count("things") != 0 {
		t.Errorf("limit 0 deleted %v, leaving %d", all, store.Count("things"))
	}
}

func TestCountAppliesTheFilterAndTheWindow(t *testing.T) {
	store := seeded(t, ranked)

	everything := run(t, store, bson.D{f("count", "things")})
	filtered := run(t, store, bson.D{f("count", "things"), f("query", bson.D{f("n", bson.D{f("$gte", int32(2))})})})
	windowed := run(t, store, bson.D{f("count", "things"), f("skip", int32(1)), f("limit", int32(2))})

	if number(t, everything, "n") != 4 || number(t, filtered, "n") != 2 || number(t, windowed, "n") != 2 {
		t.Errorf("counts = %v %v %v", everything, filtered, windowed)
	}
}

// A lesson that calls create_index must not fall over on a line that is not what
// it is teaching, even though emu scans every document regardless.
func TestCreateIndexesSucceedsWithoutBuildingAnything(t *testing.T) {
	store := seeded(t, "")

	reply := run(t, store, bson.D{f("createIndexes", "things"), f("indexes", bson.A{})})

	note, _ := mongocmd.Lookup(reply, "note")
	if !strings.Contains(note.(string), "collection scan") {
		t.Errorf("reply = %v, want it to say what it did not do", reply)
	}
}

func TestListCollectionsNamesWhatIsThere(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "a"}], "customers": [{"name": "ada"}]}`)

	reply := run(t, store, bson.D{f("listCollections", int32(1)), f("$db", "shop")})

	var named []string
	for _, described := range documents(t, reply, "firstBatch") {
		name, _ := mongocmd.Lookup(described, "name")
		named = append(named, name.(string))
	}
	if !slices.Equal(named, []string{"customers", "orders"}) {
		t.Errorf("listCollections = %v, want both, sorted", named)
	}
}

// emu has one database however many a client addresses, and listDatabases is
// where that stops being invisible.
func TestListDatabasesReportsTheOneDatabaseEmuHas(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "a"}]}`)

	reply := run(t, store, bson.D{f("listDatabases", int32(1)), f("$db", "shop")})

	listed, _ := mongocmd.Lookup(reply, "databases")
	described := listed.(bson.A)[0].(bson.D)
	name, _ := mongocmd.Lookup(described, "name")
	empty, _ := mongocmd.Lookup(described, "empty")
	if len(listed.(bson.A)) != 1 || name != mongocmd.Database || empty != false {
		t.Errorf("listDatabases = %v", reply)
	}
}

func TestDropRemovesACollectionAndRefusesOneThatIsNotThere(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "a"}]}`)

	reply := run(t, store, bson.D{f("drop", "orders"), f("$db", "shop")})
	err := refuse(t, store, bson.D{f("drop", "orders"), f("$db", "shop")})

	namespace, _ := mongocmd.Lookup(reply, "ns")
	if namespace != "shop.orders" || store.Count("orders") != 0 {
		t.Errorf("drop = %v, leaving %d documents", reply, store.Count("orders"))
	}
	if code, _ := mongocmd.CodeOf(err); code != mongocmd.CodeNamespaceNotFound {
		t.Errorf("dropping it twice = %v, want %d", err, mongocmd.CodeNamespaceNotFound)
	}
}

// A cursor over a collection that no longer exists has nothing left to hand out.
func TestDropDatabaseEmptiesTheStoreCursorsIncluded(t *testing.T) {
	store := seeded(t, ranked)
	identifier := cursorOf(t, run(t, store, bson.D{f("find", "things"), f("batchSize", int32(1))}))

	reply := run(t, store, bson.D{f("dropDatabase", int32(1)), f("$db", "shop")})

	dropped, _ := mongocmd.Lookup(reply, "dropped")
	if dropped != "shop" || store.Count("things") != 0 {
		t.Errorf("dropDatabase = %v, leaving %d documents", reply, store.Count("things"))
	}
	if refuse(t, store, bson.D{f("getMore", identifier), f("collection", "things")}) == nil {
		t.Error("a cursor survived the database being dropped")
	}
}

func TestABatchCommandWithoutItsBatchIsRefused(t *testing.T) {
	store := seeded(t, "")

	for _, want := range []struct {
		command bson.D
		blamed  string
	}{
		{bson.D{f("insert", "things")}, `insert needs a "documents" array`},
		{bson.D{f("insert", "things"), f("documents", bson.A{"not a document"})}, "documents[0] is string"},
		{bson.D{f("insert", "things"), f("documents", bson.A{}), f("ordered", "yes")}, "insert.ordered is string"},
		{bson.D{f("update", "things")}, `update needs a "updates" array`},
		{bson.D{f("delete", "things")}, `delete needs a "deletes" array`},
		{bson.D{f("delete", "things"), f("deletes", bson.A{bson.D{f("limit", int32(0))}})}, `a delete needs a "q" field`},
		{bson.D{f("delete", "things"), f("deletes", bson.A{bson.D{f("q", bson.D{}), f("limit", int32(5))}})}, "want 0 for every match"},
		{bson.D{f("delete", "things"), f("deletes", bson.A{bson.D{f("q", bson.D{}), f("limit", "no")}})}, "a delete.limit is string"},
		{bson.D{f("count", "things"), f("query", "no")}, "count.query is string"},
		{bson.D{f("count", "things"), f("skip", "no")}, "count.skip is string"},
		{bson.D{f("count", "things"), f("limit", "no")}, "count.limit is string"},
	} {
		err := refuse(t, store, want.command)

		if !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("%v = %v, want %q blamed", want.command, err, want.blamed)
		}
	}
}
