# ── Stage 1: build a fully static binary ─────────────────────────────────────
# CGO_ENABLED=0 is the requirement, not an optimisation: the binary is mounted
# into whatever image a lesson runs (alpine/musl today, glibc tomorrow) and must
# not depend on that image's libc.
FROM golang:1.26-alpine AS build

WORKDIR /src

# Split from the source so the dependency layer is cached until go.mod/go.sum
# themselves change.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath -ldflags="-s -w" \
    -o /emu ./cmd/emu

# Fail the build rather than the sandbox if the binary picked up a dynamic link.
RUN ! ldd /emu 2>/dev/null | grep -q . || (echo "emu is dynamically linked" && exit 1)

# ── Stage 2: the shipped artifact ────────────────────────────────────────────
# scratch, because this image is only a vehicle for the binary: P7 copies it into
# a named volume that the lesson container mounts read-only.
FROM scratch

COPY --from=build /emu /emu

ENTRYPOINT ["/emu"]
