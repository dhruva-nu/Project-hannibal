package amqp

import (
	"sync"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// An outbox is where a delivery waits between the backend choosing a consumer
// for it and the session writing it out.
//
// It exists because push delivery runs against the grain of the serve loop.
// Session.Next is pull-shaped — the loop asks for the next operation — while
// Basic.Consume means the server writes frames nobody asked for, and the
// goroutine that decides to is whichever connection published. Deliver
// therefore never blocks and never touches the socket: it leaves the message
// here and wakes the session, which writes it from the one goroutine that owns
// the connection. That is what keeps push delivery inside the seam instead of
// changing it.
type outbox struct {
	mutex   sync.Mutex
	waiting []mq.Delivery
	// woken carries one signal for any number of messages, because the session
	// takes everything waiting each time it looks.
	woken chan struct{}
}

func newOutbox() *outbox { return &outbox{woken: make(chan struct{}, 1)} }

func (o *outbox) Deliver(delivery mq.Delivery) {
	o.mutex.Lock()
	o.waiting = append(o.waiting, delivery)
	o.mutex.Unlock()

	select {
	case o.woken <- struct{}{}:
	default: // already awake, and one wake-up is enough
	}
}

func (o *outbox) take() []mq.Delivery {
	o.mutex.Lock()
	defer o.mutex.Unlock()

	taken := o.waiting
	o.waiting = nil
	return taken
}
