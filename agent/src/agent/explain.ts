/**
 * Natural-language explanation of a dispatch plan.
 *
 * # The deterministic/LLM split, made concrete
 *
 * The *decision* — whether to curtail, which intervals, how much to pledge — is
 * made by `planDispatch`, in integer arithmetic over live prices and a thermal
 * constraint. That is the part that spends money and forfeits payments on error, so
 * it is deterministic and auditable, never a sampled token stream.
 *
 * What a language model is good at, and what this module uses it for, is turning the
 * plan's structured reasoning into a sentence a householder would actually read. The
 * model is given the numbers the planner already computed and asked only to phrase
 * them. It is not asked to decide anything, and nothing it returns feeds back into a
 * transaction.
 *
 * # Why the fallback is not optional
 *
 * An autonomous agent cannot be hostage to an external API being reachable. If no
 * API key is configured, or the call fails, or it times out, `explainPlan` returns
 * the planner's own deterministic `rationale` joined into prose. The explanation is
 * therefore *always* available; the LLM only ever improves its readability, never
 * gates it. That is what makes the AI layer safe to depend on.
 */

import type { DispatchPlan } from "./planner.js";

/** Model used for the explanation. Small and fast: this is a phrasing task. */
const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 320;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface ExplainResult {
  /** The explanation, one short paragraph. */
  readonly text: string;
  /** How it was produced — the model, or the deterministic fallback. */
  readonly source: "llm" | "fallback";
  /** Present when the LLM path was attempted but did not produce the text. */
  readonly fallbackReason?: string;
}

/**
 * Deterministic explanation: the planner's own rationale as a paragraph.
 *
 * This is the floor. It is always correct because the planner produced it, and it is
 * what the LLM path degrades to. Kept as its own export so callers (and tests) can
 * assert the fallback independently of any network.
 */
export function deterministicExplanation(plan: DispatchPlan): string {
  if (!plan.shouldDispatch) {
    return (
      plan.rationale.join(" ") ||
      "The agent evaluated current prices and decided not to curtail load."
    );
  }
  return plan.rationale.join(" ");
}

/**
 * The instruction given to the model. It is deliberately narrow: rephrase, do not
 * re-decide, do not introduce numbers that are not in the plan.
 */
function buildPrompt(plan: DispatchPlan): string {
  const facts = {
    decision: plan.shouldDispatch ? "curtail" : "do not curtail",
    intervals: plan.intervals,
    pledgeWh: plan.pledgeWh,
    expectedEarningsGBP: Number((plan.expectedPence / 100).toFixed(2)),
    carbonAvoidedKg: Number((plan.expectedGramsCo2 / 1000).toFixed(2)),
    meanPricePencePerKwh: Number(plan.meanPencePerKwh.toFixed(2)),
    projectedTankLowC: Number(plan.projectedTankLowC.toFixed(1)),
    rationale: plan.rationale,
  };

  return (
    "You explain a home energy agent's decision to its owner. The decision has " +
    "already been made by a deterministic planner; your only job is to phrase it " +
    "clearly. Write ONE short paragraph (max ~60 words), plain English, no markdown, " +
    "no bullet points. Do not invent any number that is not in the data below; do " +
    "not second-guess the decision. Speak to the homeowner in the second person.\n\n" +
    "Decision data (JSON):\n" +
    JSON.stringify(facts, null, 2)
  );
}

/**
 * Explain a plan in natural language, preferring the LLM and falling back to the
 * planner's deterministic rationale.
 *
 * Never throws: a failure of the model path is reported via `source`/`fallbackReason`
 * and the deterministic text is returned instead. The API key is read from
 * ANTHROPIC_API_KEY; if it is absent the LLM path is skipped entirely.
 */
export async function explainPlan(
  plan: DispatchPlan,
  options: { apiKey?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ExplainResult> {
  const fallback = deterministicExplanation(plan);
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      text: fallback,
      source: "fallback",
      fallbackReason: "ANTHROPIC_API_KEY not set; using deterministic rationale.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: buildPrompt(plan) }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        text: fallback,
        source: "fallback",
        fallbackReason: `Anthropic API returned ${response.status} ${response.statusText}.`,
      };
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (!text) {
      return {
        text: fallback,
        source: "fallback",
        fallbackReason: "Anthropic API returned no text content.",
      };
    }

    return { text, source: "llm" };
  } catch (error) {
    return {
      text: fallback,
      source: "fallback",
      fallbackReason:
        error instanceof Error && error.name === "AbortError"
          ? "Anthropic API call timed out."
          : `Anthropic API call failed: ${error instanceof Error ? error.message : error}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
