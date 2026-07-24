/**
 * Half-hourly settlement-interval labelling, re-exported from the agent.
 *
 * The dashboard shows dispatch windows as clock times ("17:30–19:30"); the agent
 * derives those from interval indices with `intervalLabel`. Re-exporting the agent's
 * function rather than copying the arithmetic keeps the two from ever disagreeing
 * about what interval 35 means.
 */

export { intervalLabel, INTERVALS_PER_DAY } from "@/lib/agent-vendored/meter-types";
