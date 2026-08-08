package amqp

// A methodID is a class and a method in one value, which is how they are
// switched on and also, in that order, how they go on the wire.
type methodID uint32

// The methods emu speaks. Everything else a client can send is answered with
// "not implemented" rather than ignored, because a broker that silently drops a
// request the client is waiting for hangs the lesson.
const (
	connectionStart   methodID = 10<<16 | 10
	connectionStartOk methodID = 10<<16 | 11
	connectionTune    methodID = 10<<16 | 30
	connectionTuneOk  methodID = 10<<16 | 31
	connectionOpen    methodID = 10<<16 | 40
	connectionOpenOk  methodID = 10<<16 | 41
	connectionClose   methodID = 10<<16 | 50
	connectionCloseOk methodID = 10<<16 | 51

	channelOpen    methodID = 20<<16 | 10
	channelOpenOk  methodID = 20<<16 | 11
	channelClose   methodID = 20<<16 | 40
	channelCloseOk methodID = 20<<16 | 41

	exchangeDeclare   methodID = 40<<16 | 10
	exchangeDeclareOk methodID = 40<<16 | 11

	queueDeclare   methodID = 50<<16 | 10
	queueDeclareOk methodID = 50<<16 | 11
	queueBind      methodID = 50<<16 | 20
	queueBindOk    methodID = 50<<16 | 21
	queuePurge     methodID = 50<<16 | 30
	queuePurgeOk   methodID = 50<<16 | 31
	queueDelete    methodID = 50<<16 | 40
	queueDeleteOk  methodID = 50<<16 | 41

	basicQos       methodID = 60<<16 | 10
	basicQosOk     methodID = 60<<16 | 11
	basicConsume   methodID = 60<<16 | 20
	basicConsumeOk methodID = 60<<16 | 21
	basicCancel    methodID = 60<<16 | 30
	basicCancelOk  methodID = 60<<16 | 31
	basicPublish   methodID = 60<<16 | 40
	basicReturn    methodID = 60<<16 | 50
	basicDeliver   methodID = 60<<16 | 60
	basicGet       methodID = 60<<16 | 70
	basicGetOk     methodID = 60<<16 | 71
	basicGetEmpty  methodID = 60<<16 | 72
	basicAck       methodID = 60<<16 | 80
	basicReject    methodID = 60<<16 | 90
	basicNack      methodID = 60<<16 | 120

	confirmSelect   methodID = 85<<16 | 10
	confirmSelectOk methodID = 85<<16 | 11
)

// noReply is what an asynchronous method is answered with: nothing. A publish,
// an acknowledgement, and a rejection all come back empty-handed by design,
// which is exactly why a lesson that wants to see a failed publish has to turn
// publisher confirms on.
const noReply methodID = 0

// noMethod is what a Close names when nothing the client sent was at fault —
// a frame emu could not parse at all, rather than a request it could not carry
// out.
const noMethod methodID = 0

// basicClass is the class a content header belongs to. AMQP allows others in
// principle and has never defined one.
const basicClass uint16 = 60

func (m methodID) class() uint16  { return uint16(m >> 16) }
func (m methodID) method() uint16 { return uint16(m) }

// encode starts a method frame's payload with the method it is. The caller
// appends that method's arguments in the order the specification lists them.
func encode(id methodID) *writer {
	out := &writer{}
	out.short(id.class())
	out.short(id.method())
	return out
}

// decode splits a method frame into the method it is and the reader its
// arguments come off.
func decode(payload []byte) (methodID, *reader) {
	in := &reader{data: payload}
	class := in.short()
	method := in.short()
	return methodID(class)<<16 | methodID(method), in
}
