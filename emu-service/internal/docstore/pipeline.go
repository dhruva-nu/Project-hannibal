package docstore

import (
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// There is no aggregation framework in emu v1, and this file is not the start of
// one. It exists because `count_documents` — the ordinary way anyone counts
// documents from Python — is not a count command at all: every modern driver
// sends it as an aggregate of $match, then $group with a $sum of 1. Refusing
// aggregate outright would mean refusing the count, and a lesson would have to
// be written around a driver quirk emu created.
//
// So the four stages that pipeline is built from are evaluated, and every other
// stage is refused by name. The failure that must be impossible is emu returning
// a plausible wrong answer to a $lookup it did not perform.
var stages = map[string]func([]bson.D, bson.E) ([]bson.D, error){
	"$match": matchStage,
	"$skip":  skipStage,
	"$limit": limitStage,
	"$count": countStage,
	"$group": groupStage,
}

func aggregateCommand(store *Backend, command mongocmd.Command) (bson.D, error) {
	pipeline, err := documentList(command, "pipeline")
	if err != nil {
		return nil, err
	}
	produced, err := runPipeline(store.collect(command.Target).documents, pipeline)
	if err != nil {
		return nil, err
	}

	options, err := readCursorOptions(command)
	if err != nil {
		return nil, err
	}
	return store.batch(command.Database+"."+command.Target, produced, options, "firstBatch"), nil
}

// readCursorOptions reads the batch size out of an aggregate's own `cursor`
// document, which is where it lives rather than beside the pipeline.
func readCursorOptions(command mongocmd.Command) (findOptions, error) {
	cursor, err := documentField(command, "cursor")
	if err != nil {
		return findOptions{}, err
	}
	size, err := intAt("aggregate.cursor", cursor, "batchSize", defaultBatchSize)
	return findOptions{batchSize: size}, err
}

func runPipeline(documents []bson.D, pipeline []bson.D) ([]bson.D, error) {
	// Cloned, because a stage may hand its own documents on and nothing
	// downstream should be able to write through to the collection.
	produced := make([]bson.D, len(documents))
	for index, document := range documents {
		produced[index] = cloneDocument(document)
	}

	for _, stage := range pipeline {
		if len(stage) != 1 {
			return nil, mongocmd.Invalid("a pipeline stage names exactly one operator, got %d", len(stage))
		}
		apply, implemented := stages[stage[0].Key]
		if !implemented {
			return nil, mongocmd.Unsupported("the %s aggregation stage: emu counts, it does not aggregate", stage[0].Key)
		}
		next, err := apply(produced, stage[0])
		if err != nil {
			return nil, err
		}
		produced = next
	}
	return produced, nil
}

func matchStage(documents []bson.D, stage bson.E) ([]bson.D, error) {
	filter, isDocument := stage.Value.(bson.D)
	if !isDocument {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch, "$match is %T, want a filter document", stage.Value)
	}

	var selected []bson.D
	for _, document := range documents {
		held, err := matches(document, filter)
		if err != nil {
			return nil, err
		}
		if held {
			selected = append(selected, document)
		}
	}
	return selected, nil
}

func skipStage(documents []bson.D, stage bson.E) ([]bson.D, error) {
	count, err := stageCount(stage)
	if err != nil {
		return nil, err
	}
	return window(documents, count, 0), nil
}

func limitStage(documents []bson.D, stage bson.E) ([]bson.D, error) {
	count, err := stageCount(stage)
	if err != nil {
		return nil, err
	}
	return window(documents, 0, count), nil
}

func stageCount(stage bson.E) (int, error) {
	if !isNumber(stage.Value) || numberOf(stage.Value) < 0 {
		return 0, mongocmd.Invalid("%s is %v, want a count that is not negative", stage.Key, stage.Value)
	}
	return int(numberOf(stage.Value)), nil
}

func countStage(documents []bson.D, stage bson.E) ([]bson.D, error) {
	name, isText := stage.Value.(string)
	if !isText || name == "" {
		return nil, mongocmd.Invalid("$count is %v, want the name of the field to put the count in", stage.Value)
	}
	return []bson.D{{mongocmd.Field(name, int32(len(documents)))}}, nil
}

// groupStage handles exactly one $group: the one a driver writes to count. Any
// other grouping is a real aggregation and is refused as one, because a $group
// emu evaluated halfway would answer a question nobody asked.
func groupStage(documents []bson.D, stage bson.E) ([]bson.D, error) {
	grouping, isDocument := stage.Value.(bson.D)
	if !isDocument {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch, "$group is %T, want a document", stage.Value)
	}

	identifier, grouped := mongocmd.Lookup(grouping, identifierField)
	if !grouped || len(grouping) != 2 {
		return nil, mongocmd.Unsupported("a $group beyond counting: emu evaluates only {_id: <constant>, <field>: {$sum: 1}}")
	}
	counter := grouping[0]
	if counter.Key == identifierField {
		counter = grouping[1]
	}
	if !countsOne(counter.Value) {
		return nil, mongocmd.Unsupported("a $group beyond counting: %s is %v, want {$sum: 1}", counter.Key, counter.Value)
	}
	return []bson.D{{
		mongocmd.Field(identifierField, identifier),
		mongocmd.Field(counter.Key, int32(len(documents))),
	}}, nil
}

// countsOne reports whether an accumulator is {$sum: 1} — the one MongoDB
// expression emu evaluates, and only because counting is built out of it.
func countsOne(accumulator any) bool {
	expression, isDocument := accumulator.(bson.D)
	if !isDocument || len(expression) != 1 || expression[0].Key != "$sum" {
		return false
	}
	return isNumber(expression[0].Value) && numberOf(expression[0].Value) == 1
}
