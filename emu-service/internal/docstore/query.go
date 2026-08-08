package docstore

import (
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// This file is why emu embeds a query evaluator rather than canning answers. A
// student who writes the wrong filter has to get the wrong documents back, the
// way a real database would; a fixture that returns the right rows whatever was
// asked for destroys the feedback loop the lesson exists to create.
//
// Everything emu cannot evaluate fails by name instead. Silence and a plausible
// wrong answer are the two outcomes that must be impossible.

// matches reports whether a document satisfies a filter. Every condition has to
// hold, which is what makes {a: 1, b: 2} an implicit $and.
func matches(document, filter bson.D) (bool, error) {
	for _, condition := range filter {
		held, err := matchCondition(document, condition)
		if err != nil || !held {
			return false, err
		}
	}
	return true, nil
}

func matchCondition(document bson.D, condition bson.E) (bool, error) {
	if strings.HasPrefix(condition.Key, "$") {
		return matchLogical(document, condition)
	}
	values := valuesAt(document, condition.Key)
	if operators, isOperators := operatorDocument(condition.Value); isOperators {
		return matchOperators(values, operators)
	}
	// A bare pattern is a pattern rather than a value to be equal to, which is
	// what {name: /^a/} means in every driver that can write it that way.
	if pattern, isRegex := condition.Value.(bson.Regex); isRegex {
		return matchRegex(values, pattern, "")
	}
	return matchValue(values, condition.Value), nil
}

// operatorDocument tells {price: {$gt: 5}} from {price: {currency: "GBP"}}. A
// document whose first key starts with $ is a set of operators; anything else is
// a value to compare the field against whole.
func operatorDocument(value any) (bson.D, bool) {
	document, embedded := value.(bson.D)
	if !embedded || len(document) == 0 || !strings.HasPrefix(document[0].Key, "$") {
		return nil, false
	}
	return document, true
}

func matchLogical(document bson.D, condition bson.E) (bool, error) {
	branches, err := branchesOf(condition)
	if err != nil {
		return false, err
	}

	for _, branch := range branches {
		held, err := matches(document, branch)
		if err != nil {
			return false, err
		}
		// $and fails on the first branch that does not hold, $or succeeds on the
		// first that does.
		if held != (condition.Key == "$and") {
			return held, nil
		}
	}
	return condition.Key == "$and", nil
}

func branchesOf(condition bson.E) ([]bson.D, error) {
	if condition.Key != "$and" && condition.Key != "$or" {
		return nil, mongocmd.Unsupported("the %s query operator", condition.Key)
	}
	listed, isList := condition.Value.(bson.A)
	if !isList || len(listed) == 0 {
		return nil, mongocmd.Invalid("%s needs a non-empty array of filters", condition.Key)
	}

	branches := make([]bson.D, len(listed))
	for index, branch := range listed {
		document, isDocument := branch.(bson.D)
		if !isDocument {
			return nil, mongocmd.Invalid("%s[%d] is %T, want a filter document", condition.Key, index, branch)
		}
		branches[index] = document
	}
	return branches, nil
}

// matchValue is equality, which reaches inside arrays: a document whose tags are
// ["red", "blue"] matches {tags: "red"} without the filter saying so. A filter
// looking for null matches a field that is missing as well as one that is null,
// which is MongoDB's rule and a common way for a lesson to go wrong.
func matchValue(values []any, wanted any) bool {
	if wanted == nil && len(values) == 0 {
		return true
	}
	return anyValue(values, func(value any) bool { return equal(value, wanted) })
}

// anyValue applies a predicate to every value a path reached and, for the ones
// that are arrays, to every element as well.
func anyValue(values []any, predicate func(any) bool) bool {
	for _, value := range values {
		if predicate(value) {
			return true
		}
		if array, isArray := value.(bson.A); isArray {
			for _, element := range array {
				if predicate(element) {
					return true
				}
			}
		}
	}
	return false
}

func matchOperators(values []any, operators bson.D) (bool, error) {
	for _, operator := range operators {
		held, err := matchOperator(values, operators, operator)
		if err != nil || !held {
			return false, err
		}
	}
	return true, nil
}

func matchOperator(values []any, operators bson.D, operator bson.E) (bool, error) {
	switch operator.Key {
	case "$eq":
		return matchValue(values, operator.Value), nil
	case "$ne":
		return !matchValue(values, operator.Value), nil
	case "$gt", "$gte", "$lt", "$lte":
		return matchOrdering(values, operator), nil
	case "$in", "$nin":
		return matchMembership(values, operator)
	case "$exists":
		return matchExists(values, operator)
	case "$regex":
		return matchRegex(values, operator.Value, options(operators))
	case "$options":
		return matchOptions(operators)
	case "$not":
		return matchNot(values, operator.Value)
	default:
		return false, mongocmd.Unsupported("the %s query operator", operator.Key)
	}
}

// orderings are how each comparison operator reads the result of compare.
var orderings = map[string][]int{
	"$gt":  {1},
	"$gte": {0, 1},
	"$lt":  {-1},
	"$lte": {-1, 0},
}

// matchOrdering compares only within a BSON type, which is MongoDB's rule and
// not an omission: {age: {$gt: 5}} does not match an age of "old", however the
// sort order places the two.
func matchOrdering(values []any, operator bson.E) bool {
	accepted := orderings[operator.Key]
	return anyValue(values, func(value any) bool {
		if rankOf(value) != rankOf(operator.Value) {
			return false
		}
		for _, wanted := range accepted {
			if compare(value, operator.Value) == wanted {
				return true
			}
		}
		return false
	})
}

func matchMembership(values []any, operator bson.E) (bool, error) {
	listed, isList := operator.Value.(bson.A)
	if !isList {
		return false, mongocmd.Invalid("%s needs an array", operator.Key)
	}

	for _, wanted := range listed {
		held, err := matchMember(values, wanted)
		if err != nil {
			return false, err
		}
		if held {
			return operator.Key == "$in", nil
		}
	}
	return operator.Key == "$nin", nil
}

// matchMember allows a regular expression among the values, which MongoDB does
// and a lesson filtering by pattern will reach for.
func matchMember(values []any, wanted any) (bool, error) {
	if pattern, isRegex := wanted.(bson.Regex); isRegex {
		return matchRegex(values, pattern, "")
	}
	return matchValue(values, wanted), nil
}

func matchExists(values []any, operator bson.E) (bool, error) {
	wanted, isBool := operator.Value.(bool)
	if !isBool {
		return false, mongocmd.Fail(mongocmd.CodeTypeMismatch, "$exists needs true or false, got %T", operator.Value)
	}
	return (len(values) > 0) == wanted, nil
}

func matchRegex(values []any, pattern any, flags string) (bool, error) {
	expression, err := compileRegex(pattern, flags)
	if err != nil {
		return false, err
	}
	return anyValue(values, func(value any) bool {
		text, isText := value.(string)
		return isText && expression.MatchString(text)
	}), nil
}

// matchOptions answers a $options that sits beside a $regex, which already read
// it. On its own it is a filter that cannot mean anything, and MongoDB says so.
func matchOptions(operators bson.D) (bool, error) {
	if _, paired := mongocmd.Lookup(operators, "$regex"); paired {
		return true, nil
	}
	return false, mongocmd.Invalid("$options needs a $regex beside it")
}

func matchNot(values []any, negated any) (bool, error) {
	if pattern, isRegex := negated.(bson.Regex); isRegex {
		held, err := matchRegex(values, pattern, "")
		return !held, err
	}
	operators, isOperators := operatorDocument(negated)
	if !isOperators {
		return false, mongocmd.Invalid("$not needs a set of operators or a regular expression")
	}
	held, err := matchOperators(values, operators)
	return !held, err
}

func options(operators bson.D) string {
	value, present := mongocmd.Lookup(operators, "$options")
	if flags, isText := value.(string); present && isText {
		return flags
	}
	return ""
}

// regexFlags are the MongoDB pattern options Go's regexp has an equivalent for.
// The ones missing — "x" for extended, "u" for unicode — would change what a
// pattern means, so a lesson that uses them is told rather than quietly given
// the answer to a different pattern.
var regexFlags = map[rune]string{'i': "i", 'm': "m", 's': "s"}

func compileRegex(pattern any, flags string) (*regexp.Regexp, error) {
	text, options, err := regexParts(pattern, flags)
	if err != nil {
		return nil, err
	}

	var translated strings.Builder
	for _, flag := range options {
		equivalent, known := regexFlags[flag]
		if !known {
			return nil, mongocmd.Unsupported("the %q regular expression option", string(flag))
		}
		translated.WriteString(equivalent)
	}
	if translated.Len() > 0 {
		text = "(?" + translated.String() + ")" + text
	}

	expression, err := regexp.Compile(text)
	if err != nil {
		return nil, mongocmd.Invalid("%s is not a regular expression emu can compile: %v", text, err)
	}
	return expression, nil
}

func regexParts(pattern any, flags string) (text, options string, err error) {
	switch typed := pattern.(type) {
	case string:
		return typed, flags, nil
	case bson.Regex:
		// A BSON regex carries its own options, and a $options beside it would be
		// a second answer to the same question. MongoDB rejects that pairing.
		if flags != "" {
			return "", "", mongocmd.Invalid("$options cannot be given beside a regular expression that carries its own")
		}
		return typed.Pattern, typed.Options, nil
	default:
		return "", "", mongocmd.Fail(mongocmd.CodeTypeMismatch, "$regex is %T, want a pattern", pattern)
	}
}
