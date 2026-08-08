package kv

import "strings"

// matches reports whether text satisfies a Redis glob: * for any run, ? for one
// character, [abc] / [^abc] / [a-z] for a class, and a backslash to mean the next
// character literally.
//
// Go's path.Match is the obvious substitute and the wrong one — its * stops at a
// path separator, so KEYS "user:*" would miss "user:1/session". Redis keys are
// bytes and have no directories in them, and the difference is exactly the kind of
// thing a lesson would blame on the student.
func matches(pattern, text string) bool {
	for pattern != "" {
		switch pattern[0] {
		case '*':
			return matchesRun(strings.TrimLeft(pattern, "*"), text)
		case '?':
			if text == "" {
				return false
			}
			pattern, text = pattern[1:], text[1:]
		case '[':
			if text == "" {
				return false
			}
			rest, member := class(pattern, text[0])
			if !member {
				return false
			}
			pattern, text = rest, text[1:]
		default:
			literal := unescape(pattern)
			if text == "" || text[0] != literal[0] {
				return false
			}
			pattern, text = literal[1:], text[1:]
		}
	}
	return text == ""
}

// matchesRun tries what is left of the pattern at every position a * could have
// stopped at. Backtracking rather than a two-pointer scan because the pattern is
// a lesson's KEYS argument, not a hot loop.
func matchesRun(rest, text string) bool {
	if rest == "" {
		return true
	}
	for index := 0; index <= len(text); index++ {
		if matches(rest, text[index:]) {
			return true
		}
	}
	return false
}

// unescape drops a leading backslash so the character after it is compared
// literally. A trailing backslash with nothing after it is the backslash itself,
// which is what Redis does rather than failing the pattern.
func unescape(pattern string) string {
	if pattern[0] == '\\' && len(pattern) > 1 {
		return pattern[1:]
	}
	return pattern
}

// class reads a [...] group off the front of pattern and reports whether char
// belongs to it, along with what is left to match. An unterminated group ends at
// the end of the pattern, again following Redis rather than refusing it.
func class(pattern string, char byte) (string, bool) {
	pattern = pattern[1:]
	negated := strings.HasPrefix(pattern, "^")
	if negated {
		pattern = pattern[1:]
	}

	found := false
	for pattern != "" && pattern[0] != ']' {
		switch {
		case pattern[0] == '\\' && len(pattern) > 1:
			found, pattern = found || pattern[1] == char, pattern[2:]
		case len(pattern) > 2 && pattern[1] == '-' && pattern[2] != ']':
			found, pattern = found || (pattern[0] <= char && char <= pattern[2]), pattern[3:]
		default:
			found, pattern = found || pattern[0] == char, pattern[1:]
		}
	}
	return strings.TrimPrefix(pattern, "]"), found != negated
}
