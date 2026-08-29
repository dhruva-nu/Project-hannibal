package sqltext

import (
	"strconv"
	"strings"
)

// A word is one token of a statement. text is folded to lower case so keywords
// compare without allocating; raw keeps the spelling a table name goes into the
// op log with.
type word struct {
	text string
	raw  string
	at   int
	name bool // an identifier or keyword, rather than punctuation
}

// String literals never become words: nothing downstream reads their contents,
// and skipping them is the whole point of scanning rather than splitting.
const (
	quote      = '\''
	identifier = '"'
	backtick   = '`'
)

// tokenize walks a statement, skipping comments and string literals, and returns
// its identifiers, keywords, and punctuation in order.
func tokenize(sql string) []word {
	var words []word

	for index := 0; index < len(sql); {
		char := sql[index]
		switch {
		case char == '-' && peek(sql, index) == '-':
			index = skipLineComment(sql, index)
		case char == '/' && peek(sql, index) == '*':
			index = skipBlockComment(sql, index)
		case char == quote:
			index = skipQuoted(sql, index, quote)
		case char == identifier || char == backtick:
			end := skipQuoted(sql, index, char)
			words = append(words, quotedName(sql, index, end, char))
			index = end
		case isNameByte(char):
			end := index
			for end < len(sql) && isNameByte(sql[end]) {
				end++
			}
			words = append(words, word{text: strings.ToLower(sql[index:end]), raw: sql[index:end], at: index, name: true})
			index = end
		case isSpace(char):
			index++
		default:
			words = append(words, word{text: sql[index : index+1], raw: sql[index : index+1], at: index})
			index++
		}
	}
	return words
}

// quotedName turns "user table" into the identifier it stands for, undoubling the
// quote SQL escapes with.
func quotedName(sql string, start, end int, mark byte) word {
	fence := string(mark)
	inner := strings.TrimSuffix(strings.TrimPrefix(sql[start:end], fence), fence)
	raw := strings.ReplaceAll(inner, fence+fence, fence)
	return word{text: strings.ToLower(raw), raw: raw, at: start, name: true}
}

// skipQuoted returns the index just past a run delimited by mark, where the mark
// doubled stands for itself. An unterminated run swallows the rest of the
// statement, which is what the server would reject it for anyway.
func skipQuoted(sql string, start int, mark byte) int {
	for index := start + 1; index < len(sql); index++ {
		if sql[index] != mark {
			continue
		}
		if peek(sql, index) == mark {
			index++
			continue
		}
		return index + 1
	}
	return len(sql)
}

func skipLineComment(sql string, start int) int {
	if end := strings.IndexByte(sql[start:], '\n'); end >= 0 {
		return start + end + 1
	}
	return len(sql)
}

func skipBlockComment(sql string, start int) int {
	if end := strings.Index(sql[start+2:], "*/"); end >= 0 {
		return start + 2 + end + 2
	}
	return len(sql)
}

// bindable rewrites Postgres's $1 placeholders into SQLite's ?1. The two mean
// the same thing — a parameter by position, repeatable — but they do not survive
// each other: SQLite reads $name as a *named* parameter whose name may contain
// "::", so "$1::text" is one parameter called "1::text" rather than a cast of
// $1. A Postgres cast is a dialect gap in either spelling, and "unrecognized
// token" says so where "missing named argument" only baffles.
func bindable(sql string) string {
	var rewritten strings.Builder

	copied := 0
	for _, item := range tokenize(sql) {
		if !isPlaceholder(sql, item) {
			continue
		}
		rewritten.WriteString(sql[copied:item.at])
		rewritten.WriteByte('?')
		rewritten.WriteString(item.raw[1:])
		copied = item.at + len(item.raw)
	}
	if copied == 0 {
		return sql
	}
	return rewritten.String() + sql[copied:]
}

// countPlaceholders reports the highest $N a statement uses, which is how many
// parameters it takes: $1 and $2 with $1 written twice is still two.
func countPlaceholders(sql string) int {
	highest := 0
	for _, item := range tokenize(sql) {
		if !isPlaceholder(sql, item) {
			continue
		}
		if number, err := strconv.Atoi(item.raw[1:]); err == nil && number > highest {
			highest = number
		}
	}
	return highest
}

// isPlaceholder wants a bare $ followed by digits. A quoted identifier that
// happens to spell one is excluded by looking at the source rather than the
// name, and a dollar-quoted string is excluded by the digits.
func isPlaceholder(sql string, item word) bool {
	if !item.name || len(item.raw) < 2 || sql[item.at] != '$' {
		return false
	}
	for _, char := range item.raw[1:] {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func peek(sql string, index int) byte {
	if index+1 < len(sql) {
		return sql[index+1]
	}
	return 0
}

// isNameByte accepts what an unquoted identifier is made of, plus every byte
// above ASCII so that a non-English table name stays one word.
func isNameByte(char byte) bool {
	switch {
	case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z':
		return true
	case char >= '0' && char <= '9':
		return true
	default:
		return char == '_' || char == '$' || char >= 0x80
	}
}

func isSpace(char byte) bool {
	switch char {
	case ' ', '\t', '\n', '\r', '\v', '\f':
		return true
	default:
		return false
	}
}
