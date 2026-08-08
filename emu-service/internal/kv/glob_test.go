package kv

import "testing"

// The glob is worth testing on its own because KEYS and SCAN MATCH are how a
// lesson finds what it wrote, and because Redis's rules are not Go's: * crosses
// anything, classes can be negated, and a backslash escapes.
func TestGlobMatching(t *testing.T) {
	for _, pattern := range []struct {
		glob string
		text string
		want bool
	}{
		{"*", "anything", true},
		{"*", "", true},
		{"**", "ab", true},
		{"a*", "abc", true},
		{"a*c", "abc", true},
		{"a*c", "abd", false},
		{"user:*", "user:1/session", true},
		{"?", "a", true},
		{"?", "", false},
		{"a?c", "abc", true},
		{"[abc]", "b", true},
		{"[abc]", "d", false},
		{"[^abc]", "d", true},
		{"[^abc]", "a", false},
		{"[a-c]", "b", true},
		{"[a-c]", "z", false},
		{"[a-]", "-", true},
		{`[\]]`, "]", true},
		{"[abc", "a", true},
		{"[]", "a", false},
		{"[a]b", "ab", true},
		{"[a]", "", false},
		{`\*`, "*", true},
		{`\*`, "a", false},
		{`\`, `\`, true},
		{"a", "", false},
		{"a", "ab", false},
		{"", "", true},
		{"", "a", false},
	} {
		if got := matches(pattern.glob, pattern.text); got != pattern.want {
			t.Errorf("matches(%q, %q) = %v, want %v", pattern.glob, pattern.text, got, pattern.want)
		}
	}
}

func TestAFailureCarriesItsOwnRedisPrefix(t *testing.T) {
	// resp reads RedisError to know the failure already names itself, the way
	// pgwire reads SQLState.
	if ErrWrongType.RedisError() != ErrWrongType.Error() {
		t.Errorf("RedisError = %q, want the whole line the client is shown", ErrWrongType.RedisError())
	}
	if got := wrongArity("HGETALL"); got.RedisError() != "ERR wrong number of arguments for 'hgetall' command" {
		t.Errorf("wrongArity = %q, want Redis's own wording", got)
	}
}
