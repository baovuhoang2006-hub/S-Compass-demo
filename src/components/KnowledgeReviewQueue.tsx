"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { decideCorrection, knowledgeReviewBlocker } from "@/lib/demoState";
import { conflictingReviews, reviewLabel } from "@/lib/knowledge";
import { useDemo } from "@/state/DemoProvider";

export function KnowledgeReviewQueue({ siteKeys, onOpen }: { siteKeys: string[]; onOpen: (key: string) => void }) {
  const { state, cards, update } = useDemo();
  const requests = state.corrections.filter((c) => siteKeys.includes(c.locationKey));
  const pending = requests.filter((c) => c.status === "pending");
  const decided = requests.filter((c) => c.status !== "pending").slice().reverse();
  const dispatcher = state.role === "dispatcher";
  const time = (at?: string) => at ? new Date(at).toLocaleString() : "Not recorded (legacy demo)";
  return <Panel>
    <PanelHeader title={`Knowledge review (${pending.length})`} note="Human-reviewed updates for future plans" />
    <div className="border-b border-line px-4 py-3 text-xs text-ink-soft">
      {dispatcher ? "Approve or reject reports below. Dispatched routes and buyer windows stay unchanged." : "Reports are pending until a Dispatcher reviews them. Switch the demo role to review."}
      <p className="mt-1">Prototype roles · this browser only · no real field verification or model retraining.</p>
    </div>
    {pending.length ? <ul className="divide-y divide-line">{pending.map((c) => {
      const blocker = knowledgeReviewBlocker(state, c);
      return <li key={c.id} data-review-id={c.id} className="space-y-2 break-words px-4 py-4 text-sm">
        <button className="text-left font-semibold text-info hover:underline" onClick={() => onOpen(c.locationKey)}>{cards[c.locationKey]?.name ?? c.locationKey}</button>
        <p className="font-medium">{reviewLabel(c.field)} · Pending</p>
        <p className="rounded-md bg-canvas p-2">{c.text}</p>
        {c.previousValue ? <details><summary className="cursor-pointer text-xs text-ink-soft">Existing value at submission</summary><p className="pt-1">{c.previousValue}</p></details> : null}
        <p className="text-xs text-ink-soft">From {c.proposedBy} · <time dateTime={c.createdAt || undefined}>{time(c.createdAt)}</time></p>
        <details className="text-xs text-ink-soft"><summary className="cursor-pointer">Evidence / provenance</summary><p className="break-all pt-1">{c.provenance ?? "Legacy browser correction; original provenance not recorded."}</p><p className="mt-1 break-all">Request ID: {c.id}</p></details>
        {c.field === "confirmation" ? <p className="text-xs text-warn">Approval verifies the currently displayed site instructions and dataset receiving rules for future plans. Inspect the full card first. This remains a demo review.</p> : null}
        {c.field === "receiving_window" ? <p className="text-xs text-warn">Approval adds this receiving rule to future plans; unrelated dataset suggestions stay unverified. Review existing rules in the card; buyer commitments are preserved.</p> : null}
        {c.field === "dispute" ? <p className="text-xs text-warn">Pending safety report: consult Dispatcher before following the disputed instruction. Approval marks the card Disputed; it does not replace its text or reroute a dispatched plan.</p> : null}
        {conflictingReviews(c, requests) ? <p className="text-xs text-warn">Conflicting proposals for this field. Compare their evidence before choosing; other requests may need a new observation.</p> : null}
        {blocker ? <p role="status" className="text-xs text-bad">{blocker}</p> : null}
        {dispatcher ? <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ok" disabled={!!blocker} onClick={() => update((s) => decideCorrection(s, c.id, true))}><Check />{c.field === "dispute" ? "Accept dispute" : "Approve"}</Button>
          <Button size="sm" variant="danger" onClick={() => update((s) => decideCorrection(s, c.id, false, "Rejected by Dispatcher in Site Knowledge"))}><X />Reject</Button>
          <Button size="sm" variant="ghost" onClick={() => onOpen(c.locationKey)}>Open card</Button>
        </div> : null}
      </li>;
    })}</ul> : <p className="px-4 py-5 text-sm text-ink-faint">Nothing to review. Rider confirmations, corrections and dispute reports appear here.</p>}
    {decided.length ? <details className="border-t border-line px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">Review history ({decided.length})</summary><ul className="mt-3 space-y-3">{decided.map((c) => <li key={c.id} className="break-words border-t border-line pt-2">
      <p className="font-medium">{cards[c.locationKey]?.name ?? c.locationKey} · {reviewLabel(c.field)}</p><p>{c.text}</p><p className={c.status === "approved" ? "text-ok" : "text-bad"}>{c.status} · {c.decidedBy ?? "Not recorded"} · {time(c.decidedAt)}</p>{c.note ? <p>{c.note}</p> : null}
    </li>)}</ul></details> : null}
  </Panel>;
}
