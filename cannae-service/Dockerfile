# Multi-stage build → a fully static musl binary in a FROM scratch image.
# The static binary is the whole deployment story (see plans/infra-emulators.md):
# a few-MB image with no runtime dependencies, spawnable per test run for free.

# Pinned, and pinned to at least the workspace's `rust-version` (see Cargo.toml):
# `libsqlite3-sys`'s build script needs `cfg_select!`, which 1.93 does not have.
FROM rust:1.96-alpine AS builder
# `gcc` is not optional: the SQL emulator embeds SQLite from source (rusqlite's
# `bundled` feature), so a C compiler targeting musl has to be present. Alpine is
# natively musl, which is why this is an ordinary build here rather than a cross one.
RUN apk add --no-cache musl-dev gcc
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
