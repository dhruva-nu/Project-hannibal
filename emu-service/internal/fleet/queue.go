package fleet

import (
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/amqp"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/queues"
)

// queue is the message broker: AMQP on 5672 over queues that live in this
// process.
//
// The codec is handed the backend rather than only sitting in front of it,
// because a rule's `when` clause reads the queue's depth *before* the operation
// runs and only the backend knows it. That is the one thing the queue needs
// that the SQL database did not.
func queue() (*emulator.Emulator, error) {
	backend := queues.New()
	return &emulator.Emulator{Proto: amqp.New(backend), Backend: backend}, nil
}
