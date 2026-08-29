package queues

import (
	"slices"
	"strings"
)

// The exchange kinds emu routes. Headers exchanges are the one AMQP kind
// missing, and declaring one fails the run rather than quietly behaving like a
// fanout — routing on a field table is a different matcher, and no lesson has
// asked for it.
const (
	kindDirect = "direct"
	kindFanout = "fanout"
	kindTopic  = "topic"
)

// defaultExchange is the one every "hello world" lesson uses without knowing it
// has an exchange at all: it delivers to the queue its routing key names.
const defaultExchange = ""

// topicSeparator is what a topic pattern and a routing key are both words of.
const topicSeparator = "."

// The two wildcards a topic binding may use.
const (
	oneWord  = "*"
	anyWords = "#"
)

// An exchange is a routing rule with a list of queues attached to it.
type exchange struct {
	kind     string
	bindings []binding
}

type binding struct {
	target *queue
	key    string
}

func (b *Backend) hasExchange(name string) bool {
	if name == defaultExchange {
		return true
	}
	_, declared := b.exchanges[name]
	return declared
}

// declareExchange creates an exchange, or with passive only asserts that it
// exists. Redeclaring one as another kind is refused, because a lesson whose
// fanout quietly stayed a direct would grade everyone on the wrong routing.
func (b *Backend) declareExchange(name string, kind string, passive bool) error {
	if name == defaultExchange {
		return failure(codeAccessRefused, "the default exchange cannot be declared")
	}
	existing, declared := b.exchanges[name]
	switch {
	case passive && !declared:
		return noExchange(name)
	case passive:
		return nil
	case !slices.Contains([]string{kindDirect, kindFanout, kindTopic}, kind):
		return failure(codeCommandInvalid, "exchange %q: emu does not implement the %q kind", name, kind)
	case declared && existing.kind != kind:
		return failure(codePreconditionFailed, "exchange %q is already a %s, not a %s", name, existing.kind, kind)
	case declared:
		return nil
	}
	b.exchanges[name] = &exchange{kind: kind}
	return nil
}

// bind routes an exchange's matching messages into a queue. The default
// exchange cannot be bound to: every queue is already on it under its own name,
// and a lesson that thinks it added a route there has not.
func (b *Backend) bind(target *queue, exchangeName, routingKey string) error {
	if exchangeName == defaultExchange {
		return failure(codeAccessRefused, "the default exchange cannot be bound to")
	}
	routed, declared := b.exchanges[exchangeName]
	if !declared {
		return noExchange(exchangeName)
	}
	routed.bindings = append(routed.bindings, binding{target: target, key: routingKey})
	return nil
}

// destinations is every queue a message addressed this way reaches. A queue
// bound twice by two patterns that both match still receives the message once,
// which is what AMQP requires and what a lesson counting messages assumes.
func (b *Backend) destinations(exchangeName, routingKey string) []*queue {
	if exchangeName == defaultExchange {
		if named, declared := b.queues[routingKey]; declared {
			return []*queue{named}
		}
		return nil
	}

	routed, declared := b.exchanges[exchangeName]
	if !declared {
		return nil
	}
	var reached []*queue
	for _, bound := range routed.bindings {
		if routed.reaches(bound.key, routingKey) && !slices.Contains(reached, bound.target) {
			reached = append(reached, bound.target)
		}
	}
	return reached
}

func (e *exchange) reaches(pattern, routingKey string) bool {
	switch e.kind {
	case kindFanout:
		return true
	case kindTopic:
		return topicMatches(pattern, routingKey)
	default:
		return pattern == routingKey
	}
}

func (e *exchange) unbindAll(target *queue) {
	e.bindings = slices.DeleteFunc(e.bindings, func(bound binding) bool { return bound.target == target })
}

// topicMatches walks a binding pattern against a routing key the way a topic
// exchange does: "*" stands for exactly one word, "#" for any number of them
// including none.
func topicMatches(pattern, routingKey string) bool {
	return wordsMatch(strings.Split(pattern, topicSeparator), strings.Split(routingKey, topicSeparator))
}

func wordsMatch(pattern, words []string) bool {
	switch {
	case len(pattern) == 0:
		return len(words) == 0
	case pattern[0] == anyWords:
		// Either "#" stands for nothing more, or it swallows one word and is
		// still standing.
		return wordsMatch(pattern[1:], words) || (len(words) > 0 && wordsMatch(pattern, words[1:]))
	case len(words) == 0:
		return false
	case pattern[0] == oneWord || pattern[0] == words[0]:
		return wordsMatch(pattern[1:], words[1:])
	default:
		return false
	}
}
