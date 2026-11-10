import { afterEach, describe, expect, it, vi } from "vitest";
import { buyerConfirm, buyerPickup, cardsFor, comparePlans, dispatchPlan, draftDispatchBlocker, generateBestProposedPlan, generatePlan, initialState, planningInputSignature, recordOutcome, selectShift, useComparedDraft } from "../demoState";
import { fixtures, riderOfShift, shiftById } from "../data";
import { evaluateComparedPlans, planSafetyErrors, rankEligiblePlans, type PlanEvaluation } from "../planSelection";
import { makePlan, type PlanContext } from "../planner";
import * as model from "../model";
import { SHIFT_START } from "../time";
import type { Plan, PlanMethod } from "../types";

afterEach(() => vi.restoreAllMocks());
const context = (): Omit<PlanContext, "method"> => { const s = initialState(); const shift = shiftById(s.shiftId); return { shift, cards: cardsFor(s), stopStates: s.stopStates[s.shiftId], startMin: SHIFT_START, startPoint: riderOfShift(shift).hub.pos, previous: null }; };
const initialPlans = () => { const ctx = context(); return { ctx, plans: (["baseline", "rules", "model"] as PlanMethod[]).map(method => makePlan({ ...ctx, method })) }; };
const ids = (plans: Plan[]) => plans[0].stops.filter(s => !s.fixed && s.p !== null).map(s => s.stopId).filter(id => plans.every(p => p.stops.some(s => s.stopId === id && s.p !== null)));

// Synthetic comparison fixtures only. No source dataset, planner or model weight is edited.
function rankedFixture() {
  const ctx = context();
  const source = ctx.shift.stops[0];
  const shift = { ...ctx.shift, stops: [{ ...source, pin: [0, 0] as [number, number] }] };
  const plan = makePlan({ ...ctx, shift, method: "rules" });
  const plans = (["baseline", "rules", "model"] as PlanMethod[]).map((method, i): Plan => ({ ...structuredClone(plan), id: method, method,
    stops: plan.stops.map(s => ({ ...s, p: [0.9, 0.8, 0.7][i], pModel: method === "model" ? 0.99 : null })),
    totals: { ...plan.totals, expectedSuccess: [0.9, 0.8, 0.7][i], modelExpectedSuccess: method === "model" ? 0.99 : null, modelEstimatedStops: method === "model" ? 1 : 0 },
  }));
  return { ctx: { ...ctx, shift }, plans };
}

describe("automatic best eligible planning", () => {
  it.each([["shift-wed", "model", 37, 30.8913], ["shift-sat", "rules", 33, 22.9543]] as const)("selects %s from the computed common KPIs", (shift, winner, stops, score) => {
    const input = selectShift(initialState(), shift); const before = JSON.stringify(input);
    const s = generateBestProposedPlan(input);
    expect(s.method).toBe(winner); expect(s.draftPlan).toBe(s.comparison!.find(p => p.method === winner));
    expect(s.draftPlan!.totals.stops).toBe(stops); expect(s.draftPlan!.totals.expectedSuccess).toBeCloseTo(score, 4);
    expect(s.comparison).toHaveLength(3); expect(s.planSelection?.selectedPlanId).toBe(s.draftPlan!.id);
    expect(s.currentPlan).toBe(input.currentPlan); expect(s.events.some(e => e.type === "plan_dispatched")).toBe(false);
    expect(JSON.stringify(input)).toBe(before); expect(draftDispatchBlocker(s, s.draftPlan!)).toBeNull();
    expect(s.events.at(-1)?.type).toBe("planner_auto_selected");
    const evidence = JSON.parse(s.events.at(-1)!.output!);
    expect(evidence.evaluations.map((e: PlanEvaluation) => e.method)).toEqual(["baseline", "rules", "model"]);
    expect(new Set(evidence.evaluations.map((e: PlanEvaluation) => JSON.stringify(e.eligibleStopIds))).size).toBe(1);
  });

  it("can select safe Baseline and never substitutes model predictions for the common score", () => {
    const { ctx, plans } = rankedFixture();
    const result = evaluateComparedPlans(plans, ctx, false, ids(plans));
    expect(result.evaluations.every(e => e.eligible)).toBe(true);
    expect(result.winner).toBe(plans[0]); // 0.9 common score wins, even though Model prediction is 0.99.
  });

  it("ranks success, then time, then Rules, then Baseline, then Model deterministically", () => {
    const { ctx, plans } = rankedFixture();
    const evaluations = evaluateComparedPlans(plans, ctx, false, ids(plans)).evaluations.map(e => ({ ...e, expectedSuccess: 1, minutesPerParcel: 10 }));
    expect(rankEligiblePlans(evaluations).map(e => e.method)).toEqual(["rules", "baseline", "model"]);
    expect(rankEligiblePlans(evaluations.filter(e => e.method !== "rules"))[0].method).toBe("baseline");
    expect(rankEligiblePlans(evaluations.map(e => ({ ...e, minutesPerParcel: e.method === "model" ? 9 : 10 })))[0].method).toBe("model");
    expect(rankEligiblePlans(evaluations.map(e => ({ ...e, expectedSuccess: e.method === "baseline" ? 2 : 1, minutesPerParcel: e.method === "baseline" ? 50 : 10 })))[0].method).toBe("baseline");
  });

  it("explains a genuine success/time trade-off and preserves soft capacity warnings", () => {
    const { ctx, plans } = rankedFixture();
    plans[0].totals.onRoadMin = 100;
    plans[0].warnings.push("Capacity warning: Dispatcher review");
    const result = evaluateComparedPlans(plans, ctx, false, ids(plans));
    expect(result.winner).toBe(plans[0]); expect(result.reason).toContain("Trade-off");
    expect(result.evaluations[0].warnings).toContain("Capacity warning: Dispatcher review");
  });

  it("rejects hard site restrictions even for a high-scoring candidate", () => {
    const { ctx, plans } = rankedFixture(); const card = ctx.cards[ctx.shift.stops[0].locationKey];
    ctx.cards = { ...ctx.cards, [card.key]: { ...card, restrictions: [{ code: "after_17", strength: "hard", text: "Evening only", blocks: ["evening"], source: "Test verified rule" }] } };
    plans[0].stops[0].block = "morning"; plans[0].stops[0].arriveMin = 500; plans[0].stops[0].departMin = 520;
    expect(evaluateComparedPlans(plans, ctx, false, ids(plans)).evaluations[0].errors.join(" ")).toContain("hard site restriction");
  });

  it.each([NaN, Infinity, 1.25, -0.1, null])("rejects invalid/missing AI output %s without changing weights", p => {
    vi.spyOn(model, "checkedPredict").mockReturnValue({ p, reason: p === null ? "Invalid model feature" : null });
    const s = generateBestProposedPlan(initialState());
    expect(s.planSelection!.evaluations.find(e => e.method === "model")!.eligible).toBe(false);
    expect(s.draftPlan?.method).toBe("rules");
  });

  it("returns review instead of a fake draft when no hard-safe plan exists", () => {
    const input = initialState();
    const s = { ...input, overlays: Object.fromEntries(fixtures.knowledge.map(k => [k.key, { temporaryClosure: { text: "Closed all day", untilMin: null, useAlternate: false } }])) };
    const next = generateBestProposedPlan(s);
    expect(next.draftPlan).toBeNull(); expect(next.planSelection!.selectedMethod).toBeNull();
    expect(next.events.at(-1)?.type).toBe("planner_selection_review"); expect(next.currentPlan).toBe(s.currentPlan);
  });

  it("keeps buyer commitments and fixed completed deliveries", () => {
    let s = generateBestProposedPlan(initialState()); s = dispatchPlan(s, s.draftPlan!);
    const completed = s.currentPlan[s.shiftId]!.stops[0];
    s = recordOutcome(s, completed.stopId, "delivered");
    const candidate = s.currentPlan[s.shiftId]!.stops.find(p => s.stopStates[s.shiftId][p.stopId].status === "pending")!;
    s = buyerConfirm(s, candidate.stopId, candidate.block);
    const next = generateBestProposedPlan(s);
    expect(next.stopStates).toBe(s.stopStates); expect(next.outcomes).toBe(s.outcomes); expect(next.currentPlan).toBe(s.currentPlan);
    expect(next.draftPlan).not.toBeNull();
    expect(next.draftPlan!.stops[0]).toEqual({ ...completed, seq: 1, fixed: true });
    expect(next.draftPlan!.stops.find(p => p.stopId === candidate.stopId)!.block).toBe(candidate.block);
  });

  it("does not replace or supersede a pending Replanning proposal", () => {
    let s = generateBestProposedPlan(initialState()); s = dispatchPlan(s, s.draftPlan!);
    const shift = shiftById(s.shiftId);
    s = buyerPickup(s, shift.stops[0].id, riderOfShift(shift).pickupPoints[0].id);
    const next = generateBestProposedPlan(s);
    expect(next.draftPlan).toBeNull(); expect(next.proposals).toBe(s.proposals); expect(next.currentPlan).toBe(s.currentPlan);
    expect(next.planSelection!.evaluations.every(e => e.errors.some(x => x.includes("pending Replanning")))).toBe(true);
  });

  it("logs manual override, adopts the exact compared object, and guards stale comparisons/drafts", () => {
    const s = generateBestProposedPlan(initialState());
    const chosen = s.comparison!.find(p => p.method === "rules")!;
    const manual = useComparedDraft(s, chosen.id);
    expect(manual.draftPlan).toBe(chosen); expect(manual.method).toBe("rules");
    expect(manual.events.at(-1)?.type).toBe("plan_draft_selected");
    expect(JSON.parse(manual.events.at(-1)!.input!).automaticallySelected).toBe("model");
    const changed = buyerConfirm(manual, chosen.stops[0].stopId, "evening");
    expect(planningInputSignature(changed)).not.toBe(planningInputSignature(s));
    expect(useComparedDraft(changed, chosen.id).draftPlan).toBe(changed.draftPlan);
    expect(useComparedDraft(changed, chosen.id).events.at(-1)?.type).toBe("draft_selection_blocked");
    expect(dispatchPlan(changed, chosen)).toBe(changed);
  });

  it("requires Dispatcher and does not allow manual selection to bypass safety", () => {
    const s = generateBestProposedPlan(initialState());
    for (const role of ["buyer", "rider"] as const) { const other = { ...s, role }; expect(dispatchPlan(other, s.draftPlan!)).toBe(other); }
    const bad = structuredClone(s.comparison!.find(p => p.method === "baseline")!);
    bad.stops[0].arriveMin = Infinity;
    const manual = useComparedDraft({ ...s, comparison: [bad] }, bad.id);
    expect(dispatchPlan(manual, manual.draftPlan!)).toBe(manual);
  });

  it("rejects missing/duplicate IDs, corrupted KPIs and invalid ETA rather than silently dropping data", () => {
    const { ctx, plans } = initialPlans(); const plan = plans[1];
    const missing = { ...plan, stops: plan.stops.slice(1) };
    expect(planSafetyErrors(missing, ctx, false).join(" ")).toContain("stop IDs");
    const duplicate = { ...plan, stops: [...plan.stops, plan.stops[0]] };
    expect(planSafetyErrors(duplicate, ctx, false).join(" ")).toContain("stop IDs");
    const invalid = structuredClone(plan); invalid.stops[0].serviceMin = -5; invalid.totals.onRoadMin = NaN;
    expect(planSafetyErrors(invalid, ctx, false).join(" ")).toContain("Invalid KPI");
    expect(planSafetyErrors(invalid, ctx, false).join(" ")).toContain("processing time");
  });

  it("uses a fresh comparison after an explicit new dispatched plan or changed pending review context", () => {
    let s = comparePlans(initialState());
    const before = planningInputSignature(s);
    s = useComparedDraft(s, s.comparison![1].id); s = dispatchPlan(s, s.draftPlan!);
    expect(planningInputSignature(s)).not.toBe(before);
    expect(useComparedDraft(s, s.comparison![1].id).events.at(-1)?.type).toBe("draft_selection_blocked");
  });

  it("is reproducible for business metrics, method, route, times and reasons", () => {
    const s = initialState(); const a = generateBestProposedPlan(s), b = generateBestProposedPlan(s);
    expect(a.method).toBe(b.method); expect(a.draftPlan!.totals).toEqual(b.draftPlan!.totals);
    expect(a.draftPlan!.stops).toEqual(b.draftPlan!.stops); expect(a.planSelection!.reason).toBe(b.planSelection!.reason);
  });
});
