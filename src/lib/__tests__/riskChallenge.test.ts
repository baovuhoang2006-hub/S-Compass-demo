import { describe, expect, it } from "vitest";
import { initialState, generatePlan, dispatchPlan, buyerConfirm, recordOutcome, planFor, reportEntranceClosed, comparePlans } from "../demoState";
import { checkedPredict } from "../model";
import { modelInputFor } from "../planner";
import { cardsFor } from "../demoState";
import { shiftById } from "../data";
import { aiRisk, dataRisk, overloadRisk } from "../riskChallenge";
import { onRoadMinutesPerParcel } from "../kpi";

describe("risk challenge", () => {
  it("distinguishes simulated capacity, timeout and safe retry while preserving the last plan", () => {
    let state = generatePlan(initialState(), "rules");
    state = dispatchPlan(state, state.draftPlan!);
    const previous = state.currentPlan[state.shiftId]!;
    expect(overloadRisk(100, 40, 500, previous).status).toBe("timeout");
    expect(overloadRisk(50, 40, 1000, previous).status).toBe("review");
    expect(overloadRisk(20, 40, 1000, previous).status).toBe("safe");
    expect(state.currentPlan[state.shiftId]).toBe(previous);
    expect(overloadRisk(100, 40, 500, previous).result).toContain(previous.id);
  });

  it("runs genuine inference and rejects non-finite, out-of-range and missing-feature outputs", () => {
    const state = initialState();
    const shift = shiftById(state.shiftId);
    const stop = shift.stops[0];
    const input = modelInputFor(stop, shift, cardsFor(state)[stop.locationKey], "morning");
    const valid = checkedPredict(input);
    expect(valid.p).not.toBeNull();
    expect(valid.p).toBeGreaterThanOrEqual(0);
    expect(valid.p).toBeLessThanOrEqual(1);
    for (const fault of ["nan", "infinity", "above_one", "missing_feature"] as const) {
      expect(checkedPredict(input, fault).p).toBeNull();
      expect(aiRisk(state, fault, "morning").fallback).toContain("Rules Planner");
    }
    expect(aiRisk(state, "hard_conflict", "morning").detection).toContain("conflicts");
    const confirmed = buyerConfirm(state, stop.id, "evening");
    expect(aiRisk(confirmed, "none", "morning").status).toBe("review");
  });

  it("detects each isolated data anomaly without altering source parcels or commitments", () => {
    let state = initialState();
    const id = shiftById(state.shiftId).stops[0].id;
    state = buyerConfirm(state, id, "morning");
    const before = JSON.stringify(state);
    for (const fault of ["missing_pin", "duplicate_id", "negative_service", "invalid_window", "conflicting_card"] as const) {
      const result = dataRisk(state, fault, id);
      expect(result.status).toBe("review");
      expect(result.detection.length).toBeGreaterThan(20);
      expect(result.result).toContain("37 source parcels");
    }
    expect(JSON.stringify(state)).toBe(before);
    expect(state.stopStates[state.shiftId][id].buyer).toMatchObject({ kind: "confirmed", block: "morning" });
  });

  it("keeps completed stops out of pending KPI work after replanning", () => {
    let state = generatePlan(initialState(), "rules");
    state = dispatchPlan(state, state.draftPlan!);
    const first = state.currentPlan[state.shiftId]!.stops[0].stopId;
    state = recordOutcome(state, first, "delivered");
    const next = planFor(state, "rules");
    expect(next.stops.find((s) => s.stopId === first)?.fixed).toBe(true);
    expect(next.totals.stops).toBe(36);
    expect(next.stops.length).toBe(37);
    const compared = comparePlans(state).comparison!;
    expect(compared.every((p) => p.totals.estimatedStops <= 36)).toBe(true);
  });

  it("does not report a misleading minutes-per-parcel gain for an unscheduled stop", () => {
    let state = generatePlan(initialState(), "rules");
    state = dispatchPlan(state, state.draftPlan!);
    const stop = shiftById(state.shiftId).stops.find((s) => s.locationKey === "loc-01")!;
    state = reportEntranceClosed(state, stop.id, null, false);
    const proposed = state.proposals.find((p) => p.status === "open")!.proposed;
    expect(proposed.totals.scheduledStops).toBeLessThan(proposed.totals.stops);
    expect(onRoadMinutesPerParcel(proposed)).toBeNull();
  });
});
