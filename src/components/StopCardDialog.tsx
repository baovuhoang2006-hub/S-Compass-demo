"use client";

import { Check, DoorOpen, MapPin, Timer, TriangleAlert } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import { knowledgeByKey } from "@/lib/data";
import { pct } from "@/lib/utils";
import { CardStatusBadge, SourceTag, TYPE_LABEL } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { disputeCard, openCard, suggestCorrection, verifyCard } from "@/lib/demoState";
import { RESTRICTION_PRESETS, reviewLabel, type CorrectionField } from "@/lib/knowledge";
import { BLOCKS } from "@/lib/time";
import type { WindowRestriction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

export function StopCardDialog({
  cardKey,
  stopId,
  open,
  onOpenChange,
  from,
}: {
  cardKey: string | null;
  stopId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  from: string;
}) {
  const { state, update, cards, shift } = useDemo();
  const logged = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (open && cardKey && logged.current !== cardKey) {
      logged.current = cardKey;
      update((s) => openCard(s, cardKey, from));
    }
    if (!open) logged.current = null;
  }, [open, cardKey, from, update]);

  if (!cardKey) return null;
  const card = cards[cardKey];
  const stop = stopId ? shift.stops.find((s) => s.id === stopId) : undefined;
  const pending = state.corrections.filter((c) => c.locationKey === cardKey && c.status === "pending");
  const overlay = state.overlays[cardKey];
  const isDispatcher = state.role === "dispatcher";
  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={card.name} description={`${TYPE_LABEL[card.type]} · Location ID: ${card.key}${stop ? ` · Stop ${stop.id}` : ""}`} wide className="sm:max-h-[88vh]">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <CardStatusBadge status={card.status} />
          <SourceTag kind={card.source.startsWith("Demo fixture") ? "fixture" : card.source.startsWith("Dataset") ? "dataset" : "live"} />

        </div>
        {pending.length ? <p role="status" className="mb-3 rounded-md bg-warn-tint p-3 text-sm text-warn">{pending.length} report(s) awaiting Dispatcher review. Official instructions remain unchanged.</p> : null}
        {pending.some((c) => c.field === "dispute") ? <p role="alert" className="mb-3 rounded-md bg-bad-tint p-3 text-sm text-bad">Potentially unsafe information reported. Consult Dispatcher before following the disputed instruction. Approved constraints and the dispatched plan have not changed.</p> : null}
        {card.status === "disputed" && overlay?.disputeReason ? <p className="mb-3 rounded-md bg-bad-tint p-3 text-sm text-bad">Disputed: {overlay.disputeReason}</p> : null}
        {card.temporaryClosure ? <div role="status" className="mb-4 flex gap-2 rounded-lg bg-bad-tint p-3 text-sm text-bad"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{card.temporaryClosure.text}</div> : null}

        <h3 className="mb-3 font-semibold">Delivery Instructions</h3>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <section className="space-y-4 rounded-lg border border-line p-4"><dl className="space-y-4">
            <Row icon={<DoorOpen />} label="Entrance"><p className="font-medium">{card.entrance}</p>{card.alternateEntrance ? <p className="mt-1 text-ink-soft">Alternate entrance: {card.alternateEntrance}</p> : null}</Row>
            <Row icon={<MapPin />} label="Handover point"><p>{card.handover}</p></Row>
          </dl></section>
          <section className="space-y-4 rounded-lg border border-line p-4">
            <div><h4 className="mb-2 font-semibold">Receiving windows &amp; rules</h4>
              {card.receivingWindows.length || card.restrictions.length ? <ul className="space-y-2">{card.receivingWindows.map((text) => {
                const restriction = card.restrictions.find((r) => r.text === text);
                return <li key={text}><p>{text}</p>{restriction ? <span className={cn("text-xs font-medium", restriction.strength === "hard" ? "text-ok" : "text-warn")}>{restriction.strength === "hard" ? "Verified rule" : "Unverified recommendation"}</span> : null}</li>;
              })}{card.restrictions.filter((r) => !card.receivingWindows.includes(r.text)).map((r) => <li key={r.code + r.text}><p>{r.text}</p><span className={cn("text-xs font-medium", r.strength === "hard" ? "text-ok" : "text-warn")}>{r.strength === "hard" ? "Verified rule" : "Unverified recommendation"}</span></li>)}</ul> : <p className="text-ink-soft">No receiving window recorded.</p>}
            </div>
            <div><h4 className="mb-1 font-semibold">Access restrictions</h4>{card.access.length ? <ul className="list-disc space-y-1 pl-5">{card.access.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="text-ink-soft">No access restriction recorded.</p>}</div>
          </section>
        </div>
        {card.pastIssues.length ? <section className="mt-4 rounded-lg bg-canvas/70 p-3 text-sm"><h4 className="mb-1 font-semibold">Past delivery issues</h4><ul className="list-disc space-y-1 pl-5 text-ink-soft">{card.pastIssues.slice(0, 3).map((issue) => <li key={issue.text}>{issue.text}</li>)}</ul><p className="mt-2 text-xs text-ink-faint">Full issue counts and supporting history are in Advanced Details.</p></section> : null}

        {pending.length ? <section className="mt-4 rounded-lg border border-warn/40 p-3"><h3 className="mb-2 font-semibold">Awaiting review</h3><ul className="space-y-2 text-sm">{pending.map((c) => <li key={c.id}><b>{reviewLabel(c.field)}</b>: {c.text}<p className="text-xs text-ink-soft">{c.proposedBy} · {c.createdAt ? new Date(c.createdAt).toLocaleString() : "Submission time not recorded"}</p></li>)}</ul></section> : null}
        <section className="mt-4 border-t border-line pt-4"><h3 className="mb-3 font-semibold">{isDispatcher ? "Dispatcher review" : "Rider actions"}</h3>
          {state.role === "rider" ? <CardActions key={cardKey} cardKey={cardKey} /> : isDispatcher ? <div className="text-sm text-ink-soft"><p>Approve or reject requests in the Site Knowledge review queue. No changes are applied from this dialog.</p>{from === "site knowledge" ? <Button className="mt-2" variant="outline" onClick={() => onOpenChange(false)}>Return to review queue</Button> : <Link className="mt-2 inline-block text-info underline" href="/stops" onClick={() => onOpenChange(false)}>Go to Site Knowledge</Link>}</div> : <p className="text-sm text-ink-soft">Read-only. Use Rider to submit observations or Dispatcher to review them.</p>}
        </section>

        <details className="ui-disclosure mt-5 rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-medium">Advanced Details</summary>
          <div className="space-y-4 pt-4 text-sm">
            <section><h4 className="mb-2 font-semibold">Data Source &amp; Verification</h4><p className="text-ink-soft">{card.source}</p><dl className="mt-2 space-y-2 text-xs">
              <div><dt className="font-medium">Latest verification record</dt><dd className="text-ink-soft">{card.lastVerified ?? "Not verified"}{card.verifiedBy ? ` by ${card.verifiedBy}` : ""} · Status: {card.status}</dd></div>
              <div><dt className="font-medium">Entrance evidence</dt><dd className="text-ink-soft">{card.entranceSource}</dd></div>
              {card.entrancePoint ? <div><dt className="font-medium">Anonymized entrance coordinates</dt><dd className="text-ink-soft">{card.entrancePoint.join(", ")}</dd></div> : null}
              {card.pinSpreadMeters !== null ? <div><dt className="font-medium">Dataset pin spread</dt><dd className="text-ink-soft">{card.pinSpreadMeters} m</dd></div> : null}
            </dl><p className="mt-2 text-xs text-ink-faint">Latest review is shown here; individual rules retain their own hard/soft status. A field correction does not verify unrelated dataset rules. Review actions are recorded in Evidence.</p></section>
            <section><h4 className="mb-2 font-semibold">Rules &amp; supporting evidence</h4>{card.restrictions.length ? <ul className="space-y-2 text-ink-soft">{card.restrictions.map((r) => <li key={r.code + r.text}><p>{r.text}</p><p className="text-xs">{r.strength === "hard" ? "Verified rule — planner must respect" : "Unverified recommendation — planner prefers"} · {r.source}</p></li>)}</ul> : <p className="text-ink-soft">No rule evidence recorded.</p>}<p className="mt-2 text-xs text-ink-faint">Verification applies to the next plan. Existing dispatched routes and buyer commitments are preserved.</p></section>
            <section><dl><Row icon={<Timer />} label="Estimated service time"><p>{stop?.serviceMinutes ?? card.serviceMinutes ?? "—"} min <span className="text-xs text-ink-soft">{stop?.serviceMinutes != null ? "(this order's processing-time field)" : "(site median from dataset)"}</span></p></Row></dl></section>
            <section><h4 className="mb-2 font-semibold">Dataset overview</h4><p>{card.visits} dataset visits · first-attempt success {pct(knowledgeByKey[cardKey]?.firstAttemptSuccess ?? null)}</p></section>
            <section><h4 className="mb-2 font-semibold">Knowledge change history</h4>{state.corrections.filter((c) => c.locationKey === cardKey).length ? <ul className="space-y-2">{state.corrections.filter((c) => c.locationKey === cardKey).map((c) => <li key={c.id}><b>{reviewLabel(c.field)}</b> · {c.status}<p>{c.text}</p><p className="text-xs text-ink-soft">{c.proposedBy} · {c.createdAt || "Time not recorded"}{c.decidedAt ? ` · ${c.decidedBy}: ${c.decidedAt}` : ""}</p><p className="text-xs text-ink-soft">{c.provenance ?? "Legacy browser correction"}</p></li>)}</ul> : <p className="text-ink-soft">No review requests recorded in this browser.</p>}</section>
            <section><h4 className="mb-2 font-semibold">Historical Delivery Information</h4><table className="w-full text-xs"><thead className="text-ink-soft"><tr><th className="text-left font-normal">Block</th><th className="text-right font-normal">Weekday</th><th className="text-right font-normal">Weekend</th></tr></thead><tbody>{BLOCKS.map((b) => {const wd = card.windowHistory[`${b.id}|weekday`];const we = card.windowHistory[`${b.id}|weekend`];return <tr key={b.id}><td className="py-1">{b.label}</td><td className="text-right">{wd?.attempts ? `${wd.delivered}/${wd.attempts}` : "—"}</td><td className="text-right">{we?.attempts ? `${we.delivered}/${we.attempts}` : "—"}</td></tr>;})}</tbody></table><p className="mt-2 text-xs text-ink-faint">Delivered/attempts. Dataset visits (Sep 2026) plus outcomes recorded in this demo.</p></section>
            <section><h4 className="mb-2 font-semibold">Full historical issue counts</h4>{card.pastIssues.length ? <ul className="space-y-1 text-ink-soft">{card.pastIssues.map((issue) => <li key={issue.text}>{issue.text} <span className="text-ink-faint">×{issue.count}</span></li>)}</ul> : <p className="text-ink-soft">No past issues recorded.</p>}</section>
          </div>
        </details>
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-ink-faint [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-ink-faint">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function CardActions({ cardKey }: { cardKey: string }) {
  const { state, update, cards } = useDemo();
  const [mode, setMode] = React.useState<"none" | "correct" | "dispute">("none");
  const [field, setField] = React.useState<CorrectionField>("entrance");
  const [text, setText] = React.useState("");
  const [preset, setPreset] = React.useState<WindowRestriction["code"]>("office_hours");
  const [reason, setReason] = React.useState("");
  const [done, setDone] = React.useState<string | null>(null);
  const confirmationPending = state.corrections.some((c) => c.locationKey === cardKey && c.field === "confirmation" && c.status === "pending");

  React.useEffect(() => {
    setDone(null);
  }, [cardKey]);

  const submit = () => {
    const value = field === "receiving_window" ? RESTRICTION_PRESETS.find((p) => p.code === preset)!.text : text.trim();
    if (!value) return;
    update((s) => suggestCorrection(s, cardKey, field, value, field === "receiving_window" ? preset : undefined));
    setDone("Correction sent. The card stays unchanged until a dispatcher approves it.");
    setMode("none");
    setText("");
  };

  return (
    <div>
      {done ? (
        <p role="status" className="mb-3 rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">
          {done}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="dark" onClick={() => setMode(mode === "correct" ? "none" : "correct")}>
          Suggest Correction
        </Button>
        <Button
          variant="outline"
          disabled={confirmationPending}
          onClick={() => {
            update((s) => verifyCard(s, cardKey));
            setDone("Your on-site confirmation is pending Dispatcher review. This is a browser demo report, not independent field evidence.");
          }}
        >
          <Check /> Confirm on site
        </Button>
        <Button variant="ghost" onClick={() => setMode(mode === "dispute" ? "none" : "dispute")}>
          Report disputed information
        </Button>
      </div>

      {mode === "correct" ? (
        <div className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="corr-field">What is wrong or missing?</Label>
            <Select id="corr-field" value={field} onChange={(e) => setField(e.target.value as CorrectionField)}>
              <option value="entrance">Entrance</option>
              <option value="handover">Handover instructions</option>
              <option value="access">Access restriction</option>
              <option value="receiving_window">Receiving window</option>
            </Select>
          </div>
          {field === "receiving_window" ? (
            <div>
              <Label htmlFor="corr-preset">Window rule</Label>
              <Select id="corr-preset" value={preset} onChange={(e) => setPreset(e.target.value as WindowRestriction["code"])}>
                {RESTRICTION_PRESETS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.text}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div>
              <Label htmlFor="corr-text">Correct information</Label>
              <Input
                id="corr-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={field === "entrance" ? "e.g. Use the side gate on the canal road" : field === "handover" ? "e.g. Leave with the guard, buyer collects at 12:00" : "e.g. Motorbikes must park outside"}
              />
            </div>
          )}
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="primary" onClick={submit} disabled={field !== "receiving_window" && !text.trim()}>
              Send correction for review
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "dispute" ? (
        <div className="mt-4 space-y-2 rounded-lg border border-line p-3">
          <Label htmlFor="dispute-reason">Why is this card wrong?</Label>
          <Textarea id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Side gate has been closed for repairs since Monday" />
          <div className="flex justify-end">
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => {
                update((s) => disputeCard(s, cardKey, reason.trim()));
                setMode("none");
                setReason("");
                setDone("Dispute sent for Dispatcher review. Official instructions and approved constraints are unchanged; consult Dispatcher before following the disputed instruction.");
              }}
            >
              Report disputed information
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
