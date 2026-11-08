import { describe, expect, it } from "vitest";
import { presentRisk, type RiskSelection } from "@/app/risk-challenge/presentation";
import { aiRisk, dataRisk, overloadRisk } from "../riskChallenge";
import { buyerConfirm, cardsFor, dispatchPlan, generatePlan, initialState, recordOutcome } from "../demoState";
import { fixtures, shiftById } from "../data";

const selection: RiskSelection = { aiFault: "none", dataFault: "missing_pin", orderId: "test", siteName: "Test site" };

describe("Risk Challenge presentation truthfulness", () => {
  it("shows both overload checks and keeps timeout priority using the engine's normalized evidence", () => {
    const cases = [[20, 40, 500, "safe", "Pass", "Pass"], [60, 40, 2000, "review", "Failed", "Pass"], [100, 40, 500, "timeout", "Failed", "Failed"]] as const;
    for (const [count, capacity, budget, status, capacityCheck, timeCheck] of cases) {
      const result = overloadRisk(count, capacity, budget, null);
      const view = presentRisk(result, selection);
      expect(result.status).toBe(status);
      expect(view.checks.map((c) => c.status)).toEqual([capacityCheck, timeCheck]);
      expect(view.checks[1].detail).toContain(`${count * 10} ms`);
    }
    const normalized = presentRisk(overloadRisk(20.9, 40.5, 500.8, null), selection);
    expect(normalized.checks[0].detail).toBe("20 parcels / 40 configured capacity");
    expect(normalized.checks[1].detail).toBe("200 ms simulated work / 500 ms budget");
  });

  it("does not invent downstream passes or probabilities for rejected AI inputs/outputs", () => {
    const state = initialState();
    for (const aiFault of ["nan", "infinity", "above_one", "missing_feature"] as const) {
      const result = aiRisk(state, aiFault, "morning");
      const view = presentRisk(result, { ...selection, aiFault });
      expect(result.status).toBe("review");
      expect(view.checks[0].status).toBe(aiFault === "missing_feature" ? "Not evaluated" : "Failed");
      expect(view.checks[1].status).toBe("Not evaluated");
      if (aiFault === "above_one") {
        expect(view.value?.text).toBe("125%");
        expect(view.value?.label).toBe("Injected invalid output");
      } else expect(view.value).toBeUndefined();
    }
  });

  it("shows the engine's reported probability while distinguishing numeric validity from a window conflict", () => {
    const state = initialState();
    for (const aiFault of ["none", "hard_conflict"] as const) {
      const result = aiRisk(state, aiFault, "morning");
      const view = presentRisk(result, { ...selection, aiFault });
      const reported = Number(result.detection.match(/(?:p_success=|Predicted )(\d+\.\d+)/)![1]);
      expect(view.value?.text).toBe(`${(reported * 100).toFixed(1)}%`);
      expect(view.checks.map((c) => c.status)).toEqual(["Pass", aiFault === "none" ? "Pass" : "Failed"]);
      if (aiFault === "hard_conflict") expect(view.checks[1].detail).toContain("simulated");
    }
    const shift = shiftById(state.shiftId);
    const changed = buyerConfirm(state, shift.stops[0].id, "evening");
    const actualConflict = presentRisk(aiRisk(changed, "none", "morning"), selection);
    expect(actualConflict.headline).toContain("Delivery window conflict");
    expect(actualConflict.checks[1].status).toBe("Failed");
    expect(actualConflict.checks[1].detail).not.toContain("injected");
  });

  it("keeps all C cases REVIEW with exact injected facts and recommendations, never a claim of applied repair", () => {
    const state = initialState();
    const stop = shiftById(state.shiftId).stops[0];
    for (const dataFault of ["missing_pin", "duplicate_id", "negative_service", "invalid_window", "conflicting_card"] as const) {
      const result = dataRisk(state, dataFault, stop.id);
      const view = presentRisk(result, { ...selection, dataFault, orderId: stop.id });
      expect(result.status).toBe("review");
      expect(view.checks[0].status).toBe("Failed");
      expect(view.value?.note).toContain("No quarantine, repair or approval was performed");
      expect(view.impact).toContain("could");
      if (dataFault === "negative_service") expect(view.value?.text).toContain("−5 minutes");
      if (dataFault === "invalid_window") expect(view.value?.text).toContain('"overnight"');
      if (dataFault === "conflicting_card") expect(view.value?.text).toBe("Morning-only versus evening-only");
      if (dataFault === "duplicate_id") expect(view.nextAction).toContain("previously accepted record");
    }
  });

  it("shows a verified entrance fallback only when the existing engine finds one", () => {
    const state = initialState();
    const cards = cardsFor(state);
    const shift = shiftById(state.shiftId);
    const available = shift.stops.find((s) => cards[s.locationKey].status === "verified" && cards[s.locationKey].entrancePoint !== null)!;
    const missing = shift.stops.find((s) => cards[s.locationKey].status !== "verified" || cards[s.locationKey].entrancePoint === null)!;
    expect(available).toBeDefined(); expect(missing).toBeDefined();
    expect(presentRisk(dataRisk(state, "missing_pin", available.id), selection).fallback).toBe("Verified entrance point available for review; not applied");
    expect(presentRisk(dataRisk(state, "missing_pin", missing.id), selection).fallback).toContain("No verified entrance fallback available");
  });

  it("runs all presentations without mutating source, active plan, buyer commitments, completed stops or cards", () => {
    let state = generatePlan(initialState(), "rules");
    state = dispatchPlan(state, state.draftPlan!);
    state = recordOutcome(state, state.currentPlan[state.shiftId]!.stops[0].stopId, "delivered");
    const pending = shiftById(state.shiftId).stops.find((s) => state.stopStates[state.shiftId][s.id].status === "pending")!;
    state = buyerConfirm(state, pending.id, "evening");
    const before = JSON.stringify({ state, fixtures, cards: cardsFor(state) });
    for (const aiFault of ["none", "nan", "infinity", "above_one", "missing_feature", "hard_conflict"] as const) presentRisk(aiRisk(state, aiFault, "morning"), { ...selection, aiFault });
    for (const dataFault of ["missing_pin", "duplicate_id", "negative_service", "invalid_window", "conflicting_card"] as const) presentRisk(dataRisk(state, dataFault, pending.id), { ...selection, dataFault });
    presentRisk(overloadRisk(100, 40, 500, state.currentPlan[state.shiftId]), selection);
    expect(JSON.stringify({ state, fixtures, cards: cardsFor(state) })).toBe(before);
  });
});
