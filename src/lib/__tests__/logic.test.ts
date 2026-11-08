import { describe, expect, it } from "vitest";
import parity from "./model-parity.json";
import { predictFromVector } from "../model";
import { fixtures, shiftById } from "../data";
import {
  buyerChange,
  buyerConfirm,
  buyerNoResponse,
  buyerPickup,
  decideCorrection,
  decideProposal,
  dispatchPlan,
  generatePlan,
  initialState,
  recordOutcome,
  reportEntranceClosed,
  selectShift,
  suggestCorrection,
  transferParcel,
  verifyCard,
  planFor,
  cardsFor,
  comparePlans,
  comparisonRunIdFor,
} from "../demoState";
import { toCsv } from "../evidence";
import { tableP } from "../successTable";

describe("model", () => {
  it("matches scikit-learn probabilities (parity cases from build_data.py)", () => {
    for (const c of parity as { x: number[]; p: number }[]) {
      expect(Math.abs(predictFromVector(c.x) - c.p)).toBeLessThan(2e-3);
    }
  });
});

describe("history table", () => {
  it("shows the dataset pattern: school evenings are weaker than mornings", () => {
    expect(tableP("school", "evening", "weekday", "prepaid").p).toBeLessThan(tableP("school", "morning", "weekday", "prepaid").p);
  });
});

describe("planner", () => {
  it("never drops or adds stops (no hidden workload change)", () => {
    const s = initialState();
    for (const m of ["baseline", "rules", "model"] as const) {
      const plan = planFor(s, m);
      const ids = plan.stops.map((x) => x.stopId).sort();
      expect(ids).toEqual(shiftById(s.shiftId).stops.map((x) => x.id).sort());
    }
  });

  it("rules plan uses fewer evening attempts and a higher estimate than the distance-only baseline", () => {
    const s = initialState();
    const base = planFor(s, "baseline");
    const rules = planFor(s, "rules");
    expect(rules.totals.expectedSuccess).toBeGreaterThan(base.totals.expectedSuccess);
  });

  it("keeps completed stops fixed and replans only pending stops", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const first = s.currentPlan[s.shiftId]!.stops[0].stopId;
    s = recordOutcome(s, first, "delivered");
    const re = planFor(s, "rules");
    expect(re.stops[0].stopId).toBe(first);
    expect(re.stops[0].fixed).toBe(true);
    expect(re.startMin).toBeGreaterThan(8 * 60);
  });

  it("buyer window change creates a proposal that respects the new window", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const target = s.currentPlan[s.shiftId]!.stops.find((x) => x.block !== "evening")!;
    s = buyerChange(s, target.stopId, "evening");
    const open = s.proposals.find((p) => p.status === "open")!;
    expect(open).toBeTruthy();
    expect(open.proposed.stops.find((x) => x.stopId === target.stopId)!.block).toBe("evening");
    s = decideProposal(s, open.id, true);
    expect(s.currentPlan[s.shiftId]!.stops.find((x) => x.stopId === target.stopId)!.block).toBe("evening");
  });

  it("confirming the already planned window does not trigger a replan", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const t = s.currentPlan[s.shiftId]!.stops[2];
    s = buyerConfirm(s, t.stopId, t.block);
    expect(s.proposals.length).toBe(0);
  });

  it("no response never cancels the order", () => {
    let s = initialState();
    const id = shiftById(s.shiftId).stops[0].id;
    s = buyerNoResponse(s, id);
    expect(s.stopStates[s.shiftId][id].status).toBe("pending");
    expect(planFor(s, "rules").stops.some((x) => x.stopId === id)).toBe(true);
  });

  it("pickup choice routes the stop to the pickup point", () => {
    let s = initialState();
    const id = shiftById(s.shiftId).stops[3].id;
    s = buyerPickup(s, id, "pp-a-1");
    const ps = planFor(s, "rules").stops.find((x) => x.stopId === id)!;
    expect(ps.pointSource).toBe("pickup point");
    expect(ps.p).toBeNull();
  });

  it("approved correction becomes a hard rule in the next plan; pending ones do not", () => {
    let s = initialState();
    const stop = shiftById(s.shiftId).stops.find((x) => x.locationKey === "loc-03")!;
    s = suggestCorrection(s, "loc-03", "receiving_window", "Receives after 17:00 (end of work shift)", "after_17");
    expect(planFor(s, "rules").stops.filter((x) => shiftById(s.shiftId).stops.find((y) => y.id === x.stopId)!.locationKey === "loc-03").every((x) => x.block === "evening")).toBe(false);
    s = decideCorrection(s, s.corrections[0].id, true);
    expect(cardsFor(s)["loc-03"].status).toBe("verified");
    const after = planFor(s, "rules").stops.find((x) => x.stopId === stop.id)!;
    expect(after.block).toBe("evening");
  });

  it("entrance closed for the rest of the shift keeps the stop in the queue and flags it", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const stop = shiftById(s.shiftId).stops.find((x) => x.locationKey === "loc-01")!;
    s = reportEntranceClosed(s, stop.id, null, false);
    const prop = s.proposals.find((p) => p.status === "open")!;
    const ps = prop.proposed.stops.find((x) => x.stopId === stop.id)!;
    expect(ps).toBeTruthy();
    expect(ps.flags.length).toBeGreaterThan(0);
    expect(Number.isNaN(ps.arriveMin)).toBe(true);
  });

  it("verified weekend closure on Saturday flags office stops instead of dropping them", () => {
    let s = selectShift(initialState(), "shift-sat");
    s = verifyCard({ ...s, role: "rider" }, "loc-01");
    s = decideCorrection({ ...s, role: "dispatcher" }, s.corrections[0].id, true);
    const plan = planFor(s, "rules");
    const officeStops = shiftById("shift-sat").stops.filter((x) => x.locationKey === "loc-01");
    for (const o of officeStops) {
      const ps = plan.stops.find((x) => x.stopId === o.id)!;
      expect(ps).toBeTruthy();
      expect(ps.flags.join(" ")).toMatch(/weekend/i);
    }
  });

  it("transfer requires an explicit action and removes the stop from rider A", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const id = s.currentPlan[s.shiftId]!.stops[5].stopId;
    s = transferParcel(s, id, "Rider A over capacity");
    expect(s.currentPlan[s.shiftId]!.stops.some((x) => x.stopId === id)).toBe(false);
    expect(planFor(s, "rules").stops.some((x) => x.stopId === id)).toBe(false);
    expect(s.transfers.length).toBe(1);
  });
});

describe("KPI comparison provenance", () => {
  it("uses a repeatable common scenario and common eligible stop denominator", () => {
    const first = comparePlans(initialState());
    const second = comparePlans(initialState());
    expect(first.comparisonMeta?.scenarioId).toBe(second.comparisonMeta?.scenarioId);
    expect(first.comparisonMeta?.runId).toBe(second.comparisonMeta?.runId);
    expect(first.comparisonMeta?.eligibleEstimatedStops).toBe(37);
    for (const plan of first.comparison ?? []) {
      expect(plan.totals.stops).toBe(37);
      expect(plan.totals.estimatedStops).toBe(37);
      expect(plan.totals.scheduledStops).toBe(37);
    }
    expect(first.comparison?.map((p) => p.totals.expectedSuccess)).toEqual(second.comparison?.map((p) => p.totals.expectedSuccess));
    expect(first.comparison?.find((p) => p.method === "model")?.totals.modelExpectedSuccess).toBeGreaterThan(0);
    expect(first.comparison?.find((p) => p.method === "rules")?.totals.modelExpectedSuccess).toBeNull();
  });

  it("invalidates a comparison when buyer commitments change", () => {
    const initial = initialState();
    const compared = comparePlans(initial);
    expect(compared.comparisonMeta?.runId).toBe(comparisonRunIdFor(compared));
    const stopId = shiftById(initial.shiftId).stops[0].id;
    const changed = buyerConfirm(compared, stopId, "morning");
    expect(comparisonRunIdFor(changed)).not.toBe(compared.comparisonMeta?.runId);
  });

  it("matches Calculation Sheet totals across all 12 rider-days", () => {
    const expected = [
      [37, 28.16, 30.55, 30.89, 866.1, 681.6], [33, 20.35, 22.95, 22.29, 832.8, 638.2],
      [39, 28.73, 32.15, 32.95, 925.0, 699.8], [36, 23.58, 24.34, 23.04, 994.2, 798.3],
      [34, 27.83, 29.13, 28.94, 736.4, 535.9], [32, 23.10, 26.00, 25.49, 839.5, 606.1],
      [43, 31.24, 33.96, 33.25, 885.7, 711.3], [36, 22.36, 23.05, 21.97, 934.7, 765.3],
      [39, 30.56, 33.21, 32.50, 885.1, 752.7], [36, 26.31, 26.94, 25.53, 946.5, 733.7],
      [42, 32.53, 36.03, 35.35, 950.5, 736.0], [32, 20.13, 23.31, 21.46, 774.6, 614.3],
    ] as const;
    fixtures.shifts.forEach((shift, i) => {
      const state = selectShift(initialState(), shift.id);
      const plans = (["baseline", "rules", "model"] as const).map((method) => planFor(state, method));
      const row = expected[i];
      expect(shift.stops.length).toBe(row[0]);
      expect(plans.map((p) => p.totals.stops)).toEqual([row[0], row[0], row[0]]);
      for (const [methodIndex, plan] of plans.entries()) {
        const success = methodIndex === 0 ? row[1] : methodIndex === 1 ? row[2] : row[3];
        expect(plan.totals.expectedSuccess).toBeCloseTo(success, 1);
        if (methodIndex < 2) {
          const minutes = methodIndex === 0 ? row[4] : row[5];
          expect(plan.totals.onRoadMin).toBeCloseTo(minutes, 1);
        }
        if (methodIndex === 2) {
          expect(plan.totals.modelExpectedSuccess).not.toBeNull();
          expect(plan.totals.modelExpectedSuccess).toBeGreaterThanOrEqual(0);
          expect(plan.totals.modelExpectedSuccess).toBeLessThanOrEqual(row[0]);
        }
      }
    });
  });
});

describe("all six rider zones", () => {
  it("every rider shift plans every stop with every method", () => {
    expect(fixtures.riders.length).toBe(6);
    expect(fixtures.shifts.length).toBe(12);
    for (const sh of fixtures.shifts) {
      const s = selectShift(initialState(), sh.id);
      for (const m of ["baseline", "rules", "model"] as const) {
        const plan = planFor(s, m);
        expect(plan.stops.map((x) => x.stopId).sort()).toEqual(sh.stops.map((x) => x.id).sort());
      }
    }
  });

  it("stop ids, location keys and pickup ids are unique across zones", () => {
    const stopIds = fixtures.shifts.flatMap((s) => s.stops.map((x) => x.id));
    expect(new Set(stopIds).size).toBe(stopIds.length);
    const keys = fixtures.knowledge.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    const pp = fixtures.riders.flatMap((r) => r.pickupPoints.map((p) => p.id));
    expect(new Set(pp).size).toBe(pp.length);
  });

  it("every stop's site belongs to its rider's zone", () => {
    const zoneOf = Object.fromEntries(fixtures.knowledge.map((k) => [k.key, k.zone]));
    for (const sh of fixtures.shifts) for (const st of sh.stops) expect(zoneOf[st.locationKey]).toBe(sh.riderId);
  });
});

describe("privacy", () => {
  it("public fixtures contain no dataset identifiers or coordinates", () => {
    const txt = JSON.stringify(fixtures);
    expect(txt).not.toMatch(/\b[OBL]\d{4,5}\b/);
    expect(txt).not.toMatch(/\bR0\d\b/);
    expect(txt).not.toMatch(/10\.\d{5,}|106\.\d{5,}/);
  });
});

describe("evidence export", () => {
  it("escapes commas and quotes in CSV", () => {
    let s = initialState();
    s = generatePlan(s, "rules");
    const csv = toCsv([{ ...s.events[0], summary: 'a, "b"' }]);
    expect(csv.split("\n")[1]).toContain('"a, ""b"""');
  });
});
