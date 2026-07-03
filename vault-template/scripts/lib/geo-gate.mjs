/**
 * geo-gate.mjs — single source of truth for "is this role geo-blocked from
 * auto-staging?"
 *
 * Consumed by BOTH lin-promote-evaluations.mjs (the pipeline gate that skips
 * blocked rows before top-N slicing) and lib/tracker-data.mjs (the dashboard's
 * Prepare guard), so the two can never silently disagree about what counts as
 * blocked. Each consumer formats its own reason text off `cause`:
 *   - the pipeline keeps its terse internal log strings (recorded in queue notes);
 *   - the dashboard uses `displayReason`, a richer human string for the UI confirm.
 *
 * Block policy (mirrors what the scorer encodes):
 *   - geo_gate.blocks_stage === true             → cause "geo"
 *   - canada_eligible == "no" (case-insensitive) → cause "canada"
 *
 * blocks_stage is matched STRICTLY against boolean true (per the queue schema —
 * it is always a real boolean in the data). Strict avoids the truthiness trap
 * where a stray "false"/"0" string would wrongly block.
 */
export function geoGate(src) {
  if (src?.geo_gate?.blocks_stage === true) {
    return {
      blocked: true,
      cause: "geo",
      // geo_gate.reason is a closed enum (visa|remote-only|onsite-only|null); when
      // it's null the row almost always carries a richer canada_eligible_reason.
      displayReason: src.geo_gate.reason || src.canada_eligible_reason || "location-blocked",
    };
  }
  if (String(src?.canada_eligible ?? "").toLowerCase() === "no") {
    return {
      blocked: true,
      cause: "canada",
      displayReason: src.canada_eligible_reason || "not Canada-eligible",
    };
  }
  return { blocked: false, cause: null, displayReason: "" };
}
