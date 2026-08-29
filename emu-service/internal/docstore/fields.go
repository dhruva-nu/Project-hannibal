package docstore

import (
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// Reading a field off a command is where a driver's mistake and a lesson's
// mistake both surface, so every one of these names what it wanted and what it
// got. "filter is a string" tells a student something; "cannot unmarshal" does
// not.

func documentField(command mongocmd.Command, key string) (bson.D, error) {
	return documentAt(command.Name, command.Document, key)
}

func intField(command mongocmd.Command, key string, fallback int) (int, error) {
	return intAt(command.Name, command.Document, key, fallback)
}

func boolField(command mongocmd.Command, key string, fallback bool) (bool, error) {
	return boolAt(command.Name, command.Document, key, fallback)
}

// documentAt answers an absent field as an empty document, because an absent
// filter and an empty filter mean the same thing to every command that takes
// one: everything.
func documentAt(where string, document bson.D, key string) (bson.D, error) {
	value, present := mongocmd.Lookup(document, key)
	if !present || value == nil {
		return nil, nil
	}
	embedded, isDocument := value.(bson.D)
	if !isDocument {
		return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch, "%s.%s is %T, want a document", where, key, value)
	}
	return embedded, nil
}

// requiredDocument is for the fields a command cannot mean anything without: an
// update with no "u" is not an update of everything, it is a broken command.
func requiredDocument(where string, document bson.D, key string) (bson.D, error) {
	if _, present := mongocmd.Lookup(document, key); !present {
		return nil, mongocmd.Fail(mongocmd.CodeFailedToParse, "%s needs a %q field", where, key)
	}
	return documentAt(where, document, key)
}

func intAt(where string, document bson.D, key string, fallback int) (int, error) {
	value, present := mongocmd.Lookup(document, key)
	if !present || value == nil {
		return fallback, nil
	}
	if !isNumber(value) {
		return 0, mongocmd.Fail(mongocmd.CodeTypeMismatch, "%s.%s is %T, want a number", where, key, value)
	}
	return int(numberOf(value)), nil
}

// boolAt reads the numbers a client may send for a flag as well as the booleans,
// because BSON has both and drivers use both.
func boolAt(where string, document bson.D, key string, fallback bool) (bool, error) {
	value, present := mongocmd.Lookup(document, key)
	if !present || value == nil {
		return fallback, nil
	}
	if flag, isBool := value.(bool); isBool {
		return flag, nil
	}
	if isNumber(value) {
		return numberOf(value) != 0, nil
	}
	return false, mongocmd.Fail(mongocmd.CodeTypeMismatch, "%s.%s is %T, want true or false", where, key, value)
}

// documentList reads the array of documents a batch command carries — an
// insert's documents, an update's updates, a pipeline's stages.
func documentList(command mongocmd.Command, key string) ([]bson.D, error) {
	value, present := mongocmd.Lookup(command.Document, key)
	listed, isList := value.(bson.A)
	if !present || !isList {
		return nil, mongocmd.Fail(mongocmd.CodeFailedToParse,
			"%s needs a %q array, got %T", command.Name, key, value)
	}

	documents := make([]bson.D, len(listed))
	for index, entry := range listed {
		document, isDocument := entry.(bson.D)
		if !isDocument {
			return nil, mongocmd.Fail(mongocmd.CodeTypeMismatch,
				"%s.%s[%d] is %T, want a document", command.Name, key, index, entry)
		}
		documents[index] = document
	}
	return documents, nil
}
