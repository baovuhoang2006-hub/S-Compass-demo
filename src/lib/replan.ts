import { blockInfo, fmt } from "./time";
import type { Plan, StopState, StopCard, Shift, PickupPoint } from "./types";

export type ReplanTrigger =
  | { kind: "buyer_window"; stopId: string; from: string; to: string }
  | { kind: "buyer_pickup"; stopId: string; pickupName: string }
  | { kind: "entrance_closed"; stopId: string; locationName: string; detail: string }
  | { kind: "manual"; detail: string };

export interface SequenceChange {
  stopId: string;
  beforePos: number | null;
  afterPos: number | null;
  beforeBlock: string | null;
  afterBlock: string | null;
  beforeEta: number | null;
  afterEta: number | null;
}

export interface ReplanProposal {
  id: string;
  createdAt: string;
  trigger: ReplanTrigger;
  triggerText: string;
  previous: Plan;
  proposed: Plan;
  previousRemaining: string[];
  proposedRemaining: string[];
  changes: SequenceChange[];
  reasons: string[];
  commitments: string[];
  transferNeeded: boolean;
  status: "open" | "accepted" | "overridden" | "superseded";
  inputDigest?: string;
  decidedAt?: string;
  decidedBy?: string;
  supersededBy?: string;
  demoEventId?: string;
  decisionNote?: string;
}

export function triggerText(t: ReplanTrigger): string {
  switch (t.kind) {
    case "buyer_window":
      return `Buyer for ${t.stopId} changed the receiving window from ${t.from} to ${t.to}.`;
    case "buyer_pickup":
      return `Buyer for ${t.stopId} chose a pickup point: ${t.pickupName}.`;
    case "entrance_closed":
      return `Entrance at ${t.locationName} (${t.stopId}) is temporarily unavailable: ${t.detail}.`;
    default:
      return t.detail;
  }
}

function remaining(plan: Plan, states: Record<string, StopState>) {
  return plan.stops.filter((s) => !s.fixed && states[s.stopId]?.status === "pending");
}

export function compareRemaining(
  previous: Plan,
  proposed: Plan,
  states: Record<string, StopState>,
  trigger: ReplanTrigger,
): Omit<ReplanProposal, "id" | "createdAt" | "status"> {
  const prev = remaining(previous, states);
  const next = remaining(proposed, states);
  const prevIds = prev.map((s) => s.stopId);
  const nextIds = next.map((s) => s.stopId);
  const ids = Array.from(new Set([...prevIds, ...nextIds]));
  const changes: SequenceChange[] = [];
  for (const id of ids) {
    const a = prev.find((s) => s.stopId === id);
    const b = next.find((s) => s.stopId === id);
    const beforePos = a ? prevIds.indexOf(id) + 1 : null;
    const afterPos = b ? nextIds.indexOf(id) + 1 : null;
    const etaA = a && !Number.isNaN(a.arriveMin) ? a.arriveMin : null;
    const etaB = b && !Number.isNaN(b.arriveMin) ? b.arriveMin : null;
    const moved = !a || !b || beforePos !== afterPos || a.block !== b.block || a.pointSource !== b.pointSource || JSON.stringify(a.point) !== JSON.stringify(b.point) || etaA === null || etaB === null ? true : Math.abs(etaA - etaB) >= 15;
    if (moved)
      changes.push({
        stopId: id,
        beforePos,
        afterPos,
        beforeBlock: a ? blockInfo(a.block).label : null,
        afterBlock: b ? blockInfo(b.block).label : null,
        beforeEta: etaA,
        afterEta: etaB,
      });
  }

  const reasons: string[] = [];
  const target = "stopId" in trigger ? trigger.stopId : null;
  const tStop = target ? next.find((s) => s.stopId === target) : null;
  if (tStop) reasons.push(...tStop.reasons);
  reasons.push(
    `Expected successful first attempts on the remaining route: ${prev.reduce((a, s) => a + (s.p ?? 0), 0).toFixed(1)} → ${next
      .reduce((a, s) => a + (s.p ?? 0), 0)
      .toFixed(1)} (history-table estimate, simulated).`,
  );
  reasons.push(`Estimated finish: ${fmt(previous.totals.endMin)} → ${fmt(proposed.totals.endMin)} (simulated).`);
  reasons.push("Completed stops stay fixed. Only parcels already loaded on this rider are re-sequenced.");

  const commitments: string[] = [];
  for (const s of next) {
    const st = states[s.stopId];
    const b = st?.buyer;
    if (b && (b.kind === "confirmed" || b.kind === "changed")) {
      const inWindow = s.block === b.block && !Number.isNaN(s.arriveMin) && s.arriveMin <= blockInfo(b.block).end;
      commitments.push(
        `${s.stopId}: buyer-confirmed ${blockInfo(b.block).label.toLowerCase()} — ${inWindow ? `kept (ETA ${fmt(s.arriveMin)})` : "AT RISK, call the buyer"}`,
      );
    }
    for (const f of s.flags) if (f.includes("latest") || f.includes("capacity")) commitments.push(`${s.stopId}: ${f}`);
  }
  if (!commitments.length) commitments.push("No buyer-confirmed windows are affected.");

  return {
    trigger,
    triggerText: triggerText(trigger),
    previous,
    proposed,
    previousRemaining: prevIds,
    proposedRemaining: nextIds,
    changes,
    reasons,
    commitments,
    transferNeeded: false,
  };
}

/** Resolve historical destinations from each plan, not the latest buyer response. */
export function planSiteLabel(plan: Plan, stopId: string, shift: Shift, cards: Record<string, StopCard>, pickups: PickupPoint[]): string {
  const planned = plan.stops.find((s) => s.stopId === stopId);
  if (planned?.pointSource === "pickup point") {
    const matches = pickups.filter((p) => planned.point && p.pos[0] === planned.point[0] && p.pos[1] === planned.point[1]);
    return matches.length === 1 ? matches[0].name : "Pickup point (name unavailable)";
  }
  const stop = shift.stops.find((s) => s.id === stopId);
  return stop ? cards[stop.locationKey]?.name ?? "Site unavailable" : "Order unavailable";
}

export function proposalStatusLabel(proposal: ReplanProposal): string {
  if (proposal.status === "superseded" || (proposal.status === "overridden" && /^(Replaced|Superseded) by/.test(proposal.decisionNote ?? ""))) return "Superseded";
  return proposal.status === "overridden" ? "Current plan kept" : proposal.status === "accepted" ? "Accepted" : "Awaiting Dispatcher";
}
