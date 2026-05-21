FROM rust:1.93-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM alpine:3.21
COPY --from=builder /app/target/release/dsl-service /usr/local/bin/dsl-service
EXPOSE 9000
CMD ["dsl-service"]
