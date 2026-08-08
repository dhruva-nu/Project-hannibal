package docstore

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// count_documents is not a count command in any modern driver: it is an
// aggregate of $match, then $group with a $sum of 1. These are the four stages
// that pipeline is built from, and nothing else.

func aggregate(t *testing.T, store *Backend, stages bson.A) bson.D {
	t.Helper()

	reply := run(t, store, bson.D{f("aggregate", "things"), f("pipeline", stages), f("cursor", bson.D{})})
	found := documents(t, reply, "firstBatch")
	if len(found) == 0 {
		return nil
	}
	return found[0]
}

func TestTheGroupCountEveryDriverSendsForCountDocuments(t *testing.T) {
	store := seeded(t, ranked)

	counted := aggregate(t, store, bson.A{
		bson.D{f("$match", bson.D{f("n", bson.D{f("$gte", int32(2))})})},
		bson.D{f("$group", bson.D{f("_id", int32(1)), f("n", bson.D{f("$sum", int32(1))})})},
	})

	if value(t, counted, "n") != int32(2) {
		t.Errorf("counted = %v, want 2", counted)
	}
}

func TestCountAsAStageOfItsOwn(t *testing.T) {
	store := seeded(t, ranked)

	counted := aggregate(t, store, bson.A{
		bson.D{f("$skip", int32(1))},
		bson.D{f("$limit", int32(2))},
		bson.D{f("$count", "total")},
	})

	if value(t, counted, "total") != int32(2) {
		t.Errorf("counted = %v, want 2", counted)
	}
}

// A pipeline of nothing but $match is a find written the long way, and refusing
// it would buy nothing.
func TestAPipelineThatOnlyMatchesAnswersTheDocuments(t *testing.T) {
	store := seeded(t, ranked)

	found := aggregate(t, store, bson.A{bson.D{f("$match", bson.D{f("sku", "a")})}})

	if value(t, found, "sku") != "a" {
		t.Errorf("found = %v", found)
	}
}

func TestAnEmptyPipelineOverAnEmptyCollectionIsNotAFailure(t *testing.T) {
	if found := aggregate(t, seeded(t, ""), bson.A{}); found != nil {
		t.Errorf("found = %v, want nothing", found)
	}
}

// A pipeline can outrun one batch like anything else can.
func TestAnAggregateBatchesThroughItsOwnCursorOptions(t *testing.T) {
	store := seeded(t, ranked)

	reply := run(t, store, bson.D{
		f("aggregate", "things"),
		f("pipeline", bson.A{}),
		f("cursor", bson.D{f("batchSize", int32(2))}),
	})

	if len(documents(t, reply, "firstBatch")) != 2 || cursorOf(t, reply) == 0 {
		t.Errorf("reply = %v, want two documents and a cursor", reply)
	}
}

// The failure that has to be impossible is emu returning a plausible answer to a
// stage it did not perform.
func TestAnAggregationEmuDoesNotPerformIsRefusedByName(t *testing.T) {
	store := seeded(t, ranked)

	for _, want := range []struct {
		stages bson.A
		blamed string
	}{
		{bson.A{bson.D{f("$lookup", bson.D{})}}, "$lookup aggregation stage"},
		{bson.A{bson.D{f("$match", bson.D{}), f("$limit", int32(1))}}, "exactly one operator"},
		{bson.A{bson.D{f("$match", "not a filter")}}, "$match is string"},
		{bson.A{bson.D{f("$skip", "no")}}, "$skip is no"},
		{bson.A{bson.D{f("$limit", int32(-1))}}, "$limit is -1"},
		{bson.A{bson.D{f("$count", int32(1))}}, "$count is 1"},
		{bson.A{bson.D{f("$count", "")}}, "want the name of the field"},
		{bson.A{bson.D{f("$group", "no")}}, "$group is string"},
		{bson.A{bson.D{f("$group", bson.D{f("n", bson.D{f("$sum", int32(1))})})}}, "$group beyond counting"},
		{bson.A{bson.D{f("$group", bson.D{f("_id", "$sku"), f("total", bson.D{f("$sum", "$n")})})}}, "want {$sum: 1}"},
		{bson.A{bson.D{f("$group", bson.D{f("_id", int32(1)), f("n", int32(5))})}}, "want {$sum: 1}"},
	} {
		err := refuse(t, store, bson.D{f("aggregate", "things"), f("pipeline", want.stages), f("cursor", bson.D{})})

		if !strings.Contains(err.Error(), want.blamed) {
			t.Errorf("%v = %v, want %q blamed", want.stages, err, want.blamed)
		}
	}
}

func TestAnAggregateWithAMalformedCursorOptionIsRefused(t *testing.T) {
	store := seeded(t, ranked)

	for _, command := range []bson.D{
		{f("aggregate", "things"), f("pipeline", bson.A{}), f("cursor", "no")},
		{f("aggregate", "things"), f("pipeline", bson.A{}), f("cursor", bson.D{f("batchSize", "no")})},
		{f("aggregate", "things"), f("pipeline", "no"), f("cursor", bson.D{})},
	} {
		if err := refuse(t, store, command); err == nil {
			t.Errorf("%v was accepted", command)
		}
	}
}

// $group carries its own _id through, which is what a driver reads back.
func TestTheGroupKeyComesBackOnTheCountedDocument(t *testing.T) {
	counted := aggregate(t, seeded(t, ranked), bson.A{
		bson.D{f("$group", bson.D{f("n", bson.D{f("$sum", int32(1))}), f("_id", nil)})},
	})

	if _, present := mongocmd.Lookup(counted, "_id"); !present || value(t, counted, "n") != int32(4) {
		t.Errorf("counted = %v, want an _id and a count of 4", counted)
	}
}
