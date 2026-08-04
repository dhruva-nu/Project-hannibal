package control

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// An Interceptor is the one point every operation in the system funnels through.
// It owns the armed rules and the op log; each emulator holds one and calls
// Before.
//
// Safe for concurrent use, because emulators serve every connection on its own
// goroutine.
type Interceptor struct {
	mutex sync.Mutex
	rules []*armedRule
	log   *oplog.Log
}

// New arms rules against log, refusing the whole set if any rule is malformed so
// that a lesson never runs with a fault that silently cannot fire.
//
// Rules that arrive this way are not recorded as control-plane mutations: config
// is the only control a lesson run gets, so recording it would destroy the very
// signal the op log's control entries exist to give.
func New(rules []Rule, log *oplog.Log) (*Interceptor, error) {
	interceptor := &Interceptor{log: log}
	for _, rule := range rules {
		if err := interceptor.arm(rule); err != nil {
			return nil, fmt.Errorf("arming faults: %w", err)
		}
	}
	return interceptor, nil
}

// Before decides what happens to op and records it, whether or not a fault
// fired. The Verdict is the emulator's instruction, not a suggestion.
func (i *Interceptor) Before(op Op) Verdict {
	i.mutex.Lock()
	defer i.mutex.Unlock()

	verdict := i.decide(op)
	// Recorded under the interceptor's mutex so rule counting and log ordinals
	// advance together; the log takes its own lock and never calls back here.
	i.log.Record(oplog.Entry{
		Emulator: op.Emulator,
		Op:       op.Kind,
		Target:   op.Target,
		Fault:    verdict.Fault,
	})
	return verdict
}

// AddRule arms a rule on an already-running emu and records the mutation, so a
// run whose faults were changed mid-flight is identifiable afterwards rather
// than indistinguishable from one driven only by config.
func (i *Interceptor) AddRule(rule Rule) error {
	if err := i.arm(rule); err != nil {
		return err
	}
	i.log.Record(oplog.Entry{Control: "fault add " + rule.Match})
	return nil
}

// ResetRules disarms every rule, and records that it happened.
func (i *Interceptor) ResetRules() {
	i.mutex.Lock()
	i.rules = nil
	i.mutex.Unlock()

	i.log.Record(oplog.Entry{Control: "fault reset"})
}

// Rules returns the armed rules in the order Before evaluates them.
func (i *Interceptor) Rules() []Rule {
	i.mutex.Lock()
	defer i.mutex.Unlock()

	rules := make([]Rule, 0, len(i.rules))
	for _, armed := range i.rules {
		rules = append(rules, armed.rule)
	}
	return rules
}

// Log returns the op log this interceptor records into.
func (i *Interceptor) Log() *oplog.Log { return i.log }

func (i *Interceptor) arm(rule Rule) error {
	if err := rule.Validate(); err != nil {
		return err
	}

	i.mutex.Lock()
	defer i.mutex.Unlock()

	i.rules = append(i.rules, &armedRule{rule: rule})
	return nil
}

// decide evaluates the armed rules in declaration order. The caller holds the
// mutex.
func (i *Interceptor) decide(op Op) Verdict {
	var verdict Verdict
	var fired []string

	for _, armed := range i.rules {
		if slotTaken(verdict, armed.rule.Action) || !armed.fire(op) {
			continue
		}
		apply(&verdict, armed.rule)
		fired = append(fired, string(armed.rule.Action))
	}

	verdict.Fault = strings.Join(fired, "+")
	return verdict
}

// slotTaken reports whether an earlier rule already decided this action's half of
// the verdict. Rules compete only within their own half — one changes an
// operation's timing, the other its outcome — so a blanket "redis.* delay" never
// shadows a specific "redis.SET error". A rule whose half is taken is skipped
// before it can spend its budget.
func slotTaken(verdict Verdict, action Action) bool {
	if action == ActionDelay {
		return verdict.Delay > 0
	}
	return verdict.DropConn || verdict.Err != nil
}

func apply(verdict *Verdict, rule Rule) {
	switch rule.Action {
	case ActionDelay:
		verdict.Delay = rule.delay()
	case ActionDropConn:
		verdict.DropConn = true
	default: // ActionError and ActionCap both fail the operation.
		verdict.Err = errors.New(rule.message())
	}
}
