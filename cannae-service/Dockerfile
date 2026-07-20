# Multi-stage build → a fully static musl binary in a FROM scratch image.
# The static binary is the whole deployment story (see plans/infra-emulators.md):
# a few-MB image with no runtime dependencies, spawnable per test run for free.

FROM rust:1.93-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY . .
# rust:alpine already targets musl, but be explicit so the output path is stable.
RUN rustup target add x86_64-unknown-linux-musl \
 && cargo build --release --target x86_64-unknown-linux-musl -p cannae

# Nothing but the binary. If it weren't fully static, it wouldn't run here at all.
FROM scratch
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/cannae /cannae
EXPOSE 9900
ENTRYPOINT ["/cannae"]
CMD ["--infra", "echo"]
