package mq

import (
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

func TestAMessageRidesBackThroughTheResultEveryBackendReturns(t *testing.T) {
	sent := Delivery{Queue: "jobs", Tag: 4, Message: Message{Body: []byte("hello")}}

	back, found := Fetch(Fetched(sent))

	if !found || back.Tag != sent.Tag || string(back.Message.Body) != "hello" {
		t.Errorf("Fetch(Fetched(%#v)) = %#v, %v", sent, back, found)
	}
}

func TestAnEmptyQueueCarriesNoMessageRatherThanAnEmptyOne(t *testing.T) {
	if _, found := Fetch(emulator.Result{}); found {
		t.Error("a result with no rows produced a message")
	}
}

func TestARowThatIsNotAMessageIsNotMistakenForOne(t *testing.T) {
	// Nothing in emu builds one; the check is what stops a future backend's
	// mistake from being read as a delivery with an empty body.
	_, found := Fetch(emulator.Result{Rows: [][]any{{"not a delivery"}}})

	if found {
		t.Error("a row holding something else was taken for a message")
	}
}
