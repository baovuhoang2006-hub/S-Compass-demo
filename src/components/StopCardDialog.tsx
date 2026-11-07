"use client";

import { Check, DoorOpen, MapPin, Timer, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { CardStatusBadge, SourceTag, TYPE_LABEL } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { decideCorrection, disputeCard, openCard, suggestCorrection, verifyCard } from "@/lib/demoState";
import { RESTRICTION_PRESETS, type CorrectionField } from "@/lib/knowledge";
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
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  React.useEffect(() => {
    setActionNotice(null);
  }, [cardKey]);

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
      <DialogContent title="Stop Card Details" description={`${card.name} · ${TYPE_LABEL[card.type]}${stop ? ` · Stop ${stop.id}` : ""}`} wide className="sm:max-h-[88vh]">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CardStatusBadge status={card.status} />
          <span className="text-sm text-ink-faint">{card.name}{stop ? ` · Stop ${stop.id}` : ""}</span>
          {overlay?.verificationRequested && card.status !== "verified" ? <span className="text-sm text-warn">Rider confirmed on site — waiting for dispatcher review.</span> : null}
          {card.status === "disputed" && overlay?.disputeReason ? <span className="text-sm text-bad">Disputed: {overlay.disputeReason}</span> : null}
        </div>
        {card.temporaryClosure ? (
          <div role="status" className="mb-4 flex gap-2 rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {card.temporaryClosure.text}
          </div>
        ) : null}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
          <div className="space-y-4 text-sm">
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Location &amp; Entrance</h3><p className="font-medium">{card.name} · {TYPE_LABEL[card.type]}</p>{stop ? <p className="text-xs text-ink-faint">Stop {stop.id}</p> : null}<Row icon={<DoorOpen />} label="Suggested entrance"><p className="font-medium">{card.entrance}</p>{card.alternateEntrance ? <p className="text-ink-soft">Alternate: {card.alternateEntrance}</p> : null}<p className="mt-1 text-xs text-ink-faint">{card.entranceSource}</p></Row><Row icon={<Timer />} label="Estimated service time"><p>{stop?.serviceMinutes ?? card.serviceMinutes ?? "—"} min <span className="text-xs text-ink-faint">{stop?.serviceMinutes != null ? "(this order's processing-time field)" : "(site median from dataset)"}</span></p></Row></section>
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Handover Instructions</h3><Row icon={<MapPin />} label="Instructions"><p>{card.handover}</p></Row></section>
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Receiving Windows</h3>{card.receivingWindows.length ? <ul className="list-disc space-y-1 pl-5">{card.receivingWindows.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="text-ink-faint">No receiving window recorded.</p>}</section>
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Rules &amp; Restrictions</h3>{card.restrictions.length ? <ul className="space-y-1">{card.restrictions.map((r) => <li key={r.code + r.text}><span className={cn("font-medium", r.strength === "hard" ? "text-ok" : "text-warn")}>{r.strength === "hard" ? "Verified rule — planner must respect" : "Unverified recommendation — planner prefers"}</span>: {r.text} <span className="text-xs text-ink-faint">({r.source})</span></li>)}</ul> : <p className="text-ink-faint">No rules recorded.</p>}{card.access.length ? <div className="mt-2"><b>Access restrictions</b><ul className="list-disc pl-5">{card.access.map((a) => <li key={a}>{a}</li>)}</ul></div> : null}<p className="mt-2 text-xs text-ink-faint">Verified rules constrain a new plan. Unverified suggestions are preferences only.</p></section>
          </div>

          <aside className="space-y-4 text-sm">
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Data Source &amp; Verification</h3><div className="flex flex-wrap items-center gap-2"><CardStatusBadge status={card.status} /><SourceTag kind={card.source.startsWith("Demo fixture") ? "fixture" : card.source.startsWith("Dataset") ? "dataset" : "live"} /></div><p className="mt-2 text-ink-soft">{card.source}</p><dl className="mt-2 space-y-1 text-xs"><div><dt className="inline text-ink-faint">Last verified: </dt><dd className="inline">{card.lastVerified ?? "Not verified"}{card.verifiedBy ? ` by ${card.verifiedBy}` : ""}</dd></div><div><dt className="inline text-ink-faint">Entrance source: </dt><dd className="inline">{card.entranceSource}</dd></div></dl></section>
            <section className="rounded-lg border border-line p-3"><h3 className="mb-2 font-semibold">Historical Delivery Information</h3><table className="w-full text-xs"><thead className="text-ink-faint"><tr><th className="text-left font-normal">Block</th><th className="text-right font-normal">Weekday</th><th className="text-right font-normal">Weekend</th></tr></thead><tbody>{BLOCKS.map((b) => {const wd = card.windowHistory[`${b.id}|weekday`];const we = card.windowHistory[`${b.id}|weekend`];return <tr key={b.id}><td className="py-0.5">{b.label}</td><td className="text-right">{wd?.attempts ? `${wd.delivered}/${wd.attempts}` : "—"}</td><td className="text-right">{we?.attempts ? `${we.delivered}/${we.attempts}` : "—"}</td></tr>;})}</tbody></table><p className="mt-2 text-[11px] text-ink-faint">Delivered/attempts. Dataset visits (Sep 2026) plus outcomes recorded in this demo.</p>{card.pastIssues.length ? <div className="mt-3"><b>Past issues noted by riders</b><ul className="mt-1 space-y-0.5 text-ink-soft">{card.pastIssues.map((i) => <li key={i.text}>{i.text} <span className="text-ink-faint">×{i.count}</span></li>)}</ul></div> : null}</section>
          </aside>
        </div>

        <section className="mt-4 rounded-lg border border-warn/40 bg-warn-tint/30 p-3"><h3 className="mb-2 font-semibold">Pending Corrections</h3>{pending.length ? <ul className="space-y-2">{pending.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b>{c.field.replace("_", " ")}</b>: {c.text} <span className="text-ink-faint">— {c.proposedBy}</span></span>{isDispatcher ? <span className="flex gap-2"><Button size="sm" variant="ok" onClick={() => {update((s) => decideCorrection(s, c.id, true));setActionNotice("Correction approved. Review and generate a new plan before dispatch; the current dispatched route and buyer commitments are unchanged.");}}><Check /> Approve</Button><Button size="sm" variant="danger" onClick={() => {update((s) => decideCorrection(s, c.id, false, "Rejected in stop card"));setActionNotice("Correction rejected. The card and active plan remain unchanged.");}}><X /> Reject</Button></span> : <span className="text-xs text-ink-faint">Switch demo role to Dispatcher to review.</span>}</li>)}</ul> : <p className="text-sm text-ink-faint">No pending corrections.</p>}</section>
        {actionNotice ? <p role="status" className="mt-3 rounded-lg bg-info-tint px-3 py-2 text-sm text-info">{actionNotice}</p> : null}
        <section className="mt-4 border-t border-line pt-4"><h3 className="mb-3 font-semibold">Dispatcher Actions</h3><CardActions cardKey={cardKey} /></section>
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
  const card = cards[cardKey];
  const [mode, setMode] = React.useState<"none" | "correct" | "dispute">("none");
  const [field, setField] = React.useState<CorrectionField>("entrance");
  const [text, setText] = React.useState("");
  const [preset, setPreset] = React.useState<WindowRestriction["code"]>("office_hours");
  const [reason, setReason] = React.useState("");
  const [done, setDone] = React.useState<string | null>(null);
  const isDispatcher = state.role === "dispatcher";

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
    <div className="mt-5 border-t border-line pt-4">
      {done ? (
        <p role="status" className="mb-3 rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">
          {done}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="dark" onClick={() => setMode(mode === "correct" ? "none" : "correct")}>
          Suggest correction
        </Button>
        <Button
          variant="outline"
          disabled={card.status === "verified" && !card.temporaryClosure}
          onClick={() => {
            update((s) => verifyCard(s, cardKey));
            setDone(isDispatcher ? "Card verified. Its receiving windows are now hard rules for the next plan." : "Thanks. Your on-site confirmation is waiting for dispatcher approval.");
          }}
        >
          <Check /> {isDispatcher ? "Verify information" : "Confirm on site"}
        </Button>
        <Button variant="ghost" onClick={() => setMode(mode === "dispute" ? "none" : "dispute")}>
          Mark as disputed
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
                setDone("Card marked as disputed. Its restrictions are treated as soft until a dispatcher resolves it.");
              }}
            >
              Mark as disputed
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
