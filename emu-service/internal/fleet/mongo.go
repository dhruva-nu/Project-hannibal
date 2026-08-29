package fleet

import (
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/docstore"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongowire"
)

// mongo is the document database: the MongoDB wire protocol in front of emu's
// own in-memory document store.
//
// The protocol is handed the store as well as fronting it, which the SQL
// emulator does not need to do. A rule's `when` reads gauges off the Op, and the
// Op is built where the frame is decoded — so the only way an operation can
// carry "how many documents this collection already holds" is for the decode
// side to be able to ask.
func mongo() (*emulator.Emulator, error) {
	store := docstore.New()
	return &emulator.Emulator{Proto: mongowire.New(store), Backend: store}, nil
}
