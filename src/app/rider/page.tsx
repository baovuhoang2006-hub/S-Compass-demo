"use client";

import { CheckCircle2, ChevronDown, Clock, DoorOpen, FileText, Flag, MapPin, Navigation, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BlockTag, CardStatusBadge, ChanceText, EmptyState, SourceTag, TYPE_LABEL } from "@/components/bits";
import { PlanFollowUp, ProposalReview } from "@/components/ProposalReview";
import { StopCardDialog } from "@/components/StopCardDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label, Select, Textarea } from "@/components/ui/field";
import { riderOfShift } from "@/lib/data";
import { recordOutcome, reportEntranceClosed, reportOtherIssue } from "@/lib/demoState";
import { blockInfo, blockLabel, fmt } from "@/lib/time";
import type { PlannedStop } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

const FAIL_REASONS = [
  "Buyer not available",
  "Arrived outside the site's receiving window",
  "Could not find the entrance",
  "Guard would not accept the parcel",
  "COD payment not ready",
  "Other",
];

export default function RiderPage() {
  const { state, shift, cards, plan } = useDemo();
  const [card, setCard] = React.useState<{ key: string; stopId: string } | null>(null);
  const [outcomeFor, setOutcomeFor] = React.useState<PlannedStop | null>(null);
  const [issueFor, setIssueFor] = React.useState<PlannedStop | null>(null);
  const [showDone, setShowDone] = React.useState(false);
  const states = state.stopStates[shift.id];
  const stopById = Object.fromEntries(shift.stops.map((s) => [s.id, s]));
  const proposal = state.proposals.find((p) => p.status === "open" && p.previous.shiftId === shift.id);

  if (!plan) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState title="No plan dispatched yet" action={<Link href="/dispatcher" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">Go to dispatcher</Link>}>
          The rider sees the route once a dispatcher generates and dispatches a plan for the {shift.weekday} shift.
        </EmptyState>
      </div>
    );
  }

  const remaining = plan.stops.filter((s) => states[s.stopId]?.status === "pending");
  const done = plan.stops.filter((s) => ["delivered", "failed"].includes(states[s.stopId]?.status));
  const next = remaining.find((s) => !Number.isNaN(s.arriveMin));
  const later = remaining.filter((s) => s !== next);
  const nextStop = next ? stopById[next.stopId] : null;
  const nextCard = nextStop ? cards[nextStop.locationKey] : null;
  const nextBuyer = next ? states[next.stopId]?.buyer : undefined;
  const pickup = nextBuyer?.kind === "pickup" ? riderOfShift(shift).pickupPoints.find((p) => p.id === nextBuyer.pickupId) : undefined;
  const pendingDisputes = state.corrections.filter((c) => c.locationKey === nextStop?.locationKey && c.field === "dispute" && c.status === "pending");

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 break-words">
          <h1 className="text-lg font-semibold leading-6">{riderOfShift(shift).label}</h1>
          <p className="text-sm text-ink-faint">
            {riderOfShift(shift).zoneLabel} · {shift.weekday} {shift.date} · {done.length}/{plan.stops.length} done
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center gap-1 text-lg font-semibold">
            <Clock className="size-4 text-ink-faint" /> {fmt(state.clockMin[shift.id])}
          </div>
          <div className="text-[11px] text-ink-faint">simulated clock</div>
        </div>
      </div>

      <PlanFollowUp />
      {proposal ? (
        <div className="rounded-xl border-2 border-brand bg-surface">
          <div className="rounded-t-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white">Plan change proposed</div>
          <div className="p-4">
            <ProposalReview proposal={proposal} compact />
          </div>
        </div>
      ) : null}

      {next && nextStop && nextCard ? (
        <section data-rider-next className="overflow-hidden rounded-xl border border-line bg-surface" aria-labelledby="next-stop">
          <div className="flex items-start justify-between gap-3 bg-ink px-4 py-2.5 text-white">
            <h2 id="next-stop" className="shrink-0 text-xs font-semibold tracking-wide">NEXT DELIVERY · STOP #{next.seq}</h2>
            <span className="min-w-0 break-all text-right text-xs" aria-label="Order ID">{nextStop.id}</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="min-w-0 space-y-1">
              <h3 className="break-words text-2xl font-semibold leading-7">{nextCard.name}</h3>
              <p className="break-words text-sm"><span className="text-ink-soft">Recipient: </span>{nextStop.buyer}</p>
              <p className="text-xs text-ink-faint">{TYPE_LABEL[nextStop.locationType]} · {nextStop.parcel}{nextStop.isReattempt ? " · Re-attempt" : ""}</p>
              <p className="text-xs text-ink-faint">{next.pointSource === "pickup point" ? "Buyer-selected demo pickup point; no street navigation" : next.point ? "Anonymized position; street address not available" : "Location missing — ask Dispatcher before travelling"}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <BlockTag block={next.block} />
              <p><span className="font-semibold">ETA {fmt(next.arriveMin)}</span> <span className="text-xs text-ink-soft">(simulated)</span></p>
            </div>
            {nextBuyer?.kind === "confirmed" || nextBuyer?.kind === "changed" ? <p className="text-sm text-ok">Buyer confirmed: {blockLabel(nextBuyer.block)}</p> : null}
            <div className={cn("rounded-lg px-3 py-2 text-sm", nextStop.payment === "cod" ? "bg-warn-tint text-warn" : "bg-canvas text-ink-soft")}>
              <p className="font-semibold">{nextStop.payment === "cod" ? "COD · Collect cash" : "Prepaid"}</p>
              {nextStop.payment === "cod" ? <p className="mt-0.5 text-xs">Amount not provided in source data.</p> : null}
            </div>

            <div className="space-y-2 rounded-lg border border-line bg-canvas/50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-ink-soft">Site instructions</span><CardStatusBadge status={nextCard.status} /></div>
              <p className="text-xs text-ink-soft">{nextCard.status === "suggested" || nextCard.status === "unverified" ? "Not verified · dataset guidance" : nextCard.status === "disputed" ? "Disputed · consult Dispatcher" : nextCard.source.startsWith("Demo fixture") ? "Verified demo fixture · not a field inspection" : "Reviewed in demo · check each rule's status"}</p>
              <dl className="space-y-2">
                <div className="flex gap-2"><DoorOpen className="mt-0.5 size-4 shrink-0 text-ink-faint" /><div className="min-w-0"><dt className="text-xs text-ink-soft">Entrance</dt><dd className="break-words">{next.pointSource === "pickup point" ? `Deliver to ${pickup?.name ?? "the pickup point chosen by the buyer"}` : nextCard.entrance}</dd></div></div>
                <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" /><div className="min-w-0"><dt className="text-xs text-ink-soft">Handover</dt><dd className="break-words">{next.pointSource === "pickup point" ? "Follow the buyer's pickup arrangement; site handover instructions may not apply." : nextCard.handover}</dd></div></div>
              </dl>
              {nextCard.restrictions.length || nextCard.access.length || nextCard.receivingWindows.length ? <div className="border-t border-line pt-2">
                <p className="mb-1 text-xs font-medium text-ink-soft">Site access &amp; receiving rules{next.pointSource === "pickup point" ? " (original site)" : ""}</p>
                <ul className="space-y-1.5 break-words">
                  {nextCard.restrictions.filter((r) => r.code !== "temporary_closure").map((r) => <li key={r.code + r.text}>{r.text} <span className={cn("text-xs", r.strength === "hard" ? "text-ok" : "text-warn")}>· {r.strength === "hard" ? "Approved rule" : "Unverified suggestion"}</span></li>)}
                  {nextCard.receivingWindows.filter((text) => !nextCard.restrictions.some((r) => r.text === text)).map((text, i) => <li key={`window-${i}`}>{text} <span className="text-xs text-ink-soft">· Site note; see Stop Card for source</span></li>)}
                  {nextCard.access.map((text, i) => <li key={`${i}-${text}`}>{text}</li>)}
                </ul>
              </div> : null}
            </div>

            {nextCard.temporaryClosure ? <p role="alert" className="flex gap-2 rounded-lg bg-bad-tint p-3 text-sm text-bad"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span className="break-words">{nextCard.temporaryClosure.text}</span></p> : null}
            {nextCard.status === "disputed" || pendingDisputes.length ? <div role="alert" className="rounded-lg bg-bad-tint p-3 text-sm text-bad"><p className="font-medium">Site information disputed — consult Dispatcher before following it.</p>{pendingDisputes.map((c) => <p key={c.id} className="mt-1 break-words">Pending review: {c.text}</p>)}{state.overlays[nextCard.key]?.disputeReason ? <p className="mt-1 break-words">{state.overlays[nextCard.key].disputeReason}</p> : null}</div> : null}
            {next.flags.length ? <ul aria-label="Delivery warnings" className="space-y-2">{next.flags.map((f) => <li key={f} className="flex gap-2 rounded-lg bg-bad-tint p-3 text-sm text-bad"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span className="break-words">{f}</span></li>)}</ul> : null}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-auto min-h-11 px-2 py-2" onClick={() => setCard({ key: nextStop.locationKey, stopId: next.stopId })}><FileText /> Open Stop Card</Button>
              <Button variant="outline" className="h-auto min-h-11 px-2 py-2" onClick={() => setIssueFor(next)}><Flag /> Report Issue</Button>
              <Button variant="primary" className="col-span-2 min-h-12" onClick={() => setOutcomeFor(next)}><CheckCircle2 /> Record Delivery Outcome</Button>
            </div>
            <details key={next.stopId} className="rounded-lg border border-line p-3">
              <summary className="-m-3 min-h-11 cursor-pointer p-3 text-sm font-medium">Why this stop?</summary>
              <div className="mt-3 space-y-2 text-sm text-ink-soft">
                <p>Estimated chance: <ChanceText p={next.p} /></p>
                <p className="text-xs">History-table estimate (simulated), not a guaranteed result. Model predictions, when used, are reported separately in Dispatcher comparison.</p>
                <ul className="list-disc space-y-1 break-words pl-5">{next.reasons.map((r, i) => <li key={`${i}-${r}`}>{r}</li>)}</ul>
              </div>
            </details>
          </div>
        </section>
      ) : (
        <EmptyState title={remaining.length ? "Remaining stops need the dispatcher" : "All stops done for this shift"}>
          {remaining.length ? "The stops left are not scheduled (for example, a closed site). The dispatcher decides what happens next." : "Outcomes are saved in the evidence log and in each stop card's history."}
        </EmptyState>
      )}

      {later.length ? (
        <section aria-labelledby="later" className="rounded-xl border border-line bg-surface">
          <h2 id="later" className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            Then ({later.length})
          </h2>
          <ol>
            {later.map((s) => {
              const st = stopById[s.stopId];
              const c = cards[st.locationKey];
              const unscheduled = Number.isNaN(s.arriveMin);
              return (
                <li key={s.stopId} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0">
                  <span className="w-6 text-right text-sm text-ink-faint">{s.seq}</span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setCard({ key: st.locationKey, stopId: s.stopId })}>
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {s.stopId} · {st.payment === "cod" ? "COD" : "prepaid"}
                      {s.pointSource === "pickup point" ? " · pickup point" : ""}
                    </span>
                  </button>
                  {unscheduled ? (
                    <Badge tone="bad">Dispatcher</Badge>
                  ) : (
                    <span className="text-right text-xs">
                      <span className="block font-medium">{fmt(s.arriveMin)}</span>
                      <span className="text-ink-faint">{blockInfo(s.block).label.toLowerCase()}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {done.length ? (
        <section className="rounded-xl border border-line bg-surface">
          <button className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            Completed ({done.length}) <ChevronDown className={cn("size-4 transition-transform", showDone && "rotate-180")} />
          </button>
          {showDone ? (
            <ul className="border-t border-line">
              {done.map((s) => (
                <li key={s.stopId} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    {s.stopId} · {cards[stopById[s.stopId].locationKey].name}
                  </span>
                  <Badge tone={states[s.stopId].status === "delivered" ? "ok" : "bad"}>{states[s.stopId].status}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-ink-faint">
        <Navigation className="size-3.5" /> Times are simulated from the plan. <SourceTag kind="simulated" />
      </p>

      <StopCardDialog cardKey={card?.key ?? null} stopId={card?.stopId} open={!!card} onOpenChange={(o) => !o && setCard(null)} from="rider screen" />
      <OutcomeDialog stop={outcomeFor} onClose={() => setOutcomeFor(null)} />
      <IssueDialog stop={issueFor} onClose={() => setIssueFor(null)} onCorrection={(key, id) => setCard({ key, stopId: id })} />
    </div>
  );
}

function OutcomeDialog({ stop, onClose }: { stop: PlannedStop | null; onClose: () => void }) {
  const { update } = useDemo();
  const [result, setResult] = React.useState<"delivered" | "failed">("delivered");
  const [reason, setReason] = React.useState(FAIL_REASONS[0]);
  React.useEffect(() => {
    setResult("delivered");
    setReason(FAIL_REASONS[0]);
  }, [stop]);
  if (!stop) return null;
  return (
    <Dialog open={!!stop} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Record outcome for ${stop.stopId}`} description="This fixes the stop in later plans and adds the result to the site's history.">
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Outcome</legend>
          {(["delivered", "failed"] as const).map((r) => (
            <label key={r} className={cn("cursor-pointer rounded-lg border p-3 text-center text-sm font-medium focus-within:ring-2 focus-within:ring-info", result === r ? (r === "delivered" ? "border-ok bg-ok-tint text-ok" : "border-bad bg-bad-tint text-bad") : "border-line")}>
              <input type="radio" name="outcome" className="sr-only" checked={result === r} onChange={() => setResult(r)} />
              {r === "delivered" ? "Delivered" : "Not delivered"}
            </label>
          ))}
        </fieldset>
        {result === "failed" ? (
          <div className="mt-3">
            <Label htmlFor="fail-reason">Reason</Label>
            <Select id="fail-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {FAIL_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-ink-faint">The parcel stays with the rider for a later attempt; it is not re-added to today&apos;s route automatically.</p>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              update((s) => recordOutcome(s, stop.stopId, result, result === "failed" ? reason : undefined));
              onClose();
            }}
          >
            Save outcome
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ stop, onClose, onCorrection }: { stop: PlannedStop | null; onClose: () => void; onCorrection: (key: string, stopId: string) => void }) {
  const { update, shift, cards } = useDemo();
  const [kind, setKind] = React.useState<"closed" | "wrong" | "other">("closed");
  const [duration, setDuration] = React.useState<"alt" | "1300" | "rest">("1300");
  const [text, setText] = React.useState("");
  if (!stop) return null;
  const st = shift.stops.find((s) => s.id === stop.stopId)!;
  const card = cards[st.locationKey];
  return (
    <Dialog open={!!stop} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Report an issue at ${card.name}`} description={`Order ${stop.stopId}`}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="issue-kind">What happened?</Label>
            <Select id="issue-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="closed">Entrance temporarily unavailable</option>
              <option value="wrong">Entrance or handover information is wrong</option>
              <option value="other">Something else</option>
            </Select>
          </div>
          {kind === "closed" ? (
            <div>
              <Label htmlFor="issue-duration">How long?</Label>
              <Select id="issue-duration" value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
                {card.alternateEntrance ? <option value="alt">Use the alternate entrance ({card.alternateEntrance})</option> : null}
                <option value="1300">Closed until 13:00</option>
                <option value="rest">Closed for the rest of the shift</option>
              </Select>
              <p className="mt-2 text-xs text-ink-faint">This creates a replanning proposal. Nothing changes until it is accepted.</p>
            </div>
          ) : null}
          {kind === "other" ? (
            <div>
              <Label htmlFor="issue-text">Describe it</Label>
              <Textarea id="issue-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Heavy rain, road flooded near the factory" />
            </div>
          ) : null}
          {kind === "wrong" ? <p className="text-sm text-ink-soft">Open the stop card and use Suggest correction. A dispatcher reviews it before the card changes.</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={kind === "other" && !text.trim()}
            onClick={() => {
              if (kind === "closed") update((s) => reportEntranceClosed(s, stop.stopId, duration === "rest" || duration === "alt" ? null : 13 * 60, duration === "alt"));
              if (kind === "other") update((s) => reportOtherIssue(s, stop.stopId, text.trim()));
              if (kind === "wrong") onCorrection(st.locationKey, stop.stopId);
              onClose();
            }}
          >
            {kind === "wrong" ? "Open stop card" : "Send report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
