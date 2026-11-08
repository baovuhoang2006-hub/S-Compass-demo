import { checkedPredict, type ModelFault } from "./model";
import { modelInputFor } from "./planner";
import { shiftById } from "./data";
import { blockInfo } from "./time";
import { cardsFor, type DemoState } from "./demoState";
import type { Block, FixtureStop, Plan } from "./types";

export type RiskKind = "overload" | "ai" | "data";
export type DataFault = "missing_pin" | "duplicate_id" | "negative_service" | "invalid_window" | "conflicting_card";
export type AiFault = ModelFault | "hard_conflict";

export interface RiskResult {
  incidentId: string;
  kind: RiskKind;
  status: "safe" | "review" | "timeout";
  input: string;
  detection: string;
  explanation: string;
  safeAction: string;
  result: string;
  warning: string;
  fallback: string;
}

function incident(kind: RiskKind, fingerprint: string) {
  let hash = 2166136261;
  for (const c of fingerprint) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `RISK-${kind.toUpperCase()}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function overloadRisk(workload: number, capacity: number, timeoutMs: number, lastPlan: Plan | null): RiskResult {
  const count = Number.isFinite(workload) ? Math.max(0, Math.floor(workload)) : 0;
  const limit = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
  const budget = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 1;
  // Explicit fault-injection estimate, not a benchmark or production throughput claim.
  const simulatedMs = count * 10;
  const timedOut = simulatedMs > budget;
  const excessive = count > limit;
  const status = timedOut ? "timeout" : excessive ? "review" : "safe";
  return {
    incidentId: incident("overload", `${count}:${limit}:${budget}`), kind: "overload", status,
    input: `${count} simulated parcels; demo capacity ${limit}; demo time budget ${budget} ms`,
    detection: timedOut ? `Simulated work ${simulatedMs} ms exceeds demo time budget.` : excessive ? `${count} parcels exceed configured demo capacity ${limit}.` : `Within configured demo limits (${simulatedMs} ms).`,
    explanation: "This is deterministic stress injection; it is not measured production performance.",
    safeAction: status === "safe" ? "Operator may retry normal planning." : "Keep the last valid plan and ask the dispatcher to reduce scope or retry. No partial dispatch.",
    result: lastPlan ? `Last dispatched plan ${lastPlan.id} remains in place with ${lastPlan.stops.length} stops.` : "No dispatched plan was changed. All source parcels remain in the queue.",
    warning: status === "safe" ? "No overload detected in this fixture." : "Processing stopped safely; no success response was fabricated.",
    fallback: status === "safe" ? "Normal Rules planning available" : "Last valid plan / dispatcher review",
  };
}

export function aiRisk(state: DemoState, fault: AiFault, block: Block): RiskResult {
  const shift = shiftById(state.shiftId);
  const stop = shift.stops.find((s) => state.stopStates[shift.id][s.id]?.status === "pending") ?? shift.stops[0];
  const card = cardsFor(state)[stop.locationKey];
  const input = modelInputFor(stop, shift, card, block);
  const check = checkedPredict(input, fault === "hard_conflict" ? "none" : fault);
  const injectedConfirmedBlock: Block | null = fault === "hard_conflict" ? (block === "morning" ? "evening" : "morning") : null;
  const buyer = state.stopStates[shift.id][stop.id].buyer;
  const conflict = (injectedConfirmedBlock !== null && injectedConfirmedBlock !== block) ||
    ((buyer.kind === "confirmed" || buyer.kind === "changed") && buyer.block !== block) ||
    card.restrictions.some((r) => r.strength === "hard" && (
      (r.blocks !== undefined && !r.blocks.includes(block)) ||
      (r.weekdaysOnly === true && shift.isWeekend) ||
      (r.earliestMin !== undefined && blockInfo(block).end <= r.earliestMin) ||
      (r.latestMin !== undefined && blockInfo(block).start > r.latestMin)
    ));
  const rejected = check.p === null || conflict;
  return {
    incidentId: incident("ai", `${shift.id}:${stop.id}:${fault}:${block}`), kind: "ai", status: rejected ? "review" : "safe",
    input: `Real logistic-regression input for ${stop.id}: ${JSON.stringify(input)}. Fault injection: ${fault}${injectedConfirmedBlock ? `; isolated buyer-confirmed block=${injectedConfirmedBlock}` : ""}.`,
    detection: check.p === null ? check.reason! : conflict ? `Predicted ${check.p.toFixed(3)}, but ${block} conflicts with a buyer-confirmed or verified hard window (injected when selected).` : `Valid inference p_success=${check.p.toFixed(3)} for ${block}.`,
    explanation: "The trained model estimates success; operational hard rules and buyer commitments still govern scheduling. A probability is not a confidence guarantee.",
    safeAction: rejected ? "Reject the model suggestion. Operator can create a Rules draft for review; do not auto-dispatch." : "Operator may compare the Model and Rules drafts before dispatch.",
    result: rejected ? "Current dispatched plan and completed stops remain unchanged." : "Valid prediction displayed; no plan was dispatched by this test.",
    warning: rejected ? "AI output rejected or requires dispatcher verification." : "Experimental model; not proven better than the history table.",
    fallback: rejected ? "Rules Planner / dispatcher review" : "No fallback needed",
  };
}

export function dataRisk(state: DemoState, fault: DataFault, orderId: string): RiskResult {
  const shift = shiftById(state.shiftId);
  const stop = shift.stops.find((s) => s.id === orderId) ?? shift.stops[0];
  const card = cardsFor(state)[stop.locationKey];
  const injected: FixtureStop = { ...stop, pin: fault === "missing_pin" ? null : stop.pin, serviceMinutes: fault === "negative_service" ? -5 : stop.serviceMinutes };
  const ids = [...shift.stops.map((s) => s.id), ...(fault === "duplicate_id" ? [stop.id] : [])];
  const window = fault === "invalid_window" ? "overnight" : "morning";
  const verifiedWindows: Block[][] = fault === "conflicting_card" ? [["morning"], ["evening"]] : [];
  const issues: string[] = [];
  if (!injected.pin || !injected.pin.every(Number.isFinite)) issues.push("missing or invalid map pin");
  if (ids.length !== new Set(ids).size) issues.push("duplicate order/attempt ID");
  if (injected.serviceMinutes !== null && (!Number.isFinite(injected.serviceMinutes) || injected.serviceMinutes < 0)) issues.push("invalid processing time");
  if (!["morning", "afternoon", "evening"].includes(window)) issues.push("invalid receiving window");
  if (verifiedWindows.length > 1 && !verifiedWindows[0].some((b) => verifiedWindows[1].includes(b))) issues.push("conflicting verified Stop Card windows");
  let detection: string;
  let action: string;
  let fallback: string;
  if (fault === "missing_pin") {
    detection = `${stop.id}: ${issues.join(", ")}.`;
    const verified = card.status === "verified" && card.entrancePoint !== null;
    action = verified ? "Use the verified entrance point; flag the original pin for review." : "Quarantine location assignment; dispatcher must verify the entrance or contact the buyer.";
    fallback = verified ? "Verified entrance" : "Dispatcher location review";
  } else if (fault === "duplicate_id") {
    detection = `Attempt/order ID ${stop.id}: ${issues.join(", ")}.`;
    action = "Quarantine the duplicate; keep the previously accepted copy and request ID review.";
    fallback = "Original accepted record retained";
  } else if (fault === "negative_service") {
    detection = `${stop.id}: processing time ${injected.serviceMinutes} min; ${issues.join(", ")}.`;
    action = "Quarantine the invalid record; dispatcher must correct or approve a documented fallback.";
    fallback = "Dispatcher data review";
  } else if (fault === "invalid_window") {
    detection = `${stop.id}: receiving window '${window}'; ${issues.join(", ")}.`;
    action = "Quarantine the invalid window and request buyer/dispatcher verification. Do not change a confirmed window.";
    fallback = "Buyer/dispatcher window review";
  } else {
    detection = `${card.name}: ${issues.join(", ")} (morning-only versus evening-only).`;
    action = "Quarantine both conflicting edits; preserve the current card and request dispatcher review.";
    fallback = "Existing verified card retained";
  }
  return {
    incidentId: incident("data", `${shift.id}:${stop.id}:${fault}`), kind: "data", status: "review",
    input: `Isolated ${fault} fixture for ${stop.id}: ${JSON.stringify({ pin: injected.pin, serviceMinutes: injected.serviceMinutes, idCount: ids.filter((id) => id === stop.id).length, window, verifiedWindows })}. ${shift.stops.length} source parcels remain.`,
    detection, explanation: "Validation runs on an isolated copy; no fixture is silently removed or applied to the live demo state.",
    safeAction: action,
    result: `Current shift still has ${shift.stops.length} source parcels; dispatched plan, completed stops and buyer windows were not changed.`,
    warning: "Data incident requires verification before this record can enter a new plan.", fallback,
  };
}
