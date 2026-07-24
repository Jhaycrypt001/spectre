//! Spectre — a verifiable market for household demand reduction on Casper.
//!
//! See [`market`] for the protocol and its trust model.

#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod baseline;
pub mod market;
pub mod types;

#[cfg(test)]
mod tests;
