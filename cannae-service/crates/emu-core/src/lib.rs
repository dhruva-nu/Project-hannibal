//! `emu-core` — the shared kit every protocol emulator sits on (Phase 0, issue #132).
//!
//! It owns the four generic pieces: the connection front (`server`), the operation
//! log (`oplog`), the fault engine (`faults`), and the control plane (`control`).
//! A protocol plugs in by implementing [`Emulator`]; the kit never re-touches how a
//! fault travels from the control plane to the student's socket.
//!
//! See `plans/infra-emulators.md` §1 for the architecture this crate implements.

mod control;
mod emulator;
mod faults;
mod oplog;
mod server;

pub use emulator::{ConnState, Emulator, Op, Reader};
pub use faults::{ConnScope, FaultEngine, FaultHit, FaultRule};
pub use oplog::{OpLog, OpRecord};
pub use server::{Emu, Shared};
