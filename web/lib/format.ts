/**
 * Presentation helpers shared across the dashboard UI.
 *
 * These format chain-derived values for display only — they never compute market
 * figures (baselines, payouts). Anything numeric here already came from a decoded
 * event; these functions just render it.
 */

/** CSPR with sensible precision: whole numbers plain, fractions to 4 dp, trimmed. */
export function formatCspr(cspr: number): string {
  if (Number.isInteger(cspr)) return cspr.toString();
  return cspr
    .toFixed(4)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** Watt-hours with a thousands separator, e.g. 2996 → "2,996". */
export function formatWh(wh: number): string {
  return wh.toLocaleString("en-US");
}

/** kWh from Wh, 3 dp, e.g. 1963 → "1.963". */
export function whToKwh(wh: number): string {
  return (wh / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** Basis points as a signed percentage, e.g. -2000 → "−20%". */
export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const magnitude = Math.abs(pct);
  const text = Number.isInteger(magnitude)
    ? magnitude.toString()
    : magnitude.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${sign}${text}%`;
}

/** Middle-truncate a long hex identifier: "3d3d1780…dfb0e36c". */
export function truncateHex(value: string, head = 8, tail = 8): string {
  const bare = value.replace(/^(account-hash-|hash-|0x)/, "");
  if (bare.length <= head + tail + 1) return bare;
  return `${bare.slice(0, head)}…${bare.slice(-tail)}`;
}

/** Short, human label for an account/contract address, keeping its prefix meaning. */
export function shortAddress(addr: string): string {
  return truncateHex(addr, 6, 6);
}

/** ISO timestamp → "23 Jul 2026, 02:53 UTC". */
export function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }) + " UTC"
  );
}
