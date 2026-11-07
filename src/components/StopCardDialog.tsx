"use client";

import { Check, DoorOpen, MapPin, ShieldAlert, Timer, TriangleAlert, X } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={card.name} description={`${TYPE_LABEL[card.type]} · stop knowledge card${stop ? ` · order ${stop.id}` : ""}`} wide>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CardStatusBadge status={card.status} />
          <span className="text-sm text-ink-faint">
            Last verified: <span className="text-ink">{card.lastVerified ?? "never"}</span>
            {card.verifiedBy ? ` by ${card.verifiedBy}` : ""}
          </span>
          {overlay?.verificationRequested && card.status !== "verified" ? <span className="text-sm text-warn">Rider confirmed on site — waiting for dispatcher</span> : null}
          {card.status === "disputed" && overlay?.disputeReason ? <span className="text-sm text-bad">Disputed: {overlay.disputeReason}</span> : null}
        </div>

        {card.temporaryClosure ? (
          <div role="status" className="mb-4 flex gap-2 rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {card.temporaryClosure.text}
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <dl className="space-y-4 text-sm">
            <Row icon={<DoorOpen />} label="Suggested entrance">
              <p className="font-medium">{card.entrance}</p>
              {card.alternateEntrance ? <p className="text-ink-soft">Alternate: {card.alternateEntrance}</p> : null}
              <p className="mt-1 text-xs text-ink-faint">{card.entranceSource}</p>
            </Row>
            <Row icon={<MapPin />} label="Handover instructions">
              <p>{card.handover}</p>
            </Row>
            <Row icon={<ShieldAlert />} label="Access restrictions">
              {card.access.length ? (
                <ul className="list-disc pl-4">
                  {card.access.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-faint">None recorded</p>
              )}
            </Row>
            <Row icon={<Timer />} label="Receiving windows">
              {card.restrictions.length || card.receivingWindows.length ? (
                <ul className="space-y-1">
                  {card.restrictions.map((r) => (
                    <li key={r.code + r.text}>
                      {r.text}{" "}
                      <span className={cn("text-xs", r.strength === "hard" ? "text-ok" : "text-warn")}>
                        {r.strength === "hard" ? "planner must respect" : "planner prefers (not yet verified)"}
                      </span>
                    </li>
                  ))}
                  {card.receivingWindows
                    .filter((w) => !card.restrictions.some((r) => r.text === w))
                    .map((w) => (
                      <li key={w} className="text-ink-soft">
                        {w} <span className="text-xs text-ink-faint">(information only)</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-ink-faint">No receiving window recorded</p>
              )}
            </Row>
            <Row icon={<Timer />} label="Estimated service time">
              <p>
                {stop?.serviceMinutes ?? card.serviceMinutes ?? "—"} min{" "}
                <span className="text-xs text-ink-faint">{stop?.serviceMinutes != null ? "(this order's processing-time field)" : "(site median from dataset)"}</span>
              </p>
            </Row>
          </dl>

          <aside className="space-y-3 text-sm">
            <div className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">Source</span>
                <SourceTag kind={card.source.startsWith("Demo fixture") ? "fixture" : card.source.startsWith("Dataset") ? "dataset" : "live"} />
              </div>
              <p className="text-ink-soft">{card.source}</p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 font-medium">Delivery history at this site</div>
              <table className="w-full text-xs">
                <thead className="text-ink-faint">
                  <tr>
                    <th className="text-left font-normal">Block</th>
                    <th className="text-right font-normal">Weekday</th>
                    <th className="text-right font-normal">Weekend</th>
                  </tr>
                </thead>
                <tbody>
                  {BLOCKS.map((b) => {
                    const wd = card.windowHistory[`${b.id}|weekday`];
                    const we = card.windowHistory[`${b.id}|weekend`];
                    return (
                      <tr key={b.id}>
                        <td className="py-0.5">{b.label}</td>
                        <td className="text-right">{wd?.attempts ? `${wd.delivered}/${wd.attempts}` : "—"}</td>
                        <td className="text-right">{we?.attempts ? `${we.delivered}/${we.attempts}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-ink-faint">Delivered/attempts. Dataset visits (Sep 2026) plus outcomes recorded in this demo.</p>
            </div>
            {card.pastIssues.length ? (
              <div className="rounded-lg border border-line p-3">
                <div className="mb-1 font-medium">Past issues noted by riders</div>
                <ul className="space-y-0.5 text-ink-soft">
                  {card.pastIssues.map((i) => (
                    <li key={i.text}>
                      {i.text} <span className="text-ink-faint">×{i.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>

        {pending.length ? (
          <div className="mt-5 rounded-lg border border-warn/40 bg-warn-tint/50 p-3">
            <p className="mb-2 text-sm font-medium">Corrections waiting for dispatcher review</p>
            <ul className="space-y-2">
              {pending.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{c.field.replace("_", " ")}</span>: {c.text} <span className="text-ink-faint">— {c.proposedBy}</span>
                  </span>
                  {isDispatcher ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="ok" onClick={() => update((s) => decideCorrection(s, c.id, true))}>
                        <Check /> Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => update((s) => decideCorrection(s, c.id, false, "Rejected in stop card"))}>
                        <X /> Reject
                      </Button>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">Switch demo role to Dispatcher to review</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <CardActions cardKey={cardKey} />
      </DialogContent>
    </Dialog>
  );
}

/** Compact in-context review used by Dispatcher; all decisions use the same state actions as the full Stop Cards page. */
export function InlineStopCardReview({ cardKey, stopId }: { cardKey: string; stopId: string }) {
  const { state, update, cards, shift } = useDemo();
  const card = cards[cardKey];
  const stop = shift.stops.find((item) => item.id === stopId);
  const pending = state.corrections.filter((item) => item.locationKey === cardKey && item.status === "pending");
  if (!card || !stop) return null;
  return <section className="border-t border-line bg-canvas/60 px-4 py-4" aria-label={`Stop Card review ${stopId}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Stop Card · {stopId} · {card.name}</h3><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint"><CardStatusBadge status={card.status} /><span>Nguồn: {card.source}</span><span>Đã xác minh: {card.lastVerified ?? "chưa xác minh"}{card.verifiedBy ? ` bởi ${card.verifiedBy}` : ""}</span></div></div>
    </div>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div><b>Cửa vào / bàn giao</b><p>{card.entrance} · {card.handover}</p><p className="text-xs text-ink-faint">Nguồn cửa vào: {card.entranceSource}</p></div>
      <div><b>Khung giờ và ảnh hưởng</b>{card.restrictions.length ? <ul className="list-inside list-disc">{card.restrictions.map((r) => <li key={`${r.code}:${r.text}`}><span className={r.strength === "hard" ? "text-ok" : "text-warn"}>{r.strength === "hard" ? "Ràng buộc bắt buộc" : "Khuyến nghị mềm"}</span>: {r.text} · {r.source}</li>)}</ul> : <p className="text-ink-faint">Chưa ghi nhận ràng buộc khung giờ.</p>}</div>
    </div>
    {pending.length ? <div className="mt-3 rounded-lg border border-warn/40 bg-warn-tint/50 p-3"><b className="text-sm">Đề xuất cần duyệt</b><ul className="mt-2 space-y-2">{pending.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{c.field.replace("_", " ")}: {c.text} — {c.proposedBy}</span><span className="flex gap-2"><Button size="sm" variant="ok" onClick={() => update((s) => decideCorrection(s, c.id, true))}><Check /> Duyệt</Button><Button size="sm" variant="danger" onClick={() => update((s) => decideCorrection(s, c.id, false, "Rejected in dispatcher Stop Card review"))}><X /> Từ chối</Button></span></li>)}</ul><p className="mt-2 text-xs text-ink-faint">Thông tin thay đổi sau khi người điều phối duyệt; chưa tự động áp dụng.</p></div> : null}
    <CardActions cardKey={cardKey} />
  </section>;
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
