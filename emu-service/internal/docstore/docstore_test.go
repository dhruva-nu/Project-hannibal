package docstore

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// These tests drive the store through decoded commands rather than through a
// socket, which is where its own mistakes are legible. mongowire's tests drive
// the same store through a real MongoDB driver, which is where the protocol's
// are.

func f(key string, value any) bson.E { return mongocmd.Field(key, value) }

func seeded(t *testing.T, seed string) *Backend {
	t.Helper()

	store := New()
	t.Cleanup(func() { _ = store.Close() })
	if seed != "" {
		if err := store.Seed([]byte(seed)); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}
	return store
}

func run(t *testing.T, store *Backend, command bson.D) bson.D {
	t.Helper()

	reply, err := attempt(store, command)
	if err != nil {
		t.Fatalf("%v = %v", command, err)
	}
	return reply
}

func refuse(t *testing.T, store *Backend, command bson.D) error {
	t.Helper()

	reply, err := attempt(store, command)
	if err == nil {
		t.Fatalf("%v = %v, want a refusal", command, reply)
	}
	return err
}

func attempt(store *Backend, command bson.D) (bson.D, error) {
	decoded, err := mongocmd.Read(command)
	if err != nil {
		return nil, err
	}
	executor, err := store.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = executor.Close() }()

	result, err := executor.Exec(control.Op{Kind: decoded.Kind, Target: decoded.Target, Payload: decoded})
	if err != nil {
		return nil, err
	}
	return mongocmd.Document(result)
}

// documents pulls the batch out of a cursor reply, which is the shape every read
// answers in.
func documents(t *testing.T, reply bson.D, key string) []bson.D {
	t.Helper()

	cursor, present := mongocmd.Lookup(reply, "cursor")
	if !present {
		t.Fatalf("%v carries no cursor", reply)
	}
	batch, present := mongocmd.Lookup(cursor.(bson.D), key)
	if !present {
		t.Fatalf("%v carries no %s", cursor, key)
	}

	found := make([]bson.D, 0, len(batch.(bson.A)))
	for _, entry := range batch.(bson.A) {
		found = append(found, entry.(bson.D))
	}
	return found
}

func number(t *testing.T, reply bson.D, key string) int {
	t.Helper()

	value, present := mongocmd.Lookup(reply, key)
	if !present {
		t.Fatalf("%v carries no %q", reply, key)
	}
	return int(numberOf(value))
}

// find is the shorthand the query tests read through: a filter in, the skus of
// what came back out.
func find(t *testing.T, store *Backend, filter bson.D) []string {
	t.Helper()

	reply := run(t, store, bson.D{f("find", "things"), f("filter", filter)})
	var skus []string
	for _, document := range documents(t, reply, "firstBatch") {
		value, _ := mongocmd.Lookup(document, "sku")
		skus = append(skus, value.(string))
	}
	return skus
}

func TestSeedLoadsACollectionOfDocuments(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "abc", "total": 50}, {"sku": "xyz", "total": 10}]}`)

	if store.Count("orders") != 2 {
		t.Errorf("orders holds %d, want 2", store.Count("orders"))
	}
	if store.Count("nothing") != 0 {
		t.Errorf("an unseeded collection holds %d, want 0", store.Count("nothing"))
	}
}

// Extended JSON is what makes a seeded _id a real ObjectId rather than a string
// that looks like one, which is the difference between a lesson's find({"_id":
// ObjectId(...)}) working and not.
func TestSeedReadsExtendedJSONSoATypedValueStaysTyped(t *testing.T) {
	store := seeded(t, `{"orders": [{"_id": {"$oid": "0102030405060708090a0b0c"}, "at": {"$date": "2024-01-02T03:04:05Z"}}]}`)

	found := documents(t, run(t, store, bson.D{f("find", "orders")}), "firstBatch")
	identifier, _ := mongocmd.Lookup(found[0], "_id")
	moment, _ := mongocmd.Lookup(found[0], "at")

	if _, isObjectID := identifier.(bson.ObjectID); !isObjectID {
		t.Errorf("_id is %T, want an ObjectID", identifier)
	}
	if _, isDate := moment.(bson.DateTime); !isDate {
		t.Errorf("at is %T, want a DateTime", moment)
	}
}

// A document with no _id gets one, because MongoDB gives it one and a student
// who prints the document has to see what a real driver would show them.
func TestASeededDocumentWithNoIdentifierIsGivenOne(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "abc"}]}`)

	found := documents(t, run(t, store, bson.D{f("find", "orders")}), "firstBatch")

	if found[0][0].Key != identifierField {
		t.Errorf("the first field is %q, want %q", found[0][0].Key, identifierField)
	}
	if _, isObjectID := found[0][0].Value.(bson.ObjectID); !isObjectID {
		t.Errorf("_id is %T, want an ObjectID", found[0][0].Value)
	}
}

// A lesson whose fixture did not load would grade students on a database that is
// not the one it describes, so every one of these fails the run.
func TestSeedThatCannotBeAppliedFailsLoudly(t *testing.T) {
	for _, want := range []struct{ seed, blamed string }{
		{`["orders"]`, "collection name to documents"},
		{`{"orders": {"sku": "abc"}}`, `collection "orders"`},
		{`{"orders": [12]}`, "orders document 1"},
		{`{"orders": [{"_id": 1}, {"_id": 1}]}`, "duplicate key"},
	} {
		err := New().Seed([]byte(want.seed))

		if err == nil || !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("Seed(%s) = %v, want %q blamed", want.seed, err, want.blamed)
		}
	}
}

func TestNoSeedIsNotAFailure(t *testing.T) {
	if err := New().Seed(nil); err != nil {
		t.Errorf("Seed(nil) = %v", err)
	}
}

func TestCloseDropsEverything(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "abc"}]}`)

	if err := store.Close(); err != nil {
		t.Fatalf("Close = %v", err)
	}
	if store.Count("orders") != 0 {
		t.Errorf("orders survived Close with %d documents", store.Count("orders"))
	}
}

func TestConnectIsAnOperationWithNothingToExecute(t *testing.T) {
	executor, err := seeded(t, "").Open()
	if err != nil {
		t.Fatalf("Open = %v", err)
	}

	result, err := executor.Exec(control.Op{Kind: emulator.KindConnect})

	if err != nil || len(result.Rows) != 0 {
		t.Errorf("Exec(CONNECT) = %v, %v, want an empty result", result, err)
	}
}

// A faulted operation is one the store never saw, so there is nothing to undo —
// unlike the SQL database, where a faulted COMMIT has writes to roll back.
func TestAbortHasNothingToUndo(t *testing.T) {
	store := seeded(t, `{"orders": [{"sku": "abc"}]}`)
	executor, _ := store.Open()

	executor.Abort(control.Op{Kind: mongocmd.KindInsert})

	if store.Count("orders") != 1 || executor.Close() != nil {
		t.Errorf("Abort changed the store to %d documents", store.Count("orders"))
	}
}

func TestAnOperationWithNoCommandBehindItIsReportedRatherThanRun(t *testing.T) {
	executor, _ := seeded(t, "").Open()

	_, err := executor.Exec(control.Op{Kind: mongocmd.KindFind, Payload: "not a command"})

	if err == nil || !strings.Contains(err.Error(), "no command") {
		t.Errorf("Exec = %v, want the missing command blamed", err)
	}
}

// A kind with no handler is emu contradicting itself. It says so rather than
// panicking on a nil function.
func TestAKindTheBackendHasNoHandlerForIsRefused(t *testing.T) {
	executor, _ := seeded(t, "").Open()

	_, err := executor.Exec(control.Op{
		Kind:    "invented",
		Payload: mongocmd.Command{Name: "invented"},
	})

	if err == nil || !strings.Contains(err.Error(), "invented") {
		t.Errorf("Exec = %v, want the kind named", err)
	}
}
