/**
 * Off-chain reconstruction of the baseline commitment hash.
 *
 * The agent must commit a hash *before* it knows the dispatch terms, then reveal
 * the underlying data at settlement. If this function disagrees with the contract
 * by a single byte, `settle` reverts with `BaselineMismatch` after the gas for a
 * commit, a pledge, and a settle has already been spent — and the household is not
 * paid. It is therefore checked against the contract's own `compute_commitment`
 * view before any commitment is submitted (see `scripts/dispatch.ts`).
 *
 * Mirrors `SpectreMarket::baseline_hash` in
 * `contracts/spectre-market/src/market.rs`:
 *
 *   blake2b256(
 *     "spectre:baseline:v1"
 *     ++ u32le(len(window))   ++ u64le(w) for w in window
 *     ++ "|"
 *     ++ u32le(len(adj))      ++ u64le(a) for a in adj
 *   )
 *
 * The length prefixes and the separator are what stop values being shuffled
 * between the two series to forge a matching digest.
 */

// The SDK's own blake2b-256, i.e. the same function the node computes `env.hash`
// with. Note that blake2b binds its digest length into the initialisation vector,
// so truncating Node's built-in `blake2b512` would *not* produce the same value.
import sdk from "casper-js-sdk";
const { byteHash } = sdk;

/** Domain separator. Changing this is a breaking change to the commitment scheme. */
export const DOMAIN = "spectre:baseline:v1";

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/**
 * Compute the commitment for a revealed baseline.
 *
 * @param historyWindowWh    per-day totals across the dispatch window intervals
 * @param historyAdjWindowWh per-day totals across the pre-event observation window
 */
export function computeCommitment(
  historyWindowWh: readonly bigint[],
  historyAdjWindowWh: readonly bigint[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

  parts.push(ascii(DOMAIN));

  parts.push(u32le(historyWindowWh.length));
  for (const value of historyWindowWh) parts.push(u64le(value));

  parts.push(ascii("|"));

  parts.push(u32le(historyAdjWindowWh.length));
  for (const value of historyAdjWindowWh) parts.push(u64le(value));

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const preimage = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    preimage.set(part, offset);
    offset += part.length;
  }

  return byteHash(preimage);
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
