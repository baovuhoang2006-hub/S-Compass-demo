import { onRoadMinutesPerParcel } from "./kpi";
import { METHOD_LABEL, type PlanContext } from "./planner";
import { riderOfShift } from "./data";
import { BLOCKS, blockInfo } from "./time";
import type { Plan, PlanMethod } from "./types";

export interface PlanEvaluation {
  method: PlanMethod;
  planId: string;
  eligible: boolean;
  errors: string[];
  warnings: string[];
  expectedSuccess: number | null;
  minutesPerParcel: number | null;
  eligibleStopIds: string[];
}
export interface PlanSelection {
  runId: string;
  inputSignature: string;
  shiftId: string;
  scenarioId: string;
  evaluations: PlanEvaluation[];
  selectedMethod: PlanMethod | null;
  selectedPlanId: string | null;
  reason: string;
  experimentalWarning: string | null;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
const probability = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;
const pointValid = (p: number[] | null) => p !== null && p.length === 2 && p.every(Number.isFinite);

/** Validate the existing planners' output. Capacity/soft flags stay warnings, not hard rules. */
export function planSafetyErrors(plan: Plan, ctx: Omit<PlanContext, "method">, pendingReview: boolean): string[] {
  const errors: string[] = [];
  const add = (text: string) => errors.push(text);
  if (pendingReview) add("A pending Replanning proposal requires a Dispatcher decision first.");
  if (plan.shiftId !== ctx.shift.id) add("Plan belongs to a different delivery shift.");
  const expected = ctx.shift.stops.filter(s => ctx.stopStates[s.id]?.status !== "transferred").map(s => s.id);
  const ids = plan.stops.map(s => s.stopId);
  if (new Set(ids).size !== ids.length || !sameIds(ids, expected)) add("Missing, duplicate or unexpected stop IDs.");
  const completed = ctx.previous?.stops.filter(s => ["delivered", "failed"].includes(ctx.stopStates[s.stopId]?.status)) ?? [];
  for (const [i, before] of completed.entries()) {
    const after = plan.stops[i];
    if (!after || JSON.stringify({ ...before, seq: 0, fixed: true }) !== JSON.stringify({ ...after, seq: 0 })) add(`${before.stopId}: completed stop was changed or moved.`);
  }
  if (!Number.isFinite(plan.startMin) || plan.startMin !== ctx.startMin) add("Invalid or stale plan start time.");
  let previousDeparture = plan.startMin;
  const pending = plan.stops.filter(s => ctx.stopStates[s.stopId]?.status === "pending");
  for (const [i, stop] of plan.stops.entries()) {
    if (stop.seq !== i + 1) add(`${stop.stopId}: invalid stop sequence.`);
    const status = ctx.stopStates[stop.stopId]?.status;
    if (status === "delivered" || status === "failed") {
      if (!stop.fixed || !completed.some(s => s.stopId === stop.stopId)) add(`${stop.stopId}: completed stop lacks its original dispatched record.`);
      continue;
    }
    if (status !== "pending") continue;
    if (stop.fixed) add(`${stop.stopId}: pending stop marked completed.`);
    const source = ctx.shift.stops.find(s => s.id === stop.stopId);
    const card = source && ctx.cards[source.locationKey];
    if (!card) { add(`${stop.stopId}: missing Stop Card.`); continue; }
    const scheduled = Number.isFinite(stop.arriveMin) && Number.isFinite(stop.departMin);
    // Explicit holds remain reviewable manually; the automatic comparator rejects partial routes below.
    if (!scheduled && (!Number.isNaN(stop.arriveMin) || !Number.isNaN(stop.departMin) || !stop.flags.length)) add(`${stop.stopId}: invalid ETA; only explicitly flagged unscheduled stops may have no ETA.`);
    if (![stop.travelMin, stop.serviceMin, stop.searchMin, stop.distanceM].every(n => Number.isFinite(n) && n >= 0)) add(`${stop.stopId}: invalid travel, processing time or distance.`);
    if (stop.point !== null && !pointValid(stop.point)) add(`${stop.stopId}: invalid location coordinates.`);
    if (scheduled && (stop.departMin < stop.arriveMin || stop.arriveMin < previousDeparture)) add(`${stop.stopId}: invalid or non-monotonic ETA.`);
    if (scheduled) previousDeparture = stop.departMin;
    if (!BLOCKS.some(b => b.id === stop.block)) { add(`${stop.stopId}: invalid delivery block.`); continue; }
    if (stop.p !== null && !probability(stop.p)) add(`${stop.stopId}: invalid common history-table probability.`);
    if (stop.pModel !== null && !probability(stop.pModel)) add(`${stop.stopId}: invalid AI probability.`);
    const buyer = ctx.stopStates[stop.stopId].buyer;
    if ((buyer.kind === "confirmed" || buyer.kind === "changed") && (!scheduled || stop.block !== buyer.block || stop.arriveMin < blockInfo(buyer.block).start || stop.arriveMin > blockInfo(buyer.block).end)) add(`${stop.stopId}: buyer-confirmed window is not preserved.`);
    if (buyer.kind === "pickup") {
      const pickup = riderOfShift(ctx.shift).pickupPoints.find(p => p.id === buyer.pickupId);
      if (!pickup || !pointValid(pickup.pos) || stop.pointSource !== "pickup point" || JSON.stringify(stop.point) !== JSON.stringify(pickup.pos)) add(`${stop.stopId}: pickup destination does not match the buyer request.`);
      if (stop.p !== null || stop.pModel !== null) add(`${stop.stopId}: pickup success must remain unestimated.`);
    } else {
      if (stop.pointSource === "pickup point") add(`${stop.stopId}: pickup destination has no buyer request.`);
      if (plan.method === "model" && scheduled && (stop.pModel === null || stop.flags.some(f => f.startsWith("Model output rejected")))) add(`${stop.stopId}: model inference rejected or missing; review the Rules fallback.`);
      if (scheduled) for (const r of card.restrictions) {
        if (r.strength === "hard" && ((r.weekdaysOnly && ctx.shift.isWeekend) || (r.blocks && (!r.blocks.includes(stop.block) || !r.blocks.some(b => stop.arriveMin >= blockInfo(b).start && stop.arriveMin <= blockInfo(b).end))) || (r.earliestMin !== undefined && stop.arriveMin < r.earliestMin) || (r.latestMin !== undefined && stop.arriveMin > r.latestMin))) add(`${stop.stopId}: hard site restriction — ${r.text}`);
      }
    }
  }
  const totals = plan.totals;
  if (Object.values(totals).some(n => n !== null && (!Number.isFinite(n) || n < 0))) add("Invalid KPI totals.");
  if (totals.stops !== pending.length || totals.scheduledStops !== pending.filter(s => Number.isFinite(s.arriveMin)).length) add("Pending/scheduled denominators do not match plan stops.");
  if (totals.expectedSuccess > totals.estimatedStops || totals.estimatedStops > pending.length) add("Invalid common-score denominator.");
  if (totals.modelExpectedSuccess !== null && totals.modelExpectedSuccess > totals.modelEstimatedStops) add("Invalid model-score denominator.");
  return [...new Set(errors)];
}

// Numerical equality only (same tolerance already used by the planner); no business KPI weighting.
const EPS = 1e-9;
const tiePriority: Record<PlanMethod, number> = { rules: 0, baseline: 1, model: 2 };
export function rankEligiblePlans(evaluations: PlanEvaluation[]): PlanEvaluation[] {
  return evaluations.filter(e => e.eligible).slice().sort((a, b) => {
    const success = b.expectedSuccess! - a.expectedSuccess!;
    if (Math.abs(success) > EPS) return success;
    const time = a.minutesPerParcel! - b.minutesPerParcel!;
    return Math.abs(time) > EPS ? time : tiePriority[a.method] - tiePriority[b.method];
  });
}

/** Rank complete, safe plans using only the common comparison totals already computed by Compare Plans. */
export function evaluateComparedPlans(plans: Plan[], ctx: Omit<PlanContext, "method">, pendingReview: boolean, commonIds: string[]): { evaluations: PlanEvaluation[]; winner: Plan | null; reason: string } {
  const evaluations = plans.map((plan): PlanEvaluation => {
    const errors = planSafetyErrors(plan, ctx, pendingReview);
    const minutes = onRoadMinutesPerParcel(plan);
    if (minutes === null || !Number.isFinite(minutes)) errors.push("Not comparable: every pending parcel must be scheduled for automatic selection.");
    if (!commonIds.length) errors.push("No common eligible history-table sample to rank.");
    const scored = plan.stops.filter(s => !s.fixed && commonIds.includes(s.stopId));
    if (scored.length !== commonIds.length || scored.some(s => s.p === null || !probability(s.p)) || plan.totals.estimatedStops !== commonIds.length || Math.abs(scored.reduce((a, s) => a + (s.p ?? 0), 0) - plan.totals.expectedSuccess) > EPS) errors.push("Common eligible stop IDs or history-table score do not match.");
    if (plan.stops.some(s => !s.fixed && s.point === null)) errors.push("A stop has no usable location; Dispatcher location review is required before automatic selection.");
    return { method: plan.method, planId: plan.id, eligible: errors.length === 0, errors, warnings: [...new Set([...plan.warnings, ...plan.stops.flatMap(s => s.flags)])], expectedSuccess: Number.isFinite(plan.totals.expectedSuccess) ? plan.totals.expectedSuccess : null, minutesPerParcel: minutes !== null && Number.isFinite(minutes) ? minutes : null, eligibleStopIds: [...commonIds].sort() };
  });
  const ranked = rankEligiblePlans(evaluations);
  if (!ranked.length) return { evaluations, winner: null, reason: "No safe, comparable method is eligible. Dispatcher review is required; no new draft was selected." };
  const best = ranked[0];
  const next = ranked[1];
  let reason = !next ? "Only eligible method after safety and common-sample checks." : Math.abs(best.expectedSuccess! - next.expectedSuccess!) > EPS ? "Highest simulated expected first-attempt success on the common history-table sample." : Math.abs(best.minutesPerParcel! - next.minutesPerParcel!) > EPS ? "Expected first-attempt success is tied; lower estimated on-road minutes per parcel wins." : "Both KPIs are tied; deterministic preference is Rules-based, then Baseline, then Model-assisted.";
  const faster = ranked.filter(p => p.minutesPerParcel! < best.minutesPerParcel! - EPS);
  if (faster.length) reason += ` Trade-off: ${best.minutesPerParcel!.toFixed(1)} min/parcel is slower than ${faster.map(p => `${METHOD_LABEL[p.method]} (${p.minutesPerParcel!.toFixed(1)})`).join(", ")}; expected success has priority.`;
  else if (next && Math.abs(best.expectedSuccess! - next.expectedSuccess!) > EPS) reason += " Its estimated minutes per parcel are no higher than the other eligible methods.";
  return { evaluations, winner: plans.find(p => p.id === best.planId)!, reason };
}
