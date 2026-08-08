package docstore

import (
	"slices"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// An updateOutcome is what one entry of an update batch did, in the vocabulary
// the reply reports it in: matched is how many documents the filter found,
// modified how many of those actually changed, and upserted the _id of the one
// that had to be created.
type updateOutcome struct {
	matched  int
	modified int
	upserted any
}

func (c *collection) update(specification bson.D) (updateOutcome, error) {
	filter, err := requiredDocument("an update", specification, "q")
	if err != nil {
		return updateOutcome{}, err
	}
	change, err := requiredDocument("an update", specification, "u")
	if err != nil {
		return updateOutcome{}, err
	}
	multi, err := boolAt("an update", specification, "multi", false)
	if err != nil {
		return updateOutcome{}, err
	}
	creates, err := boolAt("an update", specification, "upsert", false)
	if err != nil {
		return updateOutcome{}, err
	}

	selected, err := c.selectFor(filter, multi)
	if err != nil {
		return updateOutcome{}, err
	}
	if len(selected) == 0 && creates {
		return c.create(filter, change)
	}
	return c.rewrite(selected, change)
}

func (c *collection) create(filter, change bson.D) (updateOutcome, error) {
	created, err := upsert(filter, change)
	if err != nil {
		return updateOutcome{}, err
	}
	if err := c.insert(created); err != nil {
		return updateOutcome{}, err
	}
	identifier, _ := mongocmd.Lookup(created, identifierField)
	// MongoDB counts an upserted document among the matched, which is why a
	// driver's matched_count is 1 for an update that found nothing.
	return updateOutcome{matched: 1, upserted: identifier}, nil
}

func (c *collection) rewrite(selected []int, change bson.D) (updateOutcome, error) {
	var outcome updateOutcome
	for _, index := range selected {
		updated, err := applyUpdate(c.documents[index], change)
		if err != nil {
			return outcome, err
		}
		if err := checkIdentifier(c.documents[index], updated); err != nil {
			return outcome, err
		}

		outcome.matched++
		// An update that changed nothing is matched but not modified, which is
		// the difference a driver reports and a lesson about idempotence reads.
		if compareDocuments(c.documents[index], updated) != 0 {
			c.documents[index], outcome.modified = updated, outcome.modified+1
		}
	}
	return outcome, nil
}

// checkIdentifier refuses an update that would move a document to a different
// _id. MongoDB calls that field immutable, and a lesson whose $set on _id
// silently worked would teach something false about identity.
func checkIdentifier(before, after bson.D) error {
	was, _ := mongocmd.Lookup(before, identifierField)
	now, _ := mongocmd.Lookup(after, identifierField)
	if equal(was, now) {
		return nil
	}
	return mongocmd.Fail(mongocmd.CodeImmutableField,
		"performing an update on the path '_id' would modify the immutable field '_id'")
}

// remove deletes what a filter selects. limit is MongoDB's blunt instrument: 0
// means every match and 1 means the first, and nothing else is a number the
// command can mean.
func (c *collection) remove(specification bson.D) (int, error) {
	filter, err := requiredDocument("a delete", specification, "q")
	if err != nil {
		return 0, err
	}
	limit, err := intAt("a delete", specification, "limit", 0)
	if err != nil {
		return 0, err
	}
	if limit != 0 && limit != 1 {
		return 0, mongocmd.Invalid("a delete's limit is %d, want 0 for every match or 1 for the first", limit)
	}

	selected, err := c.selectFor(filter, limit == 0)
	if err != nil {
		return 0, err
	}
	// Backwards, so that removing one document does not move the next.
	for position := len(selected) - 1; position >= 0; position-- {
		c.documents = slices.Delete(c.documents, selected[position], selected[position]+1)
	}
	return len(selected), nil
}

// selectFor answers where the matching documents are, stopping at the first one
// unless the command said it wanted them all.
func (c *collection) selectFor(filter bson.D, all bool) ([]int, error) {
	var selected []int
	for index, document := range c.documents {
		held, err := matches(document, filter)
		if err != nil {
			return nil, err
		}
		if !held {
			continue
		}
		selected = append(selected, index)
		if !all {
			break
		}
	}
	return selected, nil
}
