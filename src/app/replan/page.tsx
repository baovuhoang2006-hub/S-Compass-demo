"use client";

import { CalendarClock, DoorClosed, Store } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState } from "@/components/bits";
import { PlanFollowUp, ProposalReview } from "@/components/ProposalReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { riderOfShift } from "@/lib/data";
import { feasibleBuyerBlocks, simulateReplanScenario } from "@/lib/demoState";
import { proposalStatusLabel } from "@/lib/replan";
import { blockLabel, fmt } from "@/lib/time";
import type { Block } from "@/lib/types";
import { useDemo } from "@/state/DemoProvider";

export default function ReplanPage() {
  const { state, update, shift, cards, plan } = useDemo();
  const pending = shift.stops.filter((s) => state.stopStates[shift.id][s.id]?.status === "pending");
  const proposals = state.proposals.filter((p) => p.previous.shiftId === shift.id).slice().reverse();
  const open = proposals.find((p) => p.status === "open");
  const [winStop, setWinStop] = React.useState("");
  const [winBlock, setWinBlock] = React.useState<Block>("evening");
  const [pickupStop, setPickupStop] = React.useState("");
  const [pickupId, setPickupId] = React.useState("");
  const [entStop, setEntStop] = React.useState("");
  const [entMode, setEntMode] = React.useState<"alt" | "1300" | "rest">("1300");
  const validStop = (id: string, index = 0) => pending.some((s) => s.id === id) ? id : pending[index]?.id ?? pending[0]?.id ?? "";
  const windowOrder = validStop(winStop, 1), pickupOrder = validStop(pickupStop), entranceOrder = validStop(entStop);
  const pickupPoints = riderOfShift(shift).pickupPoints.filter((p) => p.pos.length === 2 && p.pos.every(Number.isFinite));
  const selectedPickup = pickupPoints.find((p) => p.id === pickupId) ?? pickupPoints[0];
  const windowOptions = feasibleBuyerBlocks(state, windowOrder).filter((b) => b !== plan?.stops.find((s) => s.stopId === windowOrder)?.block);
  const selectedBlock = windowOptions.includes(winBlock) ? winBlock : windowOptions[0];
  const entranceCard = cards[pending.find((s) => s.id === entranceOrder)?.locationKey ?? ""];
  const closureInvalid = !entranceOrder || (entMode === "alt" && !entranceCard?.alternateEntrance) || (entMode === "1300" && state.clockMin[shift.id] > 13 * 60);
  React.useEffect(() => { setWinStop(""); setPickupStop(""); setEntStop(""); setPickupId(""); setEntMode("1300"); }, [shift.id]);

  if (!plan) return <EmptyState title="Dispatch a plan first" action={<Link href="/dispatcher" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">Go to dispatcher</Link>}>Live replanning changes a dispatched route. Generate and dispatch a plan, then come back to trigger demo events.</EmptyState>;
  const orderOptions = pending.map((s) => {
    const p = plan.stops.find((p) => p.stopId === s.id);
    return <option key={s.id} value={s.id}>{s.id} · {cards[s.locationKey].name} · {p && Number.isFinite(p.arriveMin) ? `${p.block} ${fmt(p.arriveMin)}` : "Not scheduled"}</option>;
  });

  return <div className="space-y-4">
    <div><h1 className="text-2xl font-bold tracking-tight">Replanning</h1><p className="text-sm text-ink-soft">{riderOfShift(shift).label} · {shift.date} · Dispatcher reviews changes before the dispatched route is updated.</p><p className="mt-1 text-xs text-ink-faint">Demo role is a prototype selector, not real authentication. Simulated events never send external messages.</p></div>
    <PlanFollowUp />
    <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <details className="rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer font-semibold">Simulate a scenario</summary>
        <p className="my-3 text-xs text-ink-soft">Demo operator controls: simulate a Buyer or Rider event. These controls do not approve a plan.</p>
        {!pending.length ? <p className="mb-3 text-sm text-warn">No pending orders in this shift.</p> : null}
        <div className="space-y-4">
          <Panel><PanelHeader title="1. Buyer changes delivery window" note="Same logic as Buyer simulation" /><div className="space-y-3 p-3">
            <div><Label htmlFor="win-stop">Window-change order</Label><Select id="win-stop" value={windowOrder} onChange={(e) => setWinStop(e.target.value)}>{orderOptions}</Select></div>
            <div><Label htmlFor="win-block">New receiving window</Label><Select id="win-block" value={selectedBlock ?? ""} onChange={(e) => setWinBlock(e.target.value as Block)}>{windowOptions.length ? windowOptions.map((b) => <option key={b} value={b}>{blockLabel(b)}</option>) : <option value="">No other feasible window</option>}</Select></div>
            <Button variant="primary" className="h-auto min-h-10 w-full py-2" disabled={!windowOrder || !selectedBlock} onClick={() => selectedBlock && update((s) => simulateReplanScenario(s, { kind: "window", stopId: windowOrder, block: selectedBlock }))}><CalendarClock /> Send buyer change</Button>
          </div></Panel>
          <Panel><PanelHeader title="2. Buyer chooses pickup point" note="Only configured points in this rider's zone" /><div className="space-y-3 p-3">
            <div><Label htmlFor="pickup-stop">Pickup order</Label><Select id="pickup-stop" value={pickupOrder} onChange={(e) => setPickupStop(e.target.value)}>{orderOptions}</Select></div>
            <div><Label htmlFor="pickup-point">Pickup point</Label><Select id="pickup-point" value={selectedPickup?.id ?? ""} onChange={(e) => setPickupId(e.target.value)}>{pickupPoints.length ? pickupPoints.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.hours || "Hours not recorded"}</option>) : <option value="">No valid pickup points configured</option>}</Select></div>
            <p className="text-xs text-ink-soft">{selectedPickup ? `${selectedPickup.name} · Opening hours: ${selectedPickup.hours || "Not recorded"}` : "Pickup simulation is unavailable for this zone."} Pickup success effect is not estimated (no data).</p>
            <Button variant="primary" className="h-auto min-h-10 w-full py-2" disabled={!pickupOrder || !selectedPickup} onClick={() => selectedPickup && update((s) => simulateReplanScenario(s, { kind: "pickup", stopId: pickupOrder, pickupId: selectedPickup.id }))}><Store /> Send pickup request</Button>
          </div></Panel>
          <Panel><PanelHeader title="3. Entrance temporarily unavailable" note="Same logic as Rider Report Issue" /><div className="space-y-3 p-3">
            <div><Label htmlFor="ent-stop">Entrance-closure order</Label><Select id="ent-stop" value={entranceOrder} onChange={(e) => setEntStop(e.target.value)}>{orderOptions}</Select></div>
            <div><Label htmlFor="ent-mode">Situation</Label><Select id="ent-mode" value={entMode} onChange={(e) => setEntMode(e.target.value as typeof entMode)}>{entranceCard?.alternateEntrance ? <option value="alt">Use alternate: {entranceCard.alternateEntrance}</option> : null}<option value="1300">Closed until 13:00</option><option value="rest">Closed for the rest of the shift</option></Select></div>
            {closureInvalid && entranceOrder ? <p className="text-xs text-warn">Choose a valid alternate entrance or a closure time that has not passed.</p> : null}
            <Button variant="primary" className="w-full" disabled={closureInvalid} onClick={() => update((s) => simulateReplanScenario(s, { kind: "closure", stopId: entranceOrder, untilMin: entMode === "1300" ? 13 * 60 : null, useAlternate: entMode === "alt" }))}><DoorClosed /> Report closure</Button>
            <p className="text-xs text-ink-faint">Temporary report for all orders at this site. It does not approve permanent site knowledge. Reset demo clears it.</p>
          </div></Panel>
        </div>
      </details>
      <div className="min-w-0 space-y-5">
        {open ? <Panel className="border-brand/50"><PanelHeader title="Proposed plan change" note={`Created ${new Date(open.createdAt).toLocaleTimeString()} · planner run ${open.proposed.computeMs} ms`} actions={<Badge tone="brand">Waiting for Dispatcher</Badge>} /><div className="p-4"><ProposalReview proposal={open} /></div></Panel> : <EmptyState title="No plan change waiting">Open Simulate a scenario, reply in Buyer simulation, or report an issue from Rider.</EmptyState>}
        {proposals.some((p) => p.status !== "open") ? <Panel><PanelHeader title="Earlier plan changes" /><ul className="divide-y divide-line">{proposals.filter((p) => p.status !== "open").map((p) => <li key={p.id} className="p-4 text-sm"><details><summary className="cursor-pointer break-words"><span className="font-medium">{proposalStatusLabel(p)}</span> · {p.triggerText}</summary><div className="mt-3"><ProposalReview proposal={p} compact /></div></details></li>)}</ul></Panel> : null}
      </div>
    </div>
  </div>;
}
