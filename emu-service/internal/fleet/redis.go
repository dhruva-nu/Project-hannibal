package fleet

import (
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/kv"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/resp"
)

// redis is the cache: RESP on 6379 over an in-memory key space. Unlike the SQL
// database it cannot fail to be built — there is no file to open and no engine to
// start — so the error in the signature is the registry's shape rather than
// anything this one can produce.
func redis() (*emulator.Emulator, error) {
	return &emulator.Emulator{Proto: resp.New(), Backend: kv.New()}, nil
}
