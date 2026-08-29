package mongowire

import (
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// What emu says about itself. These are the commands a driver sends before it
// will run anything of the student's, and they are answered here rather than
// becoming Ops: a lesson grades what the code did, not what the driver did to
// get a connection into a usable state.

// maxWireVersion is the protocol version emu claims, and it has to be high
// enough that a modern driver will speak to it at all: pymongo 4.x refuses a
// server whose maxWireVersion is below the release it dropped support at.
// 21 is MongoDB 8.0. Claiming a version rather than a feature is how this
// protocol has always worked, and every feature emu does not have is one a
// client discovers by being told so when it asks.
const maxWireVersion = 21

// serverVersion is what a client is told it connected to. Drivers switch
// behaviour on it, so it has to be a version that exists; the suffix is where
// real servers put their packaging and where emu puts the truth.
const serverVersion = "8.0.0"

// sessionTimeoutMinutes has to be present for a driver to use logical sessions,
// which pymongo attaches to every command whether or not the lesson asked for
// one. Absent, pymongo sends no lsid and some commands change shape.
const sessionTimeoutMinutes = 30

func (s *session) answer(command mongocmd.Command) error {
	switch command.Kind {
	case "hello", "ismaster":
		return s.send(s.greeting(command))
	case "buildinfo":
		return s.send(buildInfo())
	default:
		// ping, getParameter, and endSessions ask nothing emu has to answer with
		// more than "yes".
		return s.send(bson.D{mongocmd.Field("ok", 1.0)})
	}
}

// greeting is the handshake. A standalone server: no replica set name, no hosts,
// nothing for a driver to go looking for a primary on — which is also what turns
// retryable writes off, so a lesson's failed insert is one the student sees
// rather than one the driver quietly repeats.
func (s *session) greeting(command mongocmd.Command) bson.D {
	// The field naming the writable server was renamed when `isMaster` became
	// `hello`, and a real server answers with the name that matches the command
	// it was asked. A driver reads only the one it expects.
	writable := "isWritablePrimary"
	if strings.EqualFold(command.Name, "ismaster") {
		writable = "ismaster"
	}

	return bson.D{
		mongocmd.Field(writable, true),
		// helloOk is what tells the driver it may stop using OP_QUERY.
		mongocmd.Field("helloOk", true),
		mongocmd.Field("maxBsonObjectSize", int32(maxBSONObjectSize)),
		mongocmd.Field("maxMessageSizeBytes", int32(maxMessageSizeBytes)),
		mongocmd.Field("maxWriteBatchSize", int32(maxWriteBatchSize)),
		mongocmd.Field("localTime", bson.NewDateTimeFromTime(time.Now())),
		mongocmd.Field("logicalSessionTimeoutMinutes", int32(sessionTimeoutMinutes)),
		mongocmd.Field("connectionId", s.protocol.handshakes.Add(1)),
		mongocmd.Field("minWireVersion", int32(0)),
		mongocmd.Field("maxWireVersion", int32(maxWireVersion)),
		mongocmd.Field("readOnly", false),
		mongocmd.Field("ok", 1.0),
	}
}

func buildInfo() bson.D {
	return bson.D{
		mongocmd.Field("version", serverVersion),
		mongocmd.Field("versionArray", bson.A{int32(8), int32(0), int32(0), int32(0)}),
		mongocmd.Field("gitVersion", "emu"),
		mongocmd.Field("bits", int32(64)),
		mongocmd.Field("ok", 1.0),
	}
}
