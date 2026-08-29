package control

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

// An Action is what a rule does to the operations it matches.
type Action string

const (
	// ActionError fails the operation before the backend sees it.
	ActionError Action = "error"
	// ActionDelay stalls the operation, so a lesson can teach timeouts.
	ActionDelay Action = "delay"
	// ActionDropConn closes the connection with no reply, so the client sees a
	// dead socket rather than a protocol error.
	ActionDropConn Action = "drop_conn"
	// ActionCap lets Limit operations through and fails every one after that. It
	// is how a lesson author states a capacity — a connection ceiling, a queue
	// depth — rather than an offset into a sequence.
	ActionCap Action = "cap"
)

// Wildcard stands for a whole segment of a match pattern.
const Wildcard = "*"

const patternSeparator = "."

// Comparison suffixes a `when` condition key can carry.
const (
	atLeast = "_gte"
	atMost  = "_lte"
)

// A Rule makes the operations it matches misbehave. Rules are declarative
// because the alternative — a hook per emulator — puts the counting in four
// places and makes "fail the third commit" mean four different things.
type Rule struct {
	// Match is "<emulator>.<kind>", with Wildcard allowed for either segment.
	Match string `json:"match"`
	// Action is what happens to a matching operation.
	Action Action `json:"action"`
	// After is how many matching operations pass untouched before the rule starts
	// firing: after 2 leaves the first two alone and fires from the third.
	After int `json:"after,omitempty"`
	// Times caps how often the rule fires. Zero means every occurrence once After
	// is past.
	Times int `json:"times,omitempty"`
	// When gates the rule on the backend's own state.
	When Conditions `json:"when,omitempty"`
	// Message is the error text the client is given by ActionError or ActionCap.
	Message string `json:"message,omitempty"`
	// Code is the protocol's own name for the failure, which is what makes a
	// driver react rather than merely report: a Postgres client retries SQLSTATE
	// 40001 and gives up on 42601. Empty leaves the emulator's default.
	Code string `json:"code,omitempty"`
	// Millis is how long ActionDelay stalls for.
	Millis int `json:"ms,omitempty"`
	// Limit is ActionCap's capacity.
	Limit int `json:"limit,omitempty"`
}

// Conditions gate a rule on the gauges a backend reports about itself, keyed
// "<gauge>_gte" or "<gauge>_lte": {"depth_gte": 100} fires only while a queue
// holds at least 100 messages. A gauge the backend does not report satisfies
// nothing, so a gated rule can never fire by accident.
type Conditions map[string]int

// optionalFields are every rule field beyond match, action, and when, in a fixed
// order so a rule with two mistakes always reports the same one first.
var optionalFields = []string{"after", "times", "ms", "limit", "message", "code"}

// fieldsPerAction lists which optional fields each action reads. A field that is
// set but unread means the rule would not do what it appears to say, so Validate
// refuses it instead of ignoring it.
var fieldsPerAction = map[Action][]string{
	ActionError:    {"after", "times", "message", "code"},
	ActionDropConn: {"after", "times"},
	ActionDelay:    {"after", "times", "ms"},
	ActionCap:      {"limit", "message", "code"},
}

// requiredField is the field an action cannot be armed without.
var requiredField = map[Action]string{ActionDelay: "ms", ActionCap: "limit"}

// Validate reports why a rule cannot be armed. The config loader and the dev
// control socket both call it, so a malformed rule is refused where it enters
// rather than quietly never firing.
func (r Rule) Validate() error {
	if err := validatePattern(r.Match); err != nil {
		return err
	}
	if err := r.When.validate(); err != nil {
		return err
	}
	if r.After < 0 || r.Times < 0 {
		return fmt.Errorf("rule %q: after and times cannot be negative", r.Match)
	}
	return r.validateAction()
}

func (r Rule) validateAction() error {
	used, known := fieldsPerAction[r.Action]
	if !known {
		return fmt.Errorf("rule %q: unknown action %q", r.Match, r.Action)
	}
	for _, name := range optionalFields {
		if r.field(name) != 0 && !slices.Contains(used, name) {
			return fmt.Errorf("rule %q: action %q does not use %q", r.Match, r.Action, name)
		}
	}
	if required := requiredField[r.Action]; required != "" && r.field(required) <= 0 {
		return fmt.Errorf("rule %q: action %q needs a positive %q", r.Match, r.Action, required)
	}
	return nil
}

// field returns the rule's value for one of optionalFields, a set message
// counting as one so every field can be compared the same way.
func (r Rule) field(name string) int {
	switch name {
	case "after":
		return r.After
	case "times":
		return r.Times
	case "ms":
		return r.Millis
	case "limit":
		return r.Limit
	case "message":
		if r.Message != "" {
			return 1
		}
	case "code":
		if r.Code != "" {
			return 1
		}
	}
	return 0
}

// threshold is how many matching operations pass before the rule fires: an
// offset for the fault actions, a capacity for ActionCap.
func (r Rule) threshold() int {
	if r.Action == ActionCap {
		return r.Limit
	}
	return r.After
}

func (r Rule) delay() time.Duration {
	return time.Duration(r.Millis) * time.Millisecond
}

// message is what the client is told when the rule fails an operation.
func (r Rule) message() string {
	switch {
	case r.Message != "":
		return r.Message
	case r.Action == ActionCap:
		return fmt.Sprintf("limit of %d reached", r.Limit)
	default:
		return "injected fault"
	}
}

func (c Conditions) validate() error {
	for key := range c {
		if _, comparison := splitCondition(key); comparison == "" {
			return fmt.Errorf("condition %q: want a gauge name suffixed %q or %q", key, atLeast, atMost)
		}
	}
	return nil
}

// hold reports whether every condition is satisfied by the gauges a backend
// reported alongside the operation.
func (c Conditions) hold(gauges map[string]int) bool {
	for key, bound := range c {
		gauge, comparison := splitCondition(key)
		value, reported := gauges[gauge]
		switch {
		case !reported:
			return false
		case comparison == atLeast && value < bound:
			return false
		case comparison == atMost && value > bound:
			return false
		}
	}
	return true
}

// splitCondition separates a condition key into the gauge it reads and the
// comparison it applies. An unrecognised suffix yields an empty comparison,
// which validate rejects.
func splitCondition(key string) (gauge, comparison string) {
	for _, suffix := range []string{atLeast, atMost} {
		if name, found := strings.CutSuffix(key, suffix); found && name != "" {
			return name, suffix
		}
	}
	return key, ""
}

// validatePattern rejects a pattern that could never be compared against an Op
// name.
func validatePattern(pattern string) error {
	if pattern == Wildcard {
		return nil
	}
	emulator, kind, found := strings.Cut(pattern, patternSeparator)
	if !found || emulator == "" || kind == "" {
		return fmt.Errorf("match %q: want \"<emulator>.<kind>\", \"<emulator>.%s\", or %q", pattern, Wildcard, Wildcard)
	}
	return nil
}

// PatternEmulator returns the service a pattern is scoped to, or Wildcard when
// it applies to all of them. The config loader uses it to reject a fault aimed
// at a service the lesson never starts.
func PatternEmulator(pattern string) string {
	if pattern == Wildcard {
		return Wildcard
	}
	emulator, _, _ := strings.Cut(pattern, patternSeparator)
	return emulator
}

// matchName compares a pattern against an Op name one segment at a time. A
// wildcard stands for a whole segment, so "redis.*" matches every redis
// operation while "re*" matches nothing — partial globs read as typos.
func matchName(pattern, name string) bool {
	if pattern == Wildcard {
		return true
	}
	wantEmulator, wantKind, _ := strings.Cut(pattern, patternSeparator)
	emulator, kind, _ := strings.Cut(name, patternSeparator)
	return segmentMatches(wantEmulator, emulator) && segmentMatches(wantKind, kind)
}

func segmentMatches(pattern, segment string) bool {
	return pattern == Wildcard || pattern == segment
}

// an armedRule is a Rule plus the counting that decides when it fires. Counting
// lives here, not in each emulator, so "fail the third commit" means one thing
// across every protocol.
type armedRule struct {
	rule    Rule
	matched int
	fired   int
}

// fire reports whether the rule acts on this occurrence, spending its budget
// when it does. Only operations the rule would act on advance the count, so
// after 2 with when {depth_gte: 100} means the third publish *at depth*, not the
// third publish overall.
func (a *armedRule) fire(op Op) bool {
	if !matchName(a.rule.Match, op.Name()) || !a.rule.When.hold(op.Gauges) {
		return false
	}
	a.matched++
	if a.matched <= a.rule.threshold() {
		return false
	}
	if a.rule.Times > 0 && a.fired >= a.rule.Times {
		return false
	}
	a.fired++
	return true
}
