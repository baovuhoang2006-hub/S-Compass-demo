import { describe, expect, it } from "vitest";
import { shiftById } from "../data";
import { buyerConfirm, cardsFor, decideCorrection, dispatchPlan, disputeCard, generatePlan, initialState, knowledgeReviewBlocker, planFor, recordOutcome, restoreKnowledgeReviews, suggestCorrection, verifyCard, type DemoState } from "../demoState";
import { conflictingReviews, RESTRICTION_PRESETS } from "../knowledge";

const rider = (s: DemoState): DemoState => ({ ...s, role: "rider" });
const dispatcher = (s: DemoState): DemoState => ({ ...s, role: "dispatcher" });
const key = "loc-03";

describe("human-reviewed site knowledge", () => {
  it("preserves official information until approval; rejects without overwriting", () => {
    let s = rider(initialState());
    const before = cardsFor(s)[key];
    s = suggestCorrection(s, key, "entrance", "Observed side gate");
    expect(cardsFor(s)[key]).toEqual(before);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, false);
    expect(cardsFor(s)[key]).toEqual(before);
    expect(s.corrections[0].status).toBe("rejected");
    s = suggestCorrection(rider(s), key, "entrance", "Observed side gate");
    s = decideCorrection(dispatcher(s), s.corrections[1].id, true);
    expect(cardsFor(s)[key].entrance).toBe("Observed side gate");
    expect(s.events.at(-1)?.type).toBe("correction_approved");
    expect(s.events.at(-1)?.input).toContain(s.corrections[1].id);
    expect(cardsFor(s)[key].source).toContain("Browser demo");
  });

  it("guards approval/rejection in state for Rider and Buyer, including forged direct calls", () => {
    const pending = suggestCorrection(rider(initialState()), key, "handover", "At guard desk");
    for (const role of ["rider", "buyer"] as const) for (const approve of [true, false]) {
      const s = { ...pending, role };
      expect(decideCorrection(s, s.corrections[0].id, approve)).toBe(s);
    }
    const buyer = { ...pending, role: "buyer" as const };
    expect(suggestCorrection(buyer, key, "entrance", "Overwrite")).toBe(buyer);
    expect(verifyCard(buyer, key)).toBe(buyer);
    expect(disputeCard(buyer, key, "Unsafe")).toBe(buyer);
    const d = dispatcher(pending);
    expect(verifyCard(d, key)).toBe(d); // no bypass of the review queue
  });

  it("records a deduplicated on-site confirmation, actor, time and type; only review verifies", () => {
    let s = rider(initialState());
    const before = cardsFor(s)[key];
    s = verifyCard(s, key);
    expect(cardsFor(s)[key]).toEqual(before);
    expect(s.corrections[0]).toMatchObject({ field: "confirmation", status: "pending" });
    expect(s.corrections[0].proposedBy).toContain("Rider");
    expect(Number.isFinite(Date.parse(s.corrections[0].createdAt))).toBe(true);
    expect(verifyCard(s, key)).toBe(s);
    const rejected = decideCorrection(dispatcher(s), s.corrections[0].id, false);
    expect(cardsFor(rejected)[key]).toEqual(before);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    expect(cardsFor(s)[key].status).toBe("verified");
    expect(cardsFor(s)[key].source).toContain("not a real field inspection");
    expect(cardsFor(s)[key].entranceSource).toContain("not an independently verified entrance");
  });

  it("flags disputed reports without silently weakening verified instructions or constraints", () => {
    let s = rider(initialState());
    const seed = cardsFor(s)["loc-07"];
    s = disputeCard(s, "loc-07", "Gate may be closed");
    expect(cardsFor(s)["loc-07"]).toEqual(seed);
    expect(s.corrections[0].field).toBe("dispute");
    const rejected = decideCorrection(dispatcher(s), s.corrections[0].id, false);
    expect(cardsFor(rejected)["loc-07"]).toEqual(seed);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    expect(cardsFor(s)["loc-07"].status).toBe("disputed");
    expect(cardsFor(s)["loc-07"].entrance).toBe(seed.entrance);
    expect(cardsFor(s)["loc-07"].handover).toBe(seed.handover);
    expect(s.events.at(-1)?.type).toBe("card_disputed");
  });

  it("requires dispute review before other approvals and detects stale conflicting reports", () => {
    let s = suggestCorrection(rider(initialState()), key, "entrance", "Gate A");
    s = suggestCorrection(s, key, "entrance", "Gate B");
    expect(conflictingReviews(s.corrections[0], s.corrections)).toBe(true);
    s = disputeCard(s, key, "Neither gate is reliable");
    const d = dispatcher(s);
    expect(knowledgeReviewBlocker(d, d.corrections[0])).toMatch(/pending dispute/);
    expect(decideCorrection(d, d.corrections[0].id, true)).toBe(d);
    s = decideCorrection(d, d.corrections[2].id, false);
    s = decideCorrection(s, s.corrections[0].id, true);
    expect(knowledgeReviewBlocker(s, s.corrections[1])).toMatch(/changed after submission/);
    expect(decideCorrection(s, s.corrections[1].id, true)).toBe(s);
    expect(cardsFor(s)[key].entrance).toBe("Gate A");
  });

  it("rejects empty, unknown and malformed receiving rules without creating knowledge", () => {
    const s = rider(initialState());
    expect(suggestCorrection(s, key, "entrance", "  ")).toBe(s);
    expect(disputeCard(s, key, "  ")).toBe(s);
    expect(suggestCorrection(s, key, "receiving_window", "Invented hours", "after_17")).toBe(s);
    expect(verifyCard(s, "missing-site")).toBe(s);
  });

  it("shares approved site information across orders and applies window updates only to new plans", () => {
    let s = generatePlan(initialState(), "rules");
    s = dispatchPlan(s, s.draftPlan!);
    const first = s.currentPlan[s.shiftId]!.stops[0];
    s = buyerConfirm(s, first.stopId, first.block);
    s = recordOutcome(s, first.stopId, "delivered");
    const operational = JSON.stringify([s.currentPlan, s.stopStates, s.outcomes, s.proposals, s.transfers]);
    const window = RESTRICTION_PRESETS.find((p) => p.code === "after_17")!;
    s = suggestCorrection(rider(s), key, "receiving_window", window.text, window.code);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    expect(JSON.stringify([s.currentPlan, s.stopStates, s.outcomes, s.proposals, s.transfers])).toBe(operational);
    const newPlan = planFor(s, "rules");
    const siteOrders = shiftById(s.shiftId).stops.filter((x) => x.locationKey === key);
    expect(siteOrders.length).toBeGreaterThan(1);
    for (const stop of siteOrders) {
      const p = newPlan.stops.find((x) => x.stopId === stop.id)!;
      if (!p.fixed && Number.isFinite(p.arriveMin)) expect(p.block).toBe("evening");
    }
    expect(newPlan.stops.find((x) => x.stopId === first.stopId)?.fixed).toBe(true);
  });

  it("keeps seeded verification and restores old browser requests without invented actor/time", () => {
    let s = initialState();
    const seed = cardsFor(s)["loc-07"];
    expect(seed.source).toBe("Demo fixture — not from the dataset");
    s = { ...s, overlays: { ...s.overlays, [key]: { verificationRequested: true } } };
    s = restoreKnowledgeReviews(JSON.parse(JSON.stringify(s)));
    expect(cardsFor(s)["loc-07"]).toEqual(seed);
    expect(s.corrections[0]).toMatchObject({ field: "confirmation", createdAt: "", proposedBy: "Not recorded (legacy demo)" });
    expect(restoreKnowledgeReviews(s).corrections).toHaveLength(1);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, false);
    expect(restoreKnowledgeReviews(s).corrections).toHaveLength(1);
    expect(s.events).toHaveLength(1); // only the real review decision, no fabricated submission
  });

  it("field approval does not promote unrelated dataset suggestions to hard constraints", () => {
    let s = suggestCorrection(rider(initialState()), "loc-01", "handover", "New demo handover desk");
    expect(cardsFor(s)["loc-01"].restrictions.length).toBeGreaterThan(0);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    expect(cardsFor(s)["loc-01"].restrictions.every((r) => r.strength === "soft")).toBe(true);
    s = verifyCard(rider(s), "loc-01");
    s = decideCorrection(dispatcher(s), s.corrections.at(-1)!.id, true);
    expect(cardsFor(s)["loc-01"].restrictions.every((r) => r.strength === "hard")).toBe(true);
  });

  it("an explicitly approved window overrides the matching soft dataset suggestion only", () => {
    const preset = RESTRICTION_PRESETS.find((p) => p.code === "closed_weekend")!;
    let s = suggestCorrection(rider(initialState()), "loc-01", "receiving_window", preset.text, preset.code);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    const rules = cardsFor(s)["loc-01"].restrictions.filter((r) => r.code === preset.code);
    expect(rules).toHaveLength(1);
    expect(rules[0].strength).toBe("hard");
    expect(rules[0].source).toBe("Approved rider correction");
  });

  it("review decisions are idempotent, including after browser serialization", () => {
    let s = verifyCard(rider(initialState()), key);
    s = decideCorrection(dispatcher(s), s.corrections[0].id, true);
    const loaded: DemoState = JSON.parse(JSON.stringify(s));
    expect(decideCorrection(loaded, loaded.corrections[0].id, true)).toBe(loaded);
    expect(decideCorrection(loaded, loaded.corrections[0].id, false)).toBe(loaded);
  });
});
