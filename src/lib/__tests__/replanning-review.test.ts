import { afterEach, describe, expect, it, vi } from "vitest";
import * as data from "../data";
import { buyerChange, buyerConfirm, buyerNoResponse, buyerPickup, cardsFor, decideProposal, dispatchPlan, feasibleBuyerBlocks, generatePlan, initialState, inviteBuyer, planFor, proposalAcceptanceBlocker, recordOutcome, reportEntranceClosed, simulateReplanScenario, unresolvedReplanWarnings, type DemoState } from "../demoState";
import { metrics } from "../evidence";
import { compareRemaining, planSiteLabel, proposalStatusLabel } from "../replan";

const setup = () => { const s = generatePlan(initialState(), "rules"); return dispatchPlan(s, s.draftPlan!); };
const pending = (s: DemoState) => s.proposals.find((p) => p.status === "open")!;
const first = (s: DemoState) => s.currentPlan[s.shiftId]!.stops[0].stopId;
const pickup = (s: DemoState) => data.riderOfShift(data.shiftById(s.shiftId)).pickupPoints[0];
afterEach(() => vi.restoreAllMocks());

describe("replanning review guards", () => {
  it("Buyer/Rider direct approval and override calls cannot mutate plans or Evidence", () => {
    const s = buyerPickup(setup(), "WED-04", "pp-a-1");
    for (const role of ["buyer", "rider"] as const) for (const accept of [true, false]) {
      const asRole = { ...s, role };
      expect(decideProposal(asRole, pending(s).id, accept, "Attempted bypass")).toBe(asRole);
    }
    expect(proposalAcceptanceBlocker(s, pending(s))).toBeNull();
    expect(decideProposal(s, pending(s).id, true).currentPlan[s.shiftId]?.id).toBe(pending(s).proposed.id);
  });

  it("pickup is a pending request; acceptance uses the existing planner's destination and no-data estimates", () => {
    let s = setup(); const plan = s.currentPlan[s.shiftId]; const id = first(s); const pp = pickup(s);
    s = buyerPickup({ ...s, role: "buyer" }, id, pp.id);
    expect(s.currentPlan[s.shiftId]).toBe(plan);
    expect(pending(s).proposed.stops.find((p) => p.stopId === id)).toMatchObject({ point: pp.pos, pointSource: "pickup point", p: null, pModel: null });
    s = decideProposal({ ...s, role: "dispatcher" }, pending(s).id, true);
    expect(s.currentPlan[s.shiftId]?.stops.find((p) => p.stopId === id)?.point).toEqual(pp.pos);
    expect(s.events.at(-1)).toMatchObject({ type: "replan_accepted", role: "dispatcher" });
  });

  it("invalid/cross-zone pickup points, missing orders and completed orders are rejected safely", () => {
    let s = setup(); const id = first(s);
    for (const pp of ["unknown", data.fixtures.riders[1].pickupPoints[0].id]) expect(buyerPickup(s, id, pp)).toBe(s);
    expect(buyerPickup(s, "unknown", pickup(s).id)).toBe(s);
    s = recordOutcome(s, id, "delivered");
    expect(buyerPickup(s, id, pickup(s).id)).toBe(s);
    expect(buyerChange(s, id, "evening")).toBe(s);
  });

  it("empty/invalid configured pickup lists do not crash or invent a destination", () => {
    const s = setup(); const rider = data.riderOfShift(data.shiftById(s.shiftId)); const id = first(s);
    const mock = vi.spyOn(data, "riderOfShift").mockReturnValue({ ...rider, pickupPoints: [] });
    expect(buyerPickup(s, id, "pp-a-1")).toBe(s);
    mock.mockReturnValue({ ...rider, pickupPoints: [{ ...rider.pickupPoints[0], pos: [NaN, 0] }] });
    expect(buyerPickup(s, id, "pp-a-1")).toBe(s);
  });

  it("a completed stop after proposal creation invalidates acceptance and preserves outcomes", () => {
    let s = setup(); s = buyerPickup(s, first(s), pickup(s).id); const p = pending(s);
    s = recordOutcome(s, first(s), "delivered"); const before = JSON.stringify(s);
    expect(proposalAcceptanceBlocker(s, p)).toMatch(/completed stops/);
    expect(decideProposal(s, p.id, true)).toBe(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("newer buyer commitments, knowledge and clock changes invalidate pending proposals", () => {
    let s = setup(); s = buyerPickup(s, first(s), pickup(s).id); const p = pending(s);
    const other = s.currentPlan[s.shiftId]!.stops[1];
    const committed = buyerConfirm(s, other.stopId, other.block);
    expect(decideProposal(committed, p.id, true)).toBe(committed);
    const knowledge = { ...s, overlays: { ...s.overlays, "loc-03": { entrance: "New approved observation" } } };
    expect(decideProposal(knowledge, p.id, true)).toBe(knowledge);
    const advanced = { ...s, clockMin: { ...s.clockMin, [s.shiftId]: s.clockMin[s.shiftId] + 1 } };
    expect(decideProposal(advanced, p.id, true)).toBe(advanced);
  });

  it("dispatch cannot silently supersede a pending proposal; Dispatcher must decide it first", () => {
    let s = setup(); s = buyerPickup(s, first(s), pickup(s).id); const p = pending(s);
    s = generatePlan(s, "rules");
    expect(dispatchPlan(s, s.draftPlan!)).toBe(s);
    expect(s.proposals.find((x) => x.id === p.id)?.status).toBe("open");
    expect(metrics(s.events).replansOverridden).toBe(0);
  });

  it("keeps proposal history and distinguishes supersession from an operator decision", () => {
    let s = setup(); s = buyerPickup(s, first(s), pickup(s).id); const old = pending(s);
    const second = data.riderOfShift(data.shiftById(s.shiftId)).pickupPoints[1];
    s = buyerPickup(s, first(s), second.id);
    expect(s.proposals).toHaveLength(2);
    expect(s.proposals[0]).toMatchObject({ status: "superseded", supersededBy: pending(s).id });
    expect(proposalStatusLabel(s.proposals[0])).toBe("Superseded");
    expect(s.events.some((e) => e.type === "replan_superseded")).toBe(true);
    expect(decideProposal(s, old.id, true)).toBe(s);
    expect(s.events.filter((e) => e.type === "replan_overridden")).toHaveLength(0);
  });

  it("refuses missing/duplicate orders or altered completed stops in a candidate", () => {
    let s = setup(); s = recordOutcome(s, first(s), "delivered");
    const id = s.currentPlan[s.shiftId]!.stops[1].stopId;
    s = buyerPickup(s, id, pickup(s).id); const p = pending(s);
    const missing = { ...p, proposed: { ...p.proposed, stops: p.proposed.stops.slice(1) } };
    expect(proposalAcceptanceBlocker(s, missing)).toMatch(/missing, duplicate/);
    const changed = { ...p, proposed: { ...p.proposed, stops: p.proposed.stops.map((x, i) => i === 0 ? { ...x, arriveMin: x.arriveMin + 1 } : x) } };
    expect(proposalAcceptanceBlocker(s, changed)).toMatch(/alter completed/);
    expect(proposalAcceptanceBlocker(s, p)).toBeNull();
  });

  it("blocks unsafe buyer commitments instead of quietly accepting them", () => {
    let s = setup(); const id = first(s); s = buyerChange(s, id, "evening"); const p = pending(s);
    expect(proposalAcceptanceBlocker(s, p)).toBeNull();
    const unsafe = { ...p, proposed: { ...p.proposed, stops: p.proposed.stops.map((x) => x.stopId === id ? { ...x, block: "morning" as const, arriveMin: 490 } : x) } };
    expect(proposalAcceptanceBlocker(s, unsafe)).toMatch(/buyer commitment/);
    s = { ...s, proposals: [unsafe] };
    expect(decideProposal(s, unsafe.id, true)).toBe(s);
    expect(s.stopStates[s.shiftId][id].buyer).toMatchObject({ kind: "changed", block: "evening" });
  });

  it("rejects hard site violations and fabricated pickup probabilities", () => {
    let s = setup(); const id = first(s); s = buyerPickup(s, id, pickup(s).id); const p = pending(s);
    const fabricated = { ...p, proposed: { ...p.proposed, stops: p.proposed.stops.map((x) => x.stopId === id ? { ...x, p: 0.99 } : x) } };
    expect(proposalAcceptanceBlocker(s, fabricated)).toMatch(/invented estimate/);
    let closed = setup(); const other = closed.currentPlan[closed.shiftId]!.stops.find((x) => data.shiftById(closed.shiftId).stops.find((o) => o.id === x.stopId)?.locationKey === "loc-01")!.stopId;
    closed = reportEntranceClosed(closed, other, null, false); const cp = pending(closed);
    const bad = { ...cp, proposed: { ...cp.proposed, stops: cp.proposed.stops.map((x) => x.stopId === other ? { ...x, arriveMin: 600, departMin: 610 } : x) } };
    expect(proposalAcceptanceBlocker(closed, bad)).toMatch(/violates/);
    expect(proposalAcceptanceBlocker(closed, cp)).toBeNull(); // explicit held stops remain visible
  });

  it("override requires an explanation and keeps unresolved buyer/closure reports visible", () => {
    let s = setup(); const old = s.currentPlan[s.shiftId]; const id = first(s);
    s = buyerChange(s, id, "evening"); const p = pending(s);
    expect(decideProposal(s, p.id, false)).toBe(s);
    s = decideProposal(s, p.id, false, "Call buyer before travelling");
    expect(s.currentPlan[s.shiftId]).toBe(old);
    expect(unresolvedReplanWarnings(s).join(" ")).toMatch(/buyer/);
    expect(s.events.at(-1)?.output).toContain("Follow-up:");
    s = reportEntranceClosed(s, id, null, false); s = decideProposal(s, pending(s).id, false, "Stop and call rider");
    expect(unresolvedReplanWarnings(s).join(" ")).toMatch(/unavailable entrance/);
    expect(cardsFor(s)[data.shiftById(s.shiftId).stops.find((x) => x.id === id)!.locationKey].temporaryClosure).toBeTruthy();
  });

  it("simulations record operator, domain actor and eventual Dispatcher decision separately", () => {
    for (const kind of ["pickup", "window", "closure"] as const) {
      let s = setup(); const id = first(s);
      const event = kind === "pickup" ? {kind,stopId:id,pickupId:pickup(s).id} : kind === "window" ? {kind,stopId:id,block:"evening" as const} : {kind,stopId:id,untilMin:null,useAlternate:false};
      const previous = s.currentPlan[s.shiftId]; s = simulateReplanScenario(s,event);
      expect(s.role).toBe("dispatcher"); expect(s.currentPlan[s.shiftId]).toBe(previous);
      expect(pending(s).demoEventId).toBeTruthy();
      expect(s.events.find((e) => e.type === "demo_scenario_triggered")?.input).toContain('"operatorRole":"dispatcher"');
      expect(s.events.find((e) => ["buyer_changed","buyer_pickup","issue_reported"].includes(e.type))?.role).toBe(kind === "closure" ? "rider" : "buyer");
      expect(s.events.some((e) => e.type === "replan_accepted")).toBe(false);
      expect(s.events.findIndex((e) => e.type === "demo_scenario_triggered")).toBeLessThan(s.events.findIndex((e) => ["buyer_changed","buyer_pickup","issue_reported"].includes(e.type)));
    }
  });

  it("no response cannot erase a confirmed window or pickup request and never cancels", () => {
    let s = setup(); const id = first(s);
    s = buyerNoResponse(s, id); expect(s.stopStates[s.shiftId][id].status).toBe("pending");
    s = buyerConfirm(s, id, s.currentPlan[s.shiftId]!.stops[0].block); expect(buyerNoResponse(s, id)).toBe(s);
    expect(inviteBuyer(s,id,"evening")).toBe(s);
    s = buyerPickup(s, id, pickup(s).id); expect(buyerNoResponse(s, id)).toBe(s);
  });

  it("invalid window/order/closure inputs are rejected without side effects", () => {
    const s = setup(); const id = first(s);
    expect(buyerChange(s, id, "invalid" as never)).toBe(s);
    expect(buyerChange(s, "missing", "evening")).toBe(s);
    expect(feasibleBuyerBlocks(s, "missing")).toEqual([]);
    expect(reportEntranceClosed(s, id, Infinity, false)).toBe(s);
    expect(reportEntranceClosed(s, id, 1, false)).toBe(s);
    const withoutAlternate = data.shiftById(s.shiftId).stops.find((x) => !cardsFor(s)[x.locationKey].alternateEntrance)!;
    expect(reportEntranceClosed(s, withoutAlternate.id, null, true)).toBe(s);
  });

  it("before/after destination labels use each historical plan rather than current buyer state", () => {
    let s = setup(); const id = first(s); s = buyerPickup(s, id, pickup(s).id); const p = pending(s);
    const shift = data.shiftById(s.shiftId); const cards = cardsFor(s); const points = data.riderOfShift(shift).pickupPoints;
    expect(planSiteLabel(p.previous,id,shift,cards,points)).toBe(cards[shift.stops.find((x) => x.id === id)!.locationKey].name);
    expect(planSiteLabel(p.proposed,id,shift,cards,points)).toBe(points[0].name);
    expect(planSiteLabel(p.proposed,id,shift,cards,[])).toBe("Pickup point (name unavailable)");
    s = buyerPickup(s,id,points[1].id);
    expect(planSiteLabel(p.proposed,id,shift,cards,points)).toBe(points[0].name);
  });

  it("closure removes impossible windows while a configured pickup request remains available", () => {
    let s = setup(); const id = first(s);
    s = reportEntranceClosed(s,id,null,false);
    expect(feasibleBuyerBlocks(s,id)).toEqual([]);
    expect(buyerChange(s,id,"evening")).toBe(s);
    s = buyerPickup(s,id,pickup(s).id);
    expect(pending(s).trigger.kind).toBe("buyer_pickup");
    expect(proposalAcceptanceBlocker(s,pending(s))).toBeNull();
    const kept = decideProposal(s,pending(s).id,false,"Call buyer to resolve pickup request");
    expect(unresolvedReplanWarnings(kept).join(" ")).toMatch(/pickup request remains unresolved/);
  });

  it("before/after change counts include position-only moves without changing route KPIs", () => {
    const s=setup(); const previous=s.currentPlan[s.shiftId]!;
    const proposed={...previous,stops:[previous.stops[1],previous.stops[0],...previous.stops.slice(2)]};
    const diff=compareRemaining(previous,proposed,s.stopStates[s.shiftId],{kind:"manual",detail:"Position-only QA example"});
    expect(diff.changes.some((c)=>c.stopId===previous.stops[0].stopId)).toBe(true);
    expect(proposed.totals).toEqual(previous.totals);
  });

  it("legacy snapshots are read-only until refreshed, while genuine pending snapshots survive reload", () => {
    let s = setup(); s = buyerPickup(s,first(s),pickup(s).id); const p = pending(s);
    expect(proposalAcceptanceBlocker(s,{...p,inputDigest:undefined})).toMatch(/Legacy/);
    const reload: DemoState = JSON.parse(JSON.stringify(s));
    expect(proposalAcceptanceBlocker(reload,pending(reload))).toBeNull();
  });
});
