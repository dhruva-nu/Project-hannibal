package mongowire

import (
	"context"
	"net"
	"slices"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/docstore"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// These tests drive the codec with a real MongoDB driver over a real socket,
// because the only question that matters about a wire protocol is whether the
// clients that speak it are satisfied. The Go driver is a test dependency for
// exactly that, the way pgx is on the SQL side; the binary links only its BSON
// package.
//
// The listener takes an ephemeral port rather than 27017: this repository's own
// docker-compose publishes that one, and a test suite that cannot run while the
// app is up is a test suite nobody runs.

func serve(t *testing.T, seed string, rules []control.Rule) (string, *oplog.Log) {
	t.Helper()

	store := docstore.New()
	t.Cleanup(func() { _ = store.Close() })
	if seed != "" {
		if err := store.Seed([]byte(seed)); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}

	log := oplog.New(0)
	intercept, err := control.New(rules, log)
	if err != nil {
		t.Fatalf("arming rules: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	service := &emulator.Emulator{Proto: New(store), Backend: store}
	go service.Serve(listener, intercept)

	return listener.Addr().String(), log
}

func connect(t *testing.T, address string) *mongo.Collection {
	t.Helper()

	client, err := mongo.Connect(options.Client().
		ApplyURI("mongodb://" + address + "/?directConnection=true").
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	t.Cleanup(func() { _ = client.Disconnect(context.Background()) })

	return client.Database("shop").Collection("orders")
}

func skusOf(t *testing.T, cursor *mongo.Cursor) []string {
	t.Helper()

	var found []bson.D
	if err := cursor.All(context.Background(), &found); err != nil {
		t.Fatalf("reading the cursor: %v", err)
	}
	skus := make([]string, 0, len(found))
	for _, document := range found {
		value, _ := mongocmd.Lookup(document, "sku")
		skus = append(skus, value.(string))
	}
	return skus
}

const seeded = `{"orders": [
	{"sku": "widget", "total": 50},
	{"sku": "gizmo",  "total": 120}
]}`

func TestADriverRoundTripsDocumentsWithNoShim(t *testing.T) {
	address, _ := serve(t, seeded, nil)
	orders := connect(t, address)

	if _, err := orders.InsertOne(context.Background(), bson.D{{Key: "sku", Value: "cog"}, {Key: "total", Value: 5}}); err != nil {
		t.Fatalf("insert_one: %v", err)
	}
	if _, err := orders.InsertMany(context.Background(), []any{
		bson.D{{Key: "sku", Value: "bolt"}, {Key: "total", Value: 1}},
		bson.D{{Key: "sku", Value: "nut"}, {Key: "total", Value: 2}},
	}); err != nil {
		t.Fatalf("insert_many: %v", err)
	}

	cursor, err := orders.Find(context.Background(), bson.D{{Key: "total", Value: bson.D{{Key: "$lt", Value: 100}}}},
		options.Find().SetSort(bson.D{{Key: "sku", Value: 1}}))
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if found := skusOf(t, cursor); !slices.Equal(found, []string{"bolt", "cog", "nut", "widget"}) {
		t.Errorf("find = %v", found)
	}

	var one bson.D
	if err := orders.FindOne(context.Background(), bson.D{{Key: "sku", Value: "gizmo"}}).Decode(&one); err != nil {
		t.Fatalf("find_one: %v", err)
	}
	if value, _ := mongocmd.Lookup(one, "total"); value != int32(120) {
		t.Errorf("find_one = %v", one)
	}
}

func TestUpdatesAndDeletesCountWhatTheyDid(t *testing.T) {
	address, _ := serve(t, seeded, nil)
	orders := connect(t, address)

	updated, err := orders.UpdateOne(context.Background(),
		bson.D{{Key: "sku", Value: "widget"}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "total", Value: 5}}}})
	if err != nil {
		t.Fatalf("update_one: %v", err)
	}
	deleted, err := orders.DeleteOne(context.Background(), bson.D{{Key: "sku", Value: "gizmo"}})
	if err != nil {
		t.Fatalf("delete_one: %v", err)
	}
	remaining, err := orders.CountDocuments(context.Background(), bson.D{})
	if err != nil {
		t.Fatalf("count_documents: %v", err)
	}

	if updated.MatchedCount != 1 || updated.ModifiedCount != 1 {
		t.Errorf("update_one = %+v", updated)
	}
	if deleted.DeletedCount != 1 || remaining != 1 {
		t.Errorf("delete_one = %+v, %d left", deleted, remaining)
	}
}

// count_documents is an aggregate in every modern driver, which is why emu
// evaluates the four stages that pipeline is built from and nothing else.
func TestCountDocumentsWorksThroughTheDriversOwnPipeline(t *testing.T) {
	address, log := serve(t, seeded, nil)
	orders := connect(t, address)

	counted, err := orders.CountDocuments(context.Background(), bson.D{{Key: "total", Value: bson.D{{Key: "$gt", Value: 100}}}})
	if err != nil {
		t.Fatalf("count_documents: %v", err)
	}

	if counted != 1 {
		t.Errorf("count_documents = %d, want 1", counted)
	}
	if !recorded(log, "aggregate") {
		t.Errorf("the op log holds %v, want the aggregate the driver actually sent", log.Entries())
	}
}

// A result longer than one batch is paged, and every page is an operation a rule
// can fail.
func TestACursorIsPagedAndEveryPageIsAnOperation(t *testing.T) {
	address, log := serve(t, `{"orders": [{"sku": "a"}, {"sku": "b"}, {"sku": "c"}]}`, nil)
	orders := connect(t, address)

	cursor, err := orders.Find(context.Background(), bson.D{}, options.Find().SetBatchSize(1))
	if err != nil {
		t.Fatalf("find: %v", err)
	}

	if found := skusOf(t, cursor); !slices.Equal(found, []string{"a", "b", "c"}) {
		t.Errorf("paged find = %v", found)
	}
	if !recorded(log, mongocmd.KindGetMore) {
		t.Errorf("the op log holds %v, want getMore among it", log.Entries())
	}
}

func recorded(log *oplog.Log, kind string) bool {
	for _, entry := range log.Entries() {
		if entry.Op == kind {
			return true
		}
	}
	return false
}

// The phase's own exit criterion, driven by a real driver: two inserts land and
// the third fails.
func TestARuleFailsTheThirdInsertWithTheFirstTwoPersisted(t *testing.T) {
	address, log := serve(t, "", []control.Rule{{
		Match: "mongo.insert", After: 2, Times: 1, Action: control.ActionError,
		Message: "the write could not be applied due to a conflict",
	}})
	orders := connect(t, address)

	var failures []error
	for number := range 3 {
		_, err := orders.InsertOne(context.Background(), bson.D{{Key: "n", Value: number}})
		if err != nil {
			failures = append(failures, err)
		}
	}
	remaining, err := orders.CountDocuments(context.Background(), bson.D{})
	if err != nil {
		t.Fatalf("count_documents: %v", err)
	}

	if len(failures) != 1 || !strings.Contains(failures[0].Error(), "could not be applied") {
		t.Fatalf("failures = %v, want exactly the third insert", failures)
	}
	if remaining != 2 {
		t.Errorf("%d documents landed, want the first two", remaining)
	}

	// The default is MongoDB's serialization failure, which is the write failure
	// a client is written to notice.
	var failed *mongo.CommandError
	if !asCommandError(failures[0], &failed) || failed.Code != mongocmd.CodeWriteConflict {
		t.Errorf("the driver saw %v, want code %d", failures[0], mongocmd.CodeWriteConflict)
	}
	if entries := log.Entries(); entries[len(entries)-2].Fault != "error" {
		t.Errorf("the op log does not mark which insert was faulted: %v", entries)
	}
}

func asCommandError(err error, target **mongo.CommandError) bool {
	failed, isCommandError := err.(mongo.CommandError)
	if !isCommandError {
		return false
	}
	*target = &failed
	return true
}

// A duplicate _id is a write error inside a successful command, and the driver
// has to raise it as one.
func TestADuplicateIdentifierReachesTheDriverAsADuplicateKeyError(t *testing.T) {
	address, _ := serve(t, "", nil)
	orders := connect(t, address)

	if _, err := orders.InsertOne(context.Background(), bson.D{{Key: "_id", Value: 1}}); err != nil {
		t.Fatalf("the first insert: %v", err)
	}
	_, err := orders.InsertOne(context.Background(), bson.D{{Key: "_id", Value: 1}})

	if !mongo.IsDuplicateKeyError(err) {
		t.Errorf("the second insert = %v, want a duplicate key error", err)
	}
}

// The failure that must be impossible is emu quietly answering a question it did
// not evaluate.
func TestAnAggregationEmuDoesNotPerformReachesTheDriverAsAnError(t *testing.T) {
	address, _ := serve(t, seeded, nil)
	orders := connect(t, address)

	_, err := orders.Aggregate(context.Background(), mongo.Pipeline{
		{{Key: "$lookup", Value: bson.D{{Key: "from", Value: "other"}}}},
	})

	if err == nil || !strings.Contains(err.Error(), "$lookup") {
		t.Errorf("aggregate = %v, want the stage named", err)
	}
}

func TestACommandEmuDoesNotImplementLeavesTheConnectionUsable(t *testing.T) {
	address, _ := serve(t, seeded, nil)
	orders := connect(t, address)

	refused := orders.Database().RunCommand(context.Background(), bson.D{{Key: "findAndModify", Value: "orders"}}).Err()
	counted, err := orders.CountDocuments(context.Background(), bson.D{})

	if refused == nil || !strings.Contains(refused.Error(), "findAndModify") {
		t.Errorf("findAndModify = %v, want it refused by name", refused)
	}
	if err != nil || counted != 2 {
		t.Errorf("the connection did not survive: %d, %v", counted, err)
	}
}

// A driver will not talk to a server it cannot place, so the handshake has to
// satisfy it before any of this is reachable at all.
func TestTheHandshakeSatisfiesADriverAndIsNotAnOperation(t *testing.T) {
	address, log := serve(t, seeded, nil)
	orders := connect(t, address)

	if err := orders.Database().Client().Ping(context.Background(), nil); err != nil {
		t.Fatalf("ping: %v", err)
	}
	var built bson.D
	if err := orders.Database().RunCommand(context.Background(), bson.D{{Key: "buildInfo", Value: 1}}).Decode(&built); err != nil {
		t.Fatalf("buildInfo: %v", err)
	}

	if version, _ := mongocmd.Lookup(built, "version"); version != serverVersion {
		t.Errorf("buildInfo = %v", built)
	}
	for _, entry := range log.Entries() {
		if entry.Op != emulator.KindConnect {
			t.Errorf("the op log holds %q, want nothing but connections", entry.Op)
		}
	}
}

// Every operation carries how many documents the collection already held, so a
// rule can say "once it is full" rather than "after this many".
func TestAnOperationCarriesTheCollectionsDocumentCount(t *testing.T) {
	address, _ := serve(t, seeded, []control.Rule{{
		Match: "mongo.insert", Action: control.ActionError,
		When: control.Conditions{"documents_gte": 3}, Message: "the collection is full",
	}})
	orders := connect(t, address)

	_, third := orders.InsertOne(context.Background(), bson.D{{Key: "sku", Value: "third"}})
	_, fourth := orders.InsertOne(context.Background(), bson.D{{Key: "sku", Value: "fourth"}})

	if third != nil {
		t.Errorf("the third insert = %v, want it through at two documents", third)
	}
	if fourth == nil || !strings.Contains(fourth.Error(), "full") {
		t.Errorf("the fourth insert = %v, want it refused at three documents", fourth)
	}
}
