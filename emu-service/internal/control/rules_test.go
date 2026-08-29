package control

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestOpNameIsWhatRulesMatchAgainst(t *testing.T) {
	if got := (Op{Emulator: "postgres", Kind: "COMMIT"}).Name(); got != "postgres.COMMIT" {
		t.Errorf("Name = %q, want %q", got, "postgres.COMMIT")
	}
}

func TestValidateAcceptsEveryDocumentedRuleShape(t *testing.T) {
	for name, rule := range map[string]Rule{
		"the plan's serialization failure": {Match: "postgres.COMMIT", Action: ActionError, After: 2, Times: 1, Message: "could not serialize access"},
		"a blanket delay":                  {Match: "redis.*", Action: ActionDelay, Millis: 250},
		"a queue depth gate":               {Match: "queue.publish", Action: ActionError, When: Conditions{"depth_gte": 100}},
		"a dropped connection":             {Match: "*.CONNECT", Action: ActionDropConn},
		"a capacity":                       {Match: "queue.publish", Action: ActionCap, Limit: 100},
		"everything":                       {Match: Wildcard, Action: ActionDropConn},
	} {
		t.Run(name, func(t *testing.T) {
			if err := rule.Validate(); err != nil {
				t.Errorf("Validate: %v", err)
			}
		})
	}
}

func TestValidateRejectsRulesThatWouldNotDoWhatTheySay(t *testing.T) {
	for name, testCase := range map[string]struct {
		rule  Rule
		names string
	}{
		"no action":              {Rule{Match: "redis.GET"}, "action"},
		"unknown action":         {Rule{Match: "redis.GET", Action: "explode"}, "explode"},
		"delay without ms":       {Rule{Match: "redis.GET", Action: ActionDelay}, "ms"},
		"cap without limit":      {Rule{Match: "redis.GET", Action: ActionCap}, "limit"},
		"error with ms":          {Rule{Match: "redis.GET", Action: ActionError, Millis: 5}, "ms"},
		"error with limit":       {Rule{Match: "redis.GET", Action: ActionError, Limit: 5}, "limit"},
		"drop_conn with message": {Rule{Match: "redis.GET", Action: ActionDropConn, Message: "bye"}, "message"},
		"delay with message":     {Rule{Match: "redis.GET", Action: ActionDelay, Millis: 5, Message: "slow"}, "message"},
		"cap with after":         {Rule{Match: "redis.GET", Action: ActionCap, Limit: 2, After: 1}, "after"},
		"cap with times":         {Rule{Match: "redis.GET", Action: ActionCap, Limit: 2, Times: 1}, "times"},
		"negative after":         {Rule{Match: "redis.GET", Action: ActionError, After: -1}, "negative"},
		"negative times":         {Rule{Match: "redis.GET", Action: ActionError, Times: -1}, "negative"},
		"empty match":            {Rule{Action: ActionError}, "match"},
		"match with no kind":     {Rule{Match: "redis", Action: ActionError}, "match"},
		"match with no emulator": {Rule{Match: ".GET", Action: ActionError}, "match"},
		"unknown comparison":     {Rule{Match: "queue.publish", Action: ActionError, When: Conditions{"depth": 1}}, "depth"},
		"comparison with no gauge": {
			Rule{Match: "queue.publish", Action: ActionError, When: Conditions{"_gte": 1}}, "_gte",
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := testCase.rule.Validate()
			if err == nil {
				t.Fatalf("Validate = nil, want a refusal naming %q", testCase.names)
			}
			if !strings.Contains(err.Error(), testCase.names) {
				t.Errorf("Validate = %v, want it to name %q", err, testCase.names)
			}
		})
	}
}

func TestMatchNameTreatsWildcardsAsWholeSegments(t *testing.T) {
	for _, testCase := range []struct {
		pattern string
		name    string
		want    bool
	}{
		{Wildcard, "redis.SET", true},
		{"redis.*", "redis.SET", true},
		{"redis.*", "postgres.COMMIT", false},
		{"*.COMMIT", "postgres.COMMIT", true},
		{"*.COMMIT", "postgres.QUERY", false},
		{"redis.SET", "redis.SET", true},
		{"redis.SET", "redis.GET", false},
		{"re*", "redis.SET", false}, // a partial glob reads as a typo, so it matches nothing
	} {
		if got := matchName(testCase.pattern, testCase.name); got != testCase.want {
			t.Errorf("matchName(%q, %q) = %v, want %v", testCase.pattern, testCase.name, got, testCase.want)
		}
	}
}

func TestPatternEmulatorNamesTheServiceARuleIsScopedTo(t *testing.T) {
	for pattern, want := range map[string]string{
		"redis.SET": "redis",
		"redis.*":   "redis",
		Wildcard:    Wildcard,
		"*.COMMIT":  Wildcard,
	} {
		if got := PatternEmulator(pattern); got != want {
			t.Errorf("PatternEmulator(%q) = %q, want %q", pattern, got, want)
		}
	}
}

func TestConditionsHoldAgainstReportedGauges(t *testing.T) {
	for name, testCase := range map[string]struct {
		conditions Conditions
		gauges     map[string]int
		want       bool
	}{
		"at the lower bound":     {Conditions{"depth_gte": 100}, map[string]int{"depth": 100}, true},
		"below the lower bound":  {Conditions{"depth_gte": 100}, map[string]int{"depth": 99}, false},
		"at the upper bound":     {Conditions{"depth_lte": 10}, map[string]int{"depth": 10}, true},
		"above the upper bound":  {Conditions{"depth_lte": 10}, map[string]int{"depth": 11}, false},
		"both bounds":            {Conditions{"depth_gte": 5, "depth_lte": 10}, map[string]int{"depth": 7}, true},
		"one bound unsatisfied":  {Conditions{"depth_gte": 5, "depth_lte": 10}, map[string]int{"depth": 11}, false},
		"gauge never reported":   {Conditions{"depth_gte": 1}, map[string]int{"rows": 9}, false},
		"no gauges at all":       {Conditions{"depth_gte": 1}, nil, false},
		"no conditions to check": {nil, nil, true},
	} {
		t.Run(name, func(t *testing.T) {
			if got := testCase.conditions.hold(testCase.gauges); got != testCase.want {
				t.Errorf("hold = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestThresholdIsAnOffsetForFaultsAndACapacityForCap(t *testing.T) {
	if got := (Rule{Action: ActionError, After: 3}).threshold(); got != 3 {
		t.Errorf("threshold = %d, want the after offset", got)
	}
	if got := (Rule{Action: ActionCap, Limit: 7}).threshold(); got != 7 {
		t.Errorf("threshold = %d, want the cap limit", got)
	}
}

func TestDelayConvertsMillisecondsOnce(t *testing.T) {
	if got := (Rule{Millis: 250}).delay(); got != 250*time.Millisecond {
		t.Errorf("delay = %v, want 250ms", got)
	}
}

func TestMessageFallsBackToSomethingATeachableErrorCanCarry(t *testing.T) {
	for name, testCase := range map[string]struct {
		rule Rule
		want string
	}{
		"an author's own text": {Rule{Action: ActionError, Message: "could not serialize"}, "could not serialize"},
		"a bare error":         {Rule{Action: ActionError}, "injected fault"},
		"a bare cap":           {Rule{Action: ActionCap, Limit: 100}, "limit of 100 reached"},
	} {
		t.Run(name, func(t *testing.T) {
			if got := testCase.rule.message(); got != testCase.want {
				t.Errorf("message = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestOnlyTheActionsThatFailAnOperationMayNameACode(t *testing.T) {
	// A code is the protocol's own name for the failure, so an action that never
	// produces one would be saying something it cannot do.
	for name, testCase := range map[string]struct {
		rule    Rule
		armable bool
	}{
		"an error that names its code": {
			Rule{Match: "postgres.COMMIT", Action: ActionError, Code: "40001"},
			true,
		},
		"a cap that names its code": {
			Rule{Match: "postgres.CONNECT", Action: ActionCap, Limit: 5, Code: "53300"},
			true,
		},
		"a delay that names a code": {
			Rule{Match: "postgres.*", Action: ActionDelay, Millis: 10, Code: "40001"},
			false,
		},
		"a dropped connection that names a code": {
			Rule{Match: "postgres.*", Action: ActionDropConn, Code: "40001"},
			false,
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := testCase.rule.Validate()

			if testCase.armable && err != nil {
				t.Errorf("Validate = %v, want the rule armed", err)
			}
			if !testCase.armable && err == nil {
				t.Error("Validate accepted a code the action would never use")
			}
		})
	}
}

func TestAnInjectedFaultCarriesTheCodeTheRuleAskedFor(t *testing.T) {
	verdict := Verdict{}
	apply(&verdict, Rule{Match: "postgres.COMMIT", Action: ActionError, Code: "40001", Message: "nope"})

	var fault *FaultError
	if !errors.As(verdict.Err, &fault) {
		t.Fatalf("Err = %v, want a fault that carries its code", verdict.Err)
	}
	if fault.Code != "40001" || fault.Message != "nope" {
		t.Errorf("fault = %#v, want the rule's code and message", fault)
	}
}
