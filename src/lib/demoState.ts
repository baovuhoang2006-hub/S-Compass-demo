import { BACKUP_RIDER, allPickupPoints, fixtures, riderById, riderOfShift, shiftById } from "./data";
import type { EvidenceEvent, Role } from "./evidence";
import { applyCorrection, buildCard, knowledgeSnapshot, reviewValue, RESTRICTION_PRESETS, type CardOverlay, type Correction, type CorrectionField, type OutcomeRecord } from "./knowledge";
import { makePlan } from "./planner";
import { compareRemaining, type ReplanProposal, type ReplanTrigger } from "./replan";
import { SHIFT_START, blockInfo, blockLabel, fmt } from "./time";
import type { Block, ComparisonMetadata, Plan, PlanMethod, PlannedStop, Point, StopCard, StopState, WindowRestriction } from "./types";

export interface BuyerMessage {
  id: string;
  stopId: string;
  from: "S-Compass" | "Buyer";
  text: string;
  at: string;
}

export interface Transfer {
  stopId: string;
  shiftId: string;
  to: string;
  note: string;
  at: string;
}

export interface DemoState {
  version: 3;
  sessionId: string;
  shiftId: string;
  method: PlanMethod;
  role: Role;
  tester: { name: string; persona: string };
  overlays: Record<string, CardOverlay>;
  corrections: Correction[];
  outcomes: OutcomeRecord[];
  stopStates: Record<string, Record<string, StopState>>;
  draftPlan: Plan | null;
  comparison: Plan[] | null;
  comparisonMeta: ComparisonMetadata | null;
  currentPlan: Record<string, Plan | null>;
  clockMin: Record<string, number>;
  proposals: ReplanProposal[];
  transfers: Transfer[];
  messages: BuyerMessage[];
  events: EvidenceEvent[];
}

/** Label of the rider who owns a shift, e.g. "Rider A · Minh". */
export function riderLabel(shiftId: string) {
  return riderOfShift(shiftById(shiftId)).label;
}

let counter = 0;
export function uid(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function initialStopStates(): DemoState["stopStates"] {
  const out: DemoState["stopStates"] = {};
  for (const s of fixtures.shifts) {
    out[s.id] = Object.fromEntries(s.stops.map((x) => [x.id, { status: "pending", buyer: { kind: "none" } } as StopState]));
  }
  return out;
}

export function initialState(): DemoState {
  return {
    version: 3,
    sessionId: uid("session"),
    shiftId: fixtures.shifts[0].id,
    method: "rules",
    role: "dispatcher",
    tester: { name: "", persona: "Presenter (team member)" },
    // One card is pre-verified as a labelled demo fixture so every status can be shown.
    overlays: {
      "loc-07": {
        status: "verified",
        lastVerified: "2026-10-08",
        verifiedBy: "Hoa (veteran rider, demo fixture)",
        source: "Demo fixture — not from the dataset",
        handover: "Hand over at the security desk; the guard calls the clinic office",
      },
    },
    corrections: [],
    outcomes: [],
    stopStates: initialStopStates(),
    draftPlan: null,
    comparison: null,
    comparisonMeta: null,
    currentPlan: Object.fromEntries(fixtures.shifts.map((s) => [s.id, null])),
    clockMin: Object.fromEntries(fixtures.shifts.map((s) => [s.id, SHIFT_START])),
    proposals: [],
    transfers: [],
    messages: [],
    events: [],
  };
}

// ------------------------------------------------------------------ helpers
export function cardsFor(state: DemoState): Record<string, StopCard> {
  return Object.fromEntries(
    fixtures.knowledge.map((k) => [k.key, buildCard(k.key, state.overlays[k.key], state.outcomes)]),
  );
}

export function log(state: DemoState, e: Omit<EvidenceEvent, "id" | "at" | "sessionId" | "tester" | "persona" | "role"> & { role?: Role }): DemoState {
  const ev: EvidenceEvent = {
    id: uid("ev"),
    at: new Date().toISOString(),
    sessionId: state.sessionId,
    tester: state.tester.name || "(not set)",
    persona: state.tester.persona,
    role: e.role ?? state.role,
    type: e.type,
    summary: e.summary,
    input: e.input,
    output: e.output,
    computeMs: e.computeMs,
  };
  return { ...state, events: [...state.events, ev] };
}

function current(state: DemoState) {
  return state.currentPlan[state.shiftId];
}

/** Where the rider is now: last completed stop of the dispatched plan, else the hub. */
export function riderPosition(state: DemoState): { point: Point; min: number } {
  const plan = current(state);
  const states = state.stopStates[state.shiftId];
  let point: Point = riderOfShift(shiftById(state.shiftId)).hub.pos;
  if (plan) {
    for (const s of plan.stops) {
      const st = states[s.stopId];
      if (st && (st.status === "delivered" || st.status === "failed") && s.point) point = s.point;
    }
  }
  return { point, min: state.clockMin[state.shiftId] };
}

export function planFor(state: DemoState, method: PlanMethod): Plan {
  const shift = shiftById(state.shiftId);
  const pos = riderPosition(state);
  const started = !!current(state);
  return makePlan({
    shift,
    method,
    cards: cardsFor(state),
    stopStates: state.stopStates[state.shiftId],
    startMin: started ? pos.min : SHIFT_START,
    startPoint: started ? pos.point : riderOfShift(shift).hub.pos,
    previous: current(state),
    sessionOutcomes: state.outcomes,
  });
}

/** Stable identifier for the inputs used by a KPI comparison, excluding draft plans and event-log noise. */
export function comparisonRunIdFor(state: DemoState): string {
  const shift = shiftById(state.shiftId);
  const snapshot = JSON.stringify({
    shiftId: shift.id,
    date: shift.date,
    stops: shift.stops,
    stopStates: state.stopStates[state.shiftId],
    cards: cardsFor(state),
    outcomes: state.outcomes,
    start: riderPosition(state),
  });
  let hash = 2166136261;
  for (let i = 0; i < snapshot.length; i++) hash = Math.imul(hash ^ snapshot.charCodeAt(i), 16777619);
  const fingerprint = (hash >>> 0).toString(16).padStart(8, "0");
  return `compare-${shift.id}-${fingerprint}`;
}

function describePlan(p: Plan) {
  return `${p.totals.stops} stops · expected ${p.totals.expectedSuccess.toFixed(1)} successful first attempts (of ${p.totals.estimatedStops} estimated) · ${p.totals.distanceKm.toFixed(1)} km · ends ${fmt(p.totals.endMin)} · ${p.totals.flagged} flagged`;
}

// ------------------------------------------------------------------ actions
export function selectRider(state: DemoState, riderId: string): DemoState {
  return selectShift(state, riderById(riderId).shiftIds[0]);
}

export function ensureShiftState(state: DemoState, shiftId: string): DemoState {
  const shift = shiftById(shiftId);
  const existing = state.stopStates[shiftId] ?? {};
  const validIds = new Set(shift.stops.map((stop) => stop.id));
  const stopStates = Object.fromEntries(shift.stops.map((stop) => [
    stop.id,
    existing[stop.id] ?? { status: "pending", buyer: { kind: "none" } } as StopState,
  ]));
  const needsStopStateRepair = Object.keys(existing).length !== shift.stops.length || shift.stops.some((stop) => !existing[stop.id]) || Object.keys(existing).some((id) => !validIds.has(id));
  if (!needsStopStateRepair && shiftId in state.currentPlan && shiftId in state.clockMin) return state;
  return { ...state,
    stopStates: { ...state.stopStates, [shiftId]: stopStates },
    currentPlan: { ...state.currentPlan, [shiftId]: state.currentPlan[shiftId] ?? null },
    clockMin: { ...state.clockMin, [shiftId]: state.clockMin[shiftId] ?? SHIFT_START },
  };
}

export function selectShift(state: DemoState, shiftId: string): DemoState {
  const s = { ...ensureShiftState(state, shiftId), shiftId, draftPlan: null, comparison: null, comparisonMeta: null };
  return log(s, { type: "shift_selected", summary: `Selected ${riderLabel(shiftId)}, ${shiftById(shiftId).weekday} ${shiftById(shiftId).date} shift` });
}

export function recordImport(state: DemoState, summary: string, details: string): DemoState {
  return log(state, { type: "data_imported", role: "dispatcher", summary, input: details });
}
export function recordImportRemoved(state: DemoState): DemoState {
  const fallbackShift = fixtures.shifts.find((s) => !s.id.startsWith("imp-"))?.id ?? fixtures.shifts[0].id;
  const back = {
    ...state,
    shiftId: state.shiftId.startsWith("imp-") ? fallbackShift : state.shiftId,
    stopStates: Object.fromEntries(Object.entries(state.stopStates).filter(([id]) => !id.startsWith("imp-"))),
    currentPlan: Object.fromEntries(Object.entries(state.currentPlan).filter(([id]) => !id.startsWith("imp-"))),
    clockMin: Object.fromEntries(Object.entries(state.clockMin).filter(([id]) => !id.startsWith("imp-"))),
    draftPlan: state.draftPlan?.shiftId.startsWith("imp-") ? null : state.draftPlan,
    comparison: state.comparison?.some((plan) => plan.shiftId.startsWith("imp-")) ? null : state.comparison,
    comparisonMeta: state.comparisonMeta?.scenarioId.startsWith("imp-") ? null : state.comparisonMeta,
  };
  return log(back, { type: "data_import_removed", role: "dispatcher", summary: "Imported data removed; demo fixtures kept" });
}

export function generatePlan(state: DemoState, method: PlanMethod): DemoState {
  const plan = planFor(state, method);
  const s = { ...state, method, draftPlan: plan };
  return log(s, {
    type: "plan_generated",
    role: "dispatcher",
    summary: `Generated ${method} plan`,
    input: `${plan.totals.stops} pending stops, start ${fmt(plan.startMin)}`,
    output: describePlan(plan),
    computeMs: plan.computeMs,
  });
}

export function comparePlans(state: DemoState): DemoState {
  const plans = (["baseline", "rules", "model"] as PlanMethod[]).map((m) => planFor(state, m));
  const commonEligibleIds = new Set(plans[0].stops.filter((s) => !s.fixed && s.p !== null).map((s) => s.stopId));
  for (const plan of plans.slice(1)) {
    const eligible = new Set(plan.stops.filter((s) => !s.fixed && s.p !== null).map((s) => s.stopId));
    for (const id of commonEligibleIds) if (!eligible.has(id)) commonEligibleIds.delete(id);
  }
  for (const plan of plans) {
    const comparable = plan.stops.filter((s) => !s.fixed && commonEligibleIds.has(s.stopId));
    plan.totals.expectedSuccess = comparable.reduce((sum, stop) => sum + (stop.p ?? 0), 0);
    plan.totals.estimatedStops = comparable.length;
    plan.totals.modelExpectedSuccess = plan.method === "model"
      ? comparable.reduce((sum, stop) => sum + (stop.pModel ?? 0), 0)
      : null;
    plan.totals.modelEstimatedStops = plan.method === "model"
      ? comparable.filter((stop) => stop.pModel !== null).length
      : 0;
  }
  const shift = shiftById(state.shiftId);
  const eligibleEstimatedStops = commonEligibleIds.size;
  const comparisonMeta: ComparisonMetadata = {
    scenarioId: `${shift.id}:${shift.date}`,
    runId: comparisonRunIdFor(state),
    createdAt: new Date().toISOString(),
    dataset: shift.id.startsWith("imp-")
      ? "User-imported browser-only batch (validated; imported orders only)"
      : "Bundled de-identified demo fixtures (baseline f16db9c)",
    planner: "src/lib/planner.ts (rules and model weights unchanged from baseline f16db9c)",
    methods: ["baseline", "rules", "model"],
    totalStops: plans[0].totals.stops,
    eligibleEstimatedStops,
    timeDenominator: "Total pending stops in this scenario; scheduled stop count is shown per method.",
    successMetric: "Common history-table expected first attempts on the same eligible stop IDs; Model prediction is reported separately on that same set.",
  };
  const s = { ...state, comparison: plans, comparisonMeta };
  return log(s, {
    type: "plans_compared",
    role: "dispatcher",
    summary: "Compared baseline, rules and model plans",
    output: plans.map((p) => `${p.method}: ${p.totals.expectedSuccess.toFixed(1)} expected, ${p.totals.distanceKm.toFixed(1)} km`).join(" | "),
    computeMs: plans.reduce((a, p) => a + p.computeMs, 0),
  });
}

export function dispatchPlan(state: DemoState, plan: Plan): DemoState {
  const s: DemoState = {
    ...state,
    currentPlan: { ...state.currentPlan, [state.shiftId]: plan },
    draftPlan: null,
    proposals: state.proposals.map((p) => (p.status === "open" && p.previous.shiftId === state.shiftId ? { ...p, status: "overridden" as const, decisionNote: "Superseded by a newly dispatched plan" } : p)),
  };
  return log(s, { type: "plan_dispatched", role: "dispatcher", summary: `Dispatched ${plan.method} plan to ${riderLabel(state.shiftId)}`, output: describePlan(plan) });
}

export function openCard(state: DemoState, key: string, from: string): DemoState {
  return log(state, { type: "stop_card_opened", summary: `Opened stop card ${cardsFor(state)[key].name}`, input: from });
}

/** Upgrade legacy browser confirmation flags without inventing missing evidence. */
export function restoreKnowledgeReviews(state: DemoState): DemoState {
  let next = state;
  for (const [key, overlay] of Object.entries(state.overlays)) {
    if (!overlay.verificationRequested || !cardsFor(state)[key]) continue;
    if (next.corrections.some((c) => c.locationKey === key && c.field === "confirmation" && c.status === "pending")) continue;
    next = { ...next, corrections: [...next.corrections, {
      id: `legacy-confirmation-${key}`, locationKey: key, field: "confirmation",
      text: "Legacy on-site confirmation flag; original submission details were not recorded",
      proposedBy: "Not recorded (legacy demo)", createdAt: "", status: "pending",
      snapshot: knowledgeSnapshot(cardsFor(state)[key]),
      provenance: "Restored browser flag; no timestamp or actor inferred. Not a real field inspection.",
    }] };
  }
  return next;
}

function submitKnowledgeRequest(state: DemoState, key: string, field: Correction["field"], text: string, restrictionCode?: WindowRestriction["code"]): DemoState {
  const card = cardsFor(state)[key];
  if (!card || !["dispatcher", "rider"].includes(state.role) || !text.trim()) return state;
  if ((field === "confirmation" || field === "dispute") && state.role !== "rider") return state;
  if (field === "confirmation" && state.corrections.some((c) => c.locationKey === key && c.field === field && c.status === "pending")) return state;
  const c: Correction = {
    id: uid("review"), locationKey: key, field, text: text.trim(), restrictionCode,
    proposedBy: state.role === "rider" ? riderLabel(state.shiftId) : "Dispatcher",
    createdAt: new Date().toISOString(), status: "pending",
    snapshot: knowledgeSnapshot(card), previousValue: reviewValue(card, field),
    provenance: `Browser demo ${state.role} report · session ${state.sessionId}; not independently field-verified`,
  };
  return log({ ...state, corrections: [...state.corrections, c] }, {
    type: field === "confirmation" ? "verification_requested" : field === "dispute" ? "dispute_reported" : "correction_suggested",
    summary: `${field === "confirmation" ? "On-site confirmation" : field === "dispute" ? "Dispute report" : "Correction"} for ${card.name}`,
    input: JSON.stringify(c), output: "Pending dispatcher review; official knowledge and dispatched plans unchanged",
  });
}

export function suggestCorrection(state: DemoState, key: string, field: CorrectionField, text: string, restrictionCode?: WindowRestriction["code"]): DemoState {
  if (!["entrance", "handover", "access", "receiving_window"].includes(field)) return state;
  if (field === "receiving_window" && !RESTRICTION_PRESETS.some((p) => p.code === restrictionCode && p.text === text.trim())) return state;
  return submitKnowledgeRequest(state, key, field, text, restrictionCode);
}

/** A stale report must be re-submitted; an unresolved dispute must be reviewed first. */
export function knowledgeReviewBlocker(state: DemoState, c: Correction): string | null {
  const card = cardsFor(state)[c.locationKey];
  if (!card) return "Site no longer available. Reject this request and review the source.";
  if (!c.text.trim() || !["entrance", "handover", "access", "receiving_window", "confirmation", "dispute"].includes(c.field)) return "Invalid request content. Reject and request a new observation.";
  if (c.field === "receiving_window" && !RESTRICTION_PRESETS.some((p) => p.code === c.restrictionCode && p.text === c.text.trim())) return "Receiving rule does not match a supported preset. Reject and resubmit.";
  if (c.field !== "dispute" && state.corrections.some((x) => x.locationKey === c.locationKey && x.field === "dispute" && x.status === "pending")) return "Review the pending dispute before approving other knowledge.";
  if (c.snapshot && c.snapshot !== knowledgeSnapshot(card)) return "Site knowledge changed after submission. Reject and request a new observation.";
  return null;
}

export function decideCorrection(state: DemoState, id: string, approve: boolean, note?: string): DemoState {
  const c = state.corrections.find((x) => x.id === id);
  if (state.role !== "dispatcher" || !c || c.status !== "pending") return state;
  if (approve && knowledgeReviewBlocker(state, c)) return state;
  const at = new Date().toISOString();
  const corrections = state.corrections.map((x) => x.id === id ? { ...x, status: approve ? "approved" as const : "rejected" as const, decidedAt: at, decidedBy: "Dispatcher", note } : x);
  let overlay = state.overlays[c.locationKey];
  if (approve) {
    if (c.field === "dispute") overlay = { ...overlay, status: "disputed", disputeReason: c.text };
    else if (c.field === "confirmation") overlay = { ...overlay, status: "verified", datasetRulesVerified: true, lastVerified: at, verifiedBy: "Dispatcher (demo review)", verificationRequested: false, disputeReason: undefined,
      source: `Browser demo confirmation from ${c.proposedBy}, approved by Dispatcher; not a real field inspection` };
    else overlay = applyCorrection(overlay, c, at, "Dispatcher (demo review)");
  }
  // Retire a migrated legacy flag on either decision; never recreate rejected requests.
  if (c.field === "confirmation" && overlay?.verificationRequested) overlay = { ...overlay, verificationRequested: false };
  const overlays = overlay === state.overlays[c.locationKey] ? state.overlays : { ...state.overlays, [c.locationKey]: overlay ?? {} };
  const type = c.field === "confirmation" ? (approve ? "card_verified" : "verification_rejected") : c.field === "dispute" ? (approve ? "card_disputed" : "dispute_rejected") : (approve ? "correction_approved" : "correction_rejected");
  return log({ ...state, corrections, overlays }, {
    type, summary: `${approve ? "Approved" : "Rejected"} ${c.field} request for ${cardsFor(state)[c.locationKey]?.name ?? c.locationKey}`,
    input: JSON.stringify({ request: c, decision: approve ? "approved" : "rejected", decidedAt: at, note }),
    output: approve ? "Reviewed site knowledge updated for future plans only; dispatched routes, outcomes and buyer commitments preserved" : "Official knowledge unchanged",
  });
}

/** Rider confirmation is always a pending review, including for already verified cards. */
export function verifyCard(state: DemoState, key: string): DemoState {
  return submitKnowledgeRequest(state, key, "confirmation", "Existing delivery-site instructions confirmed on site (demo report)");
}

/** Flag a report for review without weakening approved constraints or changing routes. */
export function disputeCard(state: DemoState, key: string, reason: string): DemoState {
  return submitKnowledgeRequest(state, key, "dispute", reason);
}

function addMessage(state: DemoState, stopId: string, from: BuyerMessage["from"], text: string): DemoState {
  return { ...state, messages: [...state.messages, { id: uid("msg"), stopId, from, text, at: new Date().toISOString() }] };
}

function setBuyer(state: DemoState, stopId: string, buyer: StopState["buyer"]): DemoState {
  const ss = state.stopStates[state.shiftId];
  return { ...state, stopStates: { ...state.stopStates, [state.shiftId]: { ...ss, [stopId]: { ...ss[stopId], buyer } } } };
}

function plannedBlock(state: DemoState, stopId: string): Block | null {
  const p = current(state) ?? state.draftPlan;
  return p?.stops.find((s) => s.stopId === stopId)?.block ?? null;
}

export function inviteBuyer(state: DemoState, stopId: string, offered: Block): DemoState {
  let s = setBuyer(state, stopId, { kind: "invited", offeredBlock: offered, at: new Date().toISOString() });
  s = addMessage(s, stopId, "S-Compass", `Your parcel is planned for ${blockLabel(offered)}. Reply: confirm, pick another window, or choose a pickup point. (Simulated in-app message — nothing is sent.)`);
  return log(s, { type: "buyer_invited", role: "dispatcher", summary: `Invited buyer of ${stopId} to confirm`, output: `Offered ${blockLabel(offered)}` });
}

/** Create a replanning proposal if a plan is already dispatched; otherwise the change is used by the next plan. */
function propose(state: DemoState, trigger: ReplanTrigger): DemoState {
  const prev = current(state);
  if (!prev) return state;
  const proposed = planFor(state, prev.method);
  const diff = compareRemaining(prev, proposed, state.stopStates[state.shiftId], trigger);
  const proposal: ReplanProposal = { ...diff, id: uid("rp"), createdAt: new Date().toISOString(), status: "open" };
  const s = { ...state, proposals: [...state.proposals.map((p) => (p.status === "open" && p.previous.shiftId === state.shiftId ? { ...p, status: "overridden" as const, decisionNote: "Replaced by a newer proposal" } : p)), proposal] };
  return log(s, {
    type: "replan_proposed",
    role: "dispatcher",
    summary: diff.triggerText,
    output: `${diff.changes.length} stops change block or ETA by 15+ min · ${diff.commitments[0]}`,
    computeMs: proposed.computeMs,
  });
}

export function buyerConfirm(state: DemoState, stopId: string, block: Block): DemoState {
  let s = setBuyer(state, stopId, { kind: "confirmed", block, at: new Date().toISOString() });
  s = addMessage(s, stopId, "Buyer", `Confirmed: ${blockLabel(block)}.`);
  s = log(s, { type: "buyer_confirmed", role: "buyer", summary: `Buyer of ${stopId} confirmed ${blockInfo(block).label.toLowerCase()}`, output: "Window becomes a commitment the planner must keep" });
  const pb = plannedBlock(state, stopId);
  if (pb && pb !== block) s = propose(s, { kind: "buyer_window", stopId, from: blockLabel(pb), to: blockLabel(block) });
  return s;
}

export function buyerChange(state: DemoState, stopId: string, block: Block): DemoState {
  const pb = plannedBlock(state, stopId);
  let s = setBuyer(state, stopId, { kind: "changed", block, previous: pb, at: new Date().toISOString() });
  s = addMessage(s, stopId, "Buyer", `Please deliver in the ${blockLabel(block)} window instead.`);
  s = log(s, { type: "buyer_changed", role: "buyer", summary: `Buyer of ${stopId} changed window to ${blockInfo(block).label.toLowerCase()}`, input: pb ? `Was ${blockLabel(pb)}` : "No plan yet" });
  if (current(state)) s = propose(s, { kind: "buyer_window", stopId, from: pb ? blockLabel(pb) : "unplanned", to: blockLabel(block) });
  return s;
}

export function buyerPickup(state: DemoState, stopId: string, pickupId: string): DemoState {
  const pp = allPickupPoints.find((p) => p.id === pickupId)!;
  let s = setBuyer(state, stopId, { kind: "pickup", pickupId, at: new Date().toISOString() });
  s = addMessage(s, stopId, "Buyer", `I will collect it at ${pp.name}.`);
  s = log(s, { type: "buyer_pickup", role: "buyer", summary: `Buyer of ${stopId} chose ${pp.name}`, output: "Stop moves to the pickup point; success effect not estimated (no data)" });
  if (current(state)) s = propose(s, { kind: "buyer_pickup", stopId, pickupName: pp.name });
  return s;
}

export function buyerNoResponse(state: DemoState, stopId: string): DemoState {
  const prevBuyer = state.stopStates[state.shiftId][stopId].buyer;
  let s = setBuyer(state, stopId, { kind: "no_response", at: new Date().toISOString() });
  s = addMessage(s, stopId, "S-Compass", "No reply received. The order stays in the plan; the rider calls on arrival. (The order is NOT cancelled.)");
  return log(s, {
    type: "buyer_no_response",
    role: "buyer",
    summary: `No response from buyer of ${stopId}`,
    input: prevBuyer.kind === "invited" ? `Offered ${blockLabel(prevBuyer.offeredBlock)}` : undefined,
    output: "Order kept as planned (no cancellation)",
  });
}

export function reportEntranceClosed(state: DemoState, stopId: string, untilMin: number | null, useAlternate: boolean): DemoState {
  const shift = shiftById(state.shiftId);
  const stop = shift.stops.find((x) => x.id === stopId)!;
  const card = cardsFor(state)[stop.locationKey];
  const detail = useAlternate
    ? `use ${card.alternateEntrance ?? "alternate entrance"} instead`
    : untilMin === null
      ? "closed for the rest of the shift"
      : `closed until ${fmt(untilMin)}`;
  let s: DemoState = {
    ...state,
    overlays: {
      ...state.overlays,
      [stop.locationKey]: { ...state.overlays[stop.locationKey], temporaryClosure: { text: `Entrance temporarily unavailable — ${detail}`, untilMin, useAlternate } },
    },
  };
  s = log(s, { type: "issue_reported", summary: `Entrance unavailable at ${card.name}`, input: detail, output: current(state) ? "Replanning proposal created" : "Used by the next plan" });
  return propose(s, { kind: "entrance_closed", stopId, locationName: card.name, detail });
}

export function reportOtherIssue(state: DemoState, stopId: string, text: string): DemoState {
  return log(state, { type: "issue_reported", summary: `Issue at ${stopId}`, input: text, output: "Logged for dispatcher; no automatic plan change" });
}

export function decideProposal(state: DemoState, id: string, accept: boolean, note?: string): DemoState {
  const p = state.proposals.find((x) => x.id === id);
  if (!p || p.status !== "open") return state;
  const proposals = state.proposals.map((x) => (x.id === id ? { ...x, status: accept ? ("accepted" as const) : ("overridden" as const), decisionNote: note } : x));
  let s: DemoState = { ...state, proposals };
  if (accept) s = { ...s, currentPlan: { ...s.currentPlan, [p.proposed.shiftId]: p.proposed } };
  return log(s, {
    type: accept ? "replan_accepted" : "replan_overridden",
    summary: `${accept ? "Accepted" : "Overrode"} plan change: ${p.triggerText}`,
    input: note,
    output: accept ? describePlan(p.proposed) : "Previous sequence kept",
  });
}

export function recordOutcome(state: DemoState, stopId: string, outcome: "delivered" | "failed", reason?: string): DemoState {
  const plan = current(state);
  const ps: PlannedStop | undefined = plan?.stops.find((s) => s.stopId === stopId);
  const shift = shiftById(state.shiftId);
  const stop = shift.stops.find((x) => x.id === stopId)!;
  const atMin = ps && !Number.isNaN(ps.departMin) ? Math.max(state.clockMin[state.shiftId], ps.departMin) : state.clockMin[state.shiftId] + 15;
  const block = ps?.block ?? "afternoon";
  const ss = state.stopStates[state.shiftId];
  const rec: OutcomeRecord = {
    stopId,
    locationKey: stop.locationKey,
    block,
    weekend: shift.isWeekend,
    outcome,
    reason,
    atMin,
    at: new Date().toISOString(),
  };
  const s: DemoState = {
    ...state,
    stopStates: { ...state.stopStates, [state.shiftId]: { ...ss, [stopId]: { ...ss[stopId], status: outcome, outcomeReason: reason, completedAtMin: atMin } } },
    outcomes: [...state.outcomes, rec],
    clockMin: { ...state.clockMin, [state.shiftId]: atMin },
  };
  return log(s, {
    type: "outcome_recorded",
    role: "rider",
    summary: `${stopId} ${outcome}${reason ? ` (${reason})` : ""}`,
    input: `${blockInfo(block).label} at ${fmt(atMin)} (simulated clock)`,
    output: `Stop fixed in later plans; ${cardsFor(state)[stop.locationKey].name} history updated for the next plan`,
  });
}

export function transferParcel(state: DemoState, stopId: string, note: string): DemoState {
  const ss = state.stopStates[state.shiftId];
  const s: DemoState = {
    ...state,
    stopStates: { ...state.stopStates, [state.shiftId]: { ...ss, [stopId]: { ...ss[stopId], status: "transferred", transferredTo: BACKUP_RIDER } } },
    transfers: [...state.transfers, { stopId, shiftId: state.shiftId, to: BACKUP_RIDER, note, at: new Date().toISOString() }],
    currentPlan: current(state)
      ? {
          ...state.currentPlan,
          [state.shiftId]: { ...current(state)!, stops: current(state)!.stops.filter((x) => x.stopId !== stopId).map((x, i) => ({ ...x, seq: i + 1 })) },
        }
      : state.currentPlan,
  };
  return log(s, {
    type: "parcel_transferred",
    role: "dispatcher",
    summary: `Dispatcher moved ${stopId} from ${riderLabel(state.shiftId)} to the backup rider`,
    input: note,
    output: "Physical handover needed. The rider's remaining order is otherwise unchanged; regenerate to re-optimise",
  });
}

export function setTester(state: DemoState, name: string, persona: string): DemoState {
  const s = { ...state, tester: { name, persona } };
  return log(s, { type: "test_session_started", summary: `Test session: ${name || "(no name)"} as ${persona}` });
}

export function addTesterNote(state: DemoState, note: string): DemoState {
  return log(state, { type: "tester_note", summary: "Tester note", input: note });
}

/** Rule used to pick buyers for Buyer Confirm (documented on the How it works page). */
export function confirmEligibility(stopId: string, state: DemoState): string[] {
  const shift = shiftById(state.shiftId);
  const stop = shift.stops.find((x) => x.id === stopId)!;
  const plan = current(state) ?? state.draftPlan;
  const ps = plan?.stops.find((s) => s.stopId === stopId);
  const why: string[] = [];
  if (stop.payment === "cod") why.push("COD order");
  if (stop.isReattempt) why.push("Earlier attempt failed");
  if (!stop.pin) why.push("No map pin");
  if (ps?.p != null && ps.p < 0.7) why.push(`Planned block success estimate ${(ps.p * 100).toFixed(0)}% (< 70%)`);
  if (shift.isWeekend && (stop.locationType === "office" || stop.locationType === "school")) why.push("Office/school at the weekend");
  return why;
}
