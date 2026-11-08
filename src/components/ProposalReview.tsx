"use client";

import { Check, Undo2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { decideProposal, proposalAcceptanceBlocker, unresolvedReplanWarnings } from "@/lib/demoState";
import { riderOfShift } from "@/lib/data";
import { planSiteLabel, proposalStatusLabel, type ReplanProposal } from "@/lib/replan";
import { fmt } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

export function PlanFollowUp() {
  const { state } = useDemo();
  const warnings = unresolvedReplanWarnings(state);
  return warnings.length ? <div role="alert" className="space-y-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm text-warn"><p className="font-semibold">Follow-up required — current plan was kept</p><ul className="list-disc space-y-1 break-words pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : null;
}

export function ProposalReview({ proposal, compact }: { proposal: ReplanProposal; compact?: boolean }) {
  const { state, update, cards, shift } = useDemo();
  const [overriding, setOverriding] = React.useState(false);
  const [note, setNote] = React.useState("");
  React.useEffect(() => { setOverriding(false); setNote(""); }, [proposal.id, state.role]);
  const pickups = riderOfShift(shift).pickupPoints;
  const changed = new Set(proposal.changes.map((c) => c.stopId));
  const target = "stopId" in proposal.trigger ? proposal.trigger.stopId : null;
  const open = proposal.status === "open";
  const dispatcher = state.role === "dispatcher";
  const blocker = open ? proposalAcceptanceBlocker(state, proposal) : null;
  const name = (plan: ReplanProposal["previous"], id: string) => planSiteLabel(plan, id, shift, cards, pickups);
  const eta = (plan: ReplanProposal["previous"], id: string) => {
    const p = plan.stops.find((s) => s.stopId === id);
    return p && Number.isFinite(p.arriveMin) ? fmt(p.arriveMin) : "Not scheduled";
  };
  const beforePos = target ? proposal.previousRemaining.indexOf(target) : -1;
  const afterPos = target ? proposal.proposedRemaining.indexOf(target) : -1;
  const pickup = target ? proposal.proposed.stops.find((s) => s.stopId === target)?.pointSource === "pickup point" : false;
  const risks = proposal.commitments.filter((r) => /AT RISK|capacity|latest/i.test(r));
  const seq = (ids: string[], plan: ReplanProposal["previous"], label: string) => <div className="min-w-0"><p className="mb-1 font-medium">{label}</p><ol className="space-y-1">{ids.map((id, i) => <li key={id} className={cn("flex items-start gap-2 rounded p-1", changed.has(id) && "bg-brand-tint")}><span className="w-5 shrink-0 text-right text-ink-faint">{i + 1}</span><span className="min-w-0 flex-1 break-words">{id} · {name(plan, id)}</span><span className="shrink-0 text-xs text-ink-faint">{eta(plan, id)}</span></li>)}</ol></div>;

  return <div className="space-y-3 break-words text-sm" data-proposal-id={proposal.id}>
    <div><p className="text-xs font-medium text-ink-faint">{proposal.demoEventId ? "Simulated event · demo operator" : "Buyer / Rider event"}</p><p className="font-medium">{proposal.triggerText}</p></div>
    {target ? <section aria-label="Change summary" className="rounded-lg border border-line p-3">
      <p className="mb-2 font-semibold">Order {target} · remaining route</p>
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-ink-faint">Before</p><p className="font-medium">{name(proposal.previous, target)}</p><p>Position {beforePos < 0 ? "—" : beforePos + 1}</p><p>ETA {eta(proposal.previous, target)}</p></div>
        <div><p className="text-xs text-ink-faint">Proposed{pickup ? " pickup destination" : ""}</p><p className="font-medium">{name(proposal.proposed, target)}</p><p>Position {afterPos < 0 ? "—" : afterPos + 1}</p><p>ETA {eta(proposal.proposed, target)}</p></div>
      </div>
      <p className="mt-2 text-xs text-ink-soft">Simulated ETAs · {proposal.changes.filter((c) => c.stopId !== target).length} other stops change destination, position, block or ETA by 15+ minutes.</p>
      {pickup ? <p className="mt-2 text-xs text-warn">Pickup success effect: not estimated (no data). No delivery improvement is assumed.</p> : null}
    </section> : null}
    {risks.length ? <ul role="alert" className="space-y-1 rounded-lg bg-bad-tint p-3 text-bad">{risks.map((r) => <li key={r}>{r}</li>)}</ul> : null}
    {blocker ? <p role="status" className="rounded-lg bg-warn-tint p-3 text-warn">Cannot accept: {blocker}</p> : null}
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-medium">{compact ? "Plan details, reasons & commitments" : "Previous / proposed sequences, reasons & commitments"}</summary>
      <div className="mt-3 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">{seq(proposal.previousRemaining, proposal.previous, "Previous remaining sequence")}{seq(proposal.proposedRemaining, proposal.proposed, "Proposed remaining sequence")}</div>
        <p className="text-xs text-ink-faint">Highlighted: stops whose destination, position or block changes, or whose ETA moves by 15 minutes or more.</p>
        <div><p className="font-medium">Why this plan is proposed</p><ul className="list-disc space-y-1 pl-5 text-ink-soft">{proposal.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        <div><p className="font-medium">Affected commitments</p><ul className="list-disc space-y-1 pl-5 text-ink-soft">{proposal.commitments.map((r, i) => <li key={i} className={r.includes("AT RISK") ? "text-bad" : undefined}>{r}</li>)}<li>No parcel moves to another rider. A transfer needs an explicit Dispatcher action.</li></ul></div>
        <p className="text-xs text-ink-faint">Proposal {proposal.id} · {new Date(proposal.createdAt).toLocaleString()}{proposal.decidedBy ? ` · ${proposal.decidedBy} · ${proposal.decidedAt}` : ""}</p>
      </div>
    </details>
    {open ? dispatcher ? overriding ? <div className="space-y-2">
      <Label htmlFor={`ov-${proposal.id}`}>Why keep the current plan?</Label><Textarea id={`ov-${proposal.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain follow-up with the buyer or rider; requests are not cancelled" />
      <p className="text-xs text-warn">Buyer commitments and closure reports remain active. Contact the buyer/rider and review unresolved warnings before continuing.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => setOverriding(false)}>Back</Button><Button variant="dark" disabled={!note.trim()} onClick={() => update((s) => decideProposal(s, proposal.id, false, note.trim()))}><Undo2 /> Keep current plan</Button></div>
    </div> : <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!!blocker} onClick={() => update((s) => decideProposal(s, proposal.id, true))}><Check /> Accept new plan</Button><Button onClick={() => setOverriding(true)}>Keep current plan and explain</Button></div> : <p role="status" className="rounded-lg bg-canvas p-3 text-ink-soft">Read-only · awaiting Dispatcher decision. Buyer and Rider cannot accept or keep a plan. Demo role is a prototype selector, not authentication.</p> : <p className={cn("font-medium", proposal.status === "accepted" ? "text-ok" : "text-ink-soft")}>{proposalStatusLabel(proposal)}{proposal.decisionNote ? `: ${proposal.decisionNote}` : ""}</p>}
  </div>;
}
