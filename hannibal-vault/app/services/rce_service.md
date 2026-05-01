---
name: rce_service.py
description: Sandboxed code execution — runs Python/JS in Docker containers with network isolation, memory/PID limits, and output capping
type: file
layer: business
tags: [service, rce, docker, sandbox]
imports:
  - "[[app/schemas/rce]]"
---

# `app/services/rce_service.py`

Executes arbitrary code inside ephemeral Docker containers. Each run gets a fresh container with no network (`network_mode=none`), a read-only root FS, a `/tmp` tmpfs (64 MB), dropped capabilities, and a `nobody` user. A semaphore caps concurrency at 5; containers are always removed in `finally`.

**Imports:** [[app/schemas/rce]]

**Key constants:**
- `OUTPUT_CAP_BYTES = 256 * 1024` — stdout/stderr are truncated at 256 KB
- `LIMITS` — `time=10s`, `memory=128 MB`, `pid=10`
- `_semaphore = Semaphore(5)` — cap × pids_limit = 50 host PIDs max

---

## `_get_client` — lines 40–53

Returns the cached `DockerClient` (lazy init, double-checked lock via `_client_lock`). On first call, checks each runtime image with `images.get()` and pulls it if `ImageNotFound` — prevents cold-start timeouts.

---

## `_build_result` — lines 56–71

Assembles the result dict returned from `run_code`. Computes `duration_ms` from the `start` float passed in.

---

## `_truncate` — lines 74–77

Converts raw log bytes to str. If output exceeds `OUTPUT_CAP_BYTES`, slices at the cap and appends `\n[output truncated]`.

---

## `run_code` — lines 80–128

Entry point called by [[app/api/v1/controllers/rce_controller#execute_code]].

1. Acquires `_semaphore` non-blocking — raises `ValueError` ("Too many concurrent executions") if full.
2. Writes code into the container via base64 pipe to avoid shell injection.
3. Calls `containers.run(detach=True, ...)` with all sandbox flags.
4. `container.wait(timeout=LIMITS["time"])` blocks up to 10 s.
5. On `ReadTimeout`: calls `container.kill()` immediately (no grace period), then returns a `timed_out=True` result.
6. `finally`: always releases semaphore; calls `container.stop(timeout=0)` then `container.remove()` (failures logged at DEBUG).

**Raises:** `ValueError` (capacity) · propagates `docker.errors.DockerException` (caught as 500 by controller)

**Calls:** `_get_client` · `_truncate` · `_build_result`
