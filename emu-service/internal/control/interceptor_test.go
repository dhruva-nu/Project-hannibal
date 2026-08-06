package control

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

func TestBeforeLeavesOperationsAloneWhenNothingIsArmed(t *testing.T) {
	verdict := mustArm(t).Before(Op{Emulator: "redis", Kind: "GET"})

	if verdict != (Verdict{}) {
		t.Errorf("verdict = %+v, want the zero verdict", verdict)
	}
}

func TestAfterAndTimesFailExactlyOneOperation(t *testing.T) {
	// The plan's headline example: leave the first two commits alone, fail the
	// third once, and let the fourth through so a retry can succeed.
	interceptor := mustArm(t, Rule{
		Match: "postgres.COMMIT", Action: ActionError, After: 2, Times: 1,
		Message: "could not serialize access due to concurrent update",
	})

	var failed []int
	for attempt := 1; attempt <= 5; attempt++ {
		if verdict := interceptor.Before(Op{Emulator: "postgres", Kind: "COMMIT"}); verdict.Err != nil {
			failed = append(failed, attempt)
			if !strings.Contains(verdict.Err.Error(), "serialize") {
				t.Errorf("error = %v, want the author's own message", verdict.Err)
			}
		}
	}
	if len(failed) != 1 || failed[0] != 3 {
		t.Errorf("failed on attempts %v, want only the third", failed)
	}
}

func TestOnlyMatchingOperationsAdvanceTheCount(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "postgres.COMMIT", Action: ActionError, After: 1})

	for range 3 {
		if verdict := interceptor.Before(Op{Emulator: "postgres", Kind: "QUERY"}); verdict.Err != nil {
			t.Fatal("a QUERY consumed the COMMIT rule's budget")
		}
	}
	if verdict := interceptor.Before(Op{Emulator: "postgres", Kind: "COMMIT"}); verdict.Err != nil {
		t.Error("the first commit failed, want it to pass the after offset")
	}
	if verdict := interceptor.Before(Op{Emulator: "postgres", Kind: "COMMIT"}); verdict.Err == nil {
		t.Error("the second commit passed, want it faulted")
	}
}

func TestTimesZeroFiresForever(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "redis.SET", Action: ActionError})

	for attempt := range 4 {
		if verdict := interceptor.Before(Op{Emulator: "redis", Kind: "SET"}); verdict.Err == nil {
			t.Fatalf("attempt %d passed, want every occurrence faulted", attempt+1)
		}
	}
}

func TestCapLetsItsLimitThroughAndFailsEverythingAfter(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "queue.publish", Action: ActionCap, Limit: 2})

	for attempt := 1; attempt <= 4; attempt++ {
		verdict := interceptor.Before(Op{Emulator: "queue", Kind: "publish"})
		faulted := verdict.Err != nil
		if want := attempt > 2; faulted != want {
			t.Errorf("publish %d faulted = %v, want %v", attempt, faulted, want)
		}
		if faulted && !strings.Contains(verdict.Err.Error(), "limit of 2") {
			t.Errorf("error = %v, want it to name the capacity", verdict.Err)
		}
	}
}

func TestDelayStallsWithoutFailing(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "redis.*", Action: ActionDelay, Millis: 250})

	verdict := interceptor.Before(Op{Emulator: "redis", Kind: "GET"})
	if verdict.Delay != 250*time.Millisecond {
		t.Errorf("delay = %v, want 250ms", verdict.Delay)
	}
	if verdict.Err != nil || verdict.DropConn {
		t.Errorf("verdict = %+v, want the operation to still succeed", verdict)
	}
}

func TestDropConnLeavesNoErrorForTheClientToRead(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "*.CONNECT", Action: ActionDropConn})

	verdict := interceptor.Before(Op{Emulator: "postgres", Kind: "CONNECT"})
	if !verdict.DropConn {
		t.Error("DropConn = false, want the socket dropped")
	}
	if verdict.Err != nil {
		t.Errorf("Err = %v, want none: a dropped connection has no error frame", verdict.Err)
	}
}

func TestGatedRulesCountOnlyTheOperationsTheyCouldActOn(t *testing.T) {
	// "after 1" plus "when depth_gte 100" means the second publish *at depth*,
	// not the second publish overall.
	interceptor := mustArm(t, Rule{
		Match: "queue.publish", Action: ActionError, After: 1,
		When: Conditions{"depth_gte": 100},
	})
	shallow := Op{Emulator: "queue", Kind: "publish", Gauges: map[string]int{"depth": 0}}
	deep := Op{Emulator: "queue", Kind: "publish", Gauges: map[string]int{"depth": 100}}

	for range 3 {
		if verdict := interceptor.Before(shallow); verdict.Err != nil {
			t.Fatal("a publish below the gate consumed the rule's budget")
		}
	}
	if verdict := interceptor.Before(deep); verdict.Err != nil {
		t.Error("the first publish at depth failed, want it to pass the after offset")
	}
	if verdict := interceptor.Before(deep); verdict.Err == nil {
		t.Error("the second publish at depth passed, want it faulted")
	}
}

func TestABlanketDelayDoesNotShadowASpecificFault(t *testing.T) {
	// Rules compete only within their own half of the verdict, so listing a
	// service-wide delay first cannot disable every fault behind it.
	interceptor := mustArm(t,
		Rule{Match: "redis.*", Action: ActionDelay, Millis: 250},
		Rule{Match: "redis.SET", Action: ActionError, Message: "disk full"},
	)

	verdict := interceptor.Before(Op{Emulator: "redis", Kind: "SET"})
	if verdict.Delay != 250*time.Millisecond {
		t.Errorf("delay = %v, want the blanket rule to still apply", verdict.Delay)
	}
	if verdict.Err == nil {
		t.Error("Err = nil, want the specific rule to still fire")
	}
	if verdict.Fault != "delay+error" {
		t.Errorf("Fault = %q, want both actions recorded", verdict.Fault)
	}
}

func TestARuleWhoseHalfOfTheVerdictIsTakenKeepsItsBudget(t *testing.T) {
	interceptor := mustArm(t,
		Rule{Match: "redis.SET", Action: ActionError, Times: 1, Message: "first"},
		Rule{Match: "redis.SET", Action: ActionError, Times: 1, Message: "second"},
	)

	for attempt, want := range []string{"first", "second"} {
		verdict := interceptor.Before(Op{Emulator: "redis", Kind: "SET"})
		if verdict.Err == nil {
			t.Fatalf("attempt %d passed, want it faulted", attempt+1)
		}
		if verdict.Err.Error() != want {
			t.Errorf("attempt %d error = %v, want %q", attempt+1, verdict.Err, want)
		}
	}
}

func TestBeforeRecordsEveryOperationWhetherOrNotItFaulted(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log, Rule{Match: "redis.SET", Action: ActionError})

	interceptor.Before(Op{Emulator: "redis", Kind: "GET", Target: "rate:1"})
	interceptor.Before(Op{Emulator: "redis", Kind: "SET", Target: "rate:1"})

	entries := log.Entries()
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want both operations recorded", len(entries))
	}
	if entries[0].Fault != "" || entries[0].Target != "rate:1" {
		t.Errorf("entry = %+v, want an unfaulted GET on rate:1", entries[0])
	}
	if entries[1].Fault != string(ActionError) {
		t.Errorf("entry = %+v, want the fault named", entries[1])
	}
}

func TestFireMarksAnOperationTheOperatorInvented(t *testing.T) {
	// Without the mark, an op log could be read as evidence that a client did
	// something the dashboard did.
	log := oplog.New(10)
	interceptor := mustArmInto(t, log, Rule{Match: "redis.SET", Action: ActionError})

	interceptor.Fire(Op{Emulator: "redis", Kind: "SET"})

	entries := log.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries = %+v, want the fired operation recorded", entries)
	}
	if entries[0].Control != "synthetic" {
		t.Errorf("entry = %+v, want it marked synthetic", entries[0])
	}
	if entries[0].Fault != string(ActionError) {
		t.Errorf("entry = %+v, want a fired operation to face the armed rules", entries[0])
	}
}

func TestBeforeLeavesAClientOperationUnmarked(t *testing.T) {
	log := oplog.New(10)

	mustArmInto(t, log).Before(Op{Emulator: "redis", Kind: "GET"})

	if entries := log.Entries(); entries[0].Control != "" {
		t.Errorf("entry = %+v, want no control mark on a client's own operation", entries[0])
	}
}

func TestRemoveRuleDisarmsOneAndSaysWhich(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log,
		Rule{Match: "redis.*", Action: ActionDelay, Millis: 1},
		Rule{Match: "postgres.COMMIT", Action: ActionError},
	)

	if err := interceptor.RemoveRule(0); err != nil {
		t.Fatalf("RemoveRule: %v", err)
	}

	rules := interceptor.Rules()
	if len(rules) != 1 || rules[0].Match != "postgres.COMMIT" {
		t.Errorf("rules = %+v, want only the commit rule left", rules)
	}
	if entries := log.Entries(); len(entries) != 1 || !strings.Contains(entries[0].Control, "redis.*") {
		t.Errorf("entries = %+v, want the removal recorded with its match", entries)
	}
}

func TestRemoveRuleRefusesAnIndexThatIsNotThere(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log, Rule{Match: "redis.*", Action: ActionDropConn})

	for _, index := range []int{-1, 1, 99} {
		if err := interceptor.RemoveRule(index); err == nil {
			t.Errorf("RemoveRule(%d) = nil, want a refusal", index)
		}
	}
	if len(interceptor.Rules()) != 1 {
		t.Error("a refused removal disarmed something anyway")
	}
	if entries := log.Entries(); len(entries) != 0 {
		t.Errorf("entries = %+v, want a refused removal left unrecorded", entries)
	}
}

func TestConfigRulesAreNotRecordedAsControlMutations(t *testing.T) {
	// The control entries exist so a run that had live control is identifiable.
	// Recording config-driven rules would destroy exactly that signal.
	log := oplog.New(10)
	mustArmInto(t, log, Rule{Match: "redis.SET", Action: ActionError})

	if entries := log.Entries(); len(entries) != 0 {
		t.Errorf("entries = %+v, want none: config is not a control-plane mutation", entries)
	}
}

func TestAddRuleRecordsThatSomethingDroveTheRunLive(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log)

	if err := interceptor.AddRule(Rule{Match: "redis.*", Action: ActionDelay, Millis: 250}); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	entries := log.Entries()
	if len(entries) != 1 || !strings.Contains(entries[0].Control, "redis.*") {
		t.Fatalf("entries = %+v, want a control entry naming the rule", entries)
	}
	if got := interceptor.Rules(); len(got) != 1 || got[0].Match != "redis.*" {
		t.Errorf("rules = %+v, want the added rule armed", got)
	}
}

func TestAddRuleRefusesAMalformedRuleAndChangesNothing(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log)

	if err := interceptor.AddRule(Rule{Match: "redis.GET", Action: ActionDelay}); err == nil {
		t.Fatal("AddRule = nil, want a refusal for a delay with no ms")
	}
	if got := interceptor.Rules(); len(got) != 0 {
		t.Errorf("rules = %+v, want none armed", got)
	}
	if entries := log.Entries(); len(entries) != 0 {
		t.Errorf("entries = %+v, want a refused mutation left unrecorded", entries)
	}
}

func TestResetRulesDisarmsEverythingAndSaysSo(t *testing.T) {
	log := oplog.New(10)
	interceptor := mustArmInto(t, log, Rule{Match: "redis.SET", Action: ActionError})

	interceptor.ResetRules()

	if got := interceptor.Rules(); len(got) != 0 {
		t.Errorf("rules = %+v, want none armed", got)
	}
	if verdict := interceptor.Before(Op{Emulator: "redis", Kind: "SET"}); verdict.Err != nil {
		t.Error("a disarmed rule still fired")
	}
	if entries := log.Entries(); len(entries) != 2 || entries[0].Control != "fault reset" {
		t.Errorf("entries = %+v, want the reset recorded before the operation", entries)
	}
}

func TestRulesAreReturnedInEvaluationOrder(t *testing.T) {
	interceptor := mustArm(t,
		Rule{Match: "redis.*", Action: ActionDelay, Millis: 1},
		Rule{Match: "redis.SET", Action: ActionError},
	)

	rules := interceptor.Rules()
	if len(rules) != 2 || rules[0].Match != "redis.*" || rules[1].Match != "redis.SET" {
		t.Errorf("rules = %+v, want declaration order preserved", rules)
	}
}

func TestNewRefusesTheWholeSetWhenOneRuleIsMalformed(t *testing.T) {
	_, err := New([]Rule{
		{Match: "redis.SET", Action: ActionError},
		{Match: "redis.GET", Action: "explode"},
	}, oplog.New(10))

	if err == nil {
		t.Fatal("New = nil, want a lesson with an unfireable fault refused")
	}
	if !strings.Contains(err.Error(), "explode") {
		t.Errorf("New = %v, want it to name the offending action", err)
	}
}

func TestLogExposesWhereOperationsAreRecorded(t *testing.T) {
	log := oplog.New(10)
	if got := mustArmInto(t, log).Log(); got != log {
		t.Error("Log returned a different log than the one armed against")
	}
}

func TestBeforeIsSafeForConcurrentConnections(t *testing.T) {
	// Every emulator serves each connection on its own goroutine, and a cap that
	// miscounts under concurrency would hand out more capacity than it promises.
	const callers = 8
	const each = 25
	const limit = 10
	interceptor := mustArm(t, Rule{Match: "queue.publish", Action: ActionCap, Limit: limit})

	var group sync.WaitGroup
	var mutex sync.Mutex
	passed := 0
	group.Add(callers)
	for range callers {
		go func() {
			defer group.Done()
			for range each {
				if interceptor.Before(Op{Emulator: "queue", Kind: "publish"}).Err == nil {
					mutex.Lock()
					passed++
					mutex.Unlock()
				}
			}
		}()
	}
	group.Wait()

	if passed != limit {
		t.Errorf("%d publishes passed, want exactly the cap of %d", passed, limit)
	}
}

func mustArm(t *testing.T, rules ...Rule) *Interceptor {
	t.Helper()
	return mustArmInto(t, oplog.New(1_000), rules...)
}

func mustArmInto(t *testing.T, log *oplog.Log, rules ...Rule) *Interceptor {
	t.Helper()
	interceptor, err := New(rules, log)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return interceptor
}
