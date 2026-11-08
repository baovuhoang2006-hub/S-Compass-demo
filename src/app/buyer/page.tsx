"use client";

import { CalendarCheck, CalendarClock, MessageSquareOff, Send, Store } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BlockTag, ChanceText, TYPE_LABEL } from "@/components/bits";
import { PlanFollowUp, ProposalReview } from "@/components/ProposalReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { riderOfShift } from "@/lib/data";
import { buyerChange, buyerConfirm, buyerNoResponse, buyerPickup, confirmEligibility, feasibleBuyerBlocks, inviteBuyer } from "@/lib/demoState";
import { planSiteLabel } from "@/lib/replan";
import { BLOCKS, blockLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

export default function BuyerPage() {
  const { state, update, shift, cards, plan } = useDemo();
  const shown = plan ?? (state.draftPlan?.shiftId === shift.id ? state.draftPlan : null);
  const states = state.stopStates[shift.id];
  const pendingStops = shift.stops.filter((s) => states[s.id].status === "pending");
  const withWhy = pendingStops.map((s) => ({ s, why: confirmEligibility(s.id, state) }));
  const eligible = withWhy.filter((x) => x.why.length);
  const others = withWhy.filter((x) => !x.why.length);
  const [sel, setSel] = React.useState<string>(eligible[0]?.s.id ?? pendingStops[0]?.id ?? "");
  const stop = pendingStops.find((s) => s.id === sel) ?? pendingStops[0];
  const selectedId = stop?.id ?? "";
  const ps = shown?.stops.find((x) => x.stopId === selectedId);
  const buyer = stop ? states[stop.id].buyer : null;
  const msgs = state.messages.filter((m) => m.stopId === selectedId);
  const card = stop ? cards[stop.locationKey] : null;
  const proposal = state.proposals.find((p) => p.status === "open" && p.previous.shiftId === shift.id && "stopId" in p.trigger && p.trigger.stopId === selectedId);
  const lastProposal = [...state.proposals].reverse().find((p) => p.previous.shiftId === shift.id && "stopId" in p.trigger && p.trigger.stopId === selectedId);

  const feasible = stop ? feasibleBuyerBlocks(state, stop.id) : [];
  const offered = ps && Number.isFinite(ps.arriveMin) ? ps.block : feasible[0];
  const pickupPoints = riderOfShift(shift).pickupPoints.filter((p) => Array.isArray(p.pos) && p.pos.length === 2 && p.pos.every(Number.isFinite));
  const pickupChoices = stop ? pickupPoints.length ? pickupPoints.map((p) => (
    <Button key={p.id} variant="outline" className="h-auto min-h-10 w-full justify-start py-2 text-left" onClick={() => update((s) => buyerPickup(s, stop.id, p.id))}>
      <Store /> Collect at {p.name.replace(" (demo pickup point)", "")} ({p.hours || "Hours not recorded"})
    </Button>
  )) : <p className="text-xs text-warn">No valid pickup points configured for this rider.</p> : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warn/40 bg-warn-tint px-4 py-2 text-sm text-warn">
        Demo interaction: you act as the buyer. Messages are simulated inside this page; no SMS, e-mail or payment request is sent.
      </div>
      <PlanFollowUp />
      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Choose a demo order" note="Buyer Confirm targets risky orders first (rule shown under each order)" />
          <div className="max-h-[620px] overflow-y-auto">
            <OrderGroup title={`Eligible for Buyer Confirm (${eligible.length})`} items={eligible} sel={selectedId} setSel={setSel} />
            <OrderGroup title={`Other pending orders (${others.length})`} items={others} sel={selectedId} setSel={setSel} />
          </div>
        </Panel>

        {stop && card && buyer ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <section aria-label="Buyer phone" className="mx-auto w-full max-w-sm overflow-hidden rounded-[28px] border-8 border-ink bg-surface shadow-lg">
              <div className="bg-brand px-4 py-3 text-white">
                <p className="text-sm font-semibold">Delivery update · {stop.buyer}</p>
                <p className="text-xs opacity-90">
                  Order {stop.id} · {shown ? "Planned destination" : "Site"}: {shown ? planSiteLabel(shown, stop.id, shift, cards, pickupPoints) : card.name}
                </p>
              </div>
              <div className="min-h-[260px] space-y-2 bg-canvas p-3">
                {msgs.length === 0 ? <p className="py-8 text-center text-xs text-ink-faint">No messages yet. Send the confirmation request below.</p> : null}
                {msgs.map((m) => (
                  <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.from === "Buyer" ? "ml-auto bg-brand text-white" : "bg-surface")}>
                    {m.text}
                    <div className={cn("mt-0.5 text-[10px]", m.from === "Buyer" ? "text-white/80" : "text-ink-faint")}>
                      {m.from} · {new Date(m.at).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 border-t border-line p-3">
                {buyer.kind === "none" || buyer.kind === "no_response" ? (
                  <Button variant="dark" className="w-full" disabled={!offered || !feasible.includes(offered)} onClick={() => offered && update((s) => inviteBuyer(s, stop.id, offered))}>
                    <Send /> Send confirmation request {offered ? `(${BLOCKS.find((b) => b.id === offered)!.label.toLowerCase()})` : ""}
                  </Button>
                ) : null}
                {!feasible.length ? <p className="text-xs text-warn">No feasible receiving window is available. Ask Dispatcher to review site constraints; no window will be invented.</p> : null}
                {(buyer.kind === "none" || buyer.kind === "no_response") && !feasible.length ? pickupChoices : null}
                {buyer.kind === "invited" ? (
                  <>
                    <Button variant="primary" className="w-full" disabled={!feasible.includes(buyer.offeredBlock)} onClick={() => update((s) => buyerConfirm(s, stop.id, buyer.offeredBlock))}>
                      <CalendarCheck /> Confirm {blockLabel(buyer.offeredBlock)}
                    </Button>
                    <div className="grid grid-cols-1 gap-2">
                      {feasible
                        .filter((b) => b !== buyer.offeredBlock)
                        .map((b) => (
                          <Button key={b} onClick={() => update((s) => buyerChange(s, stop.id, b))}>
                            <CalendarClock /> Ask for {blockLabel(b)}
                          </Button>
                        ))}
                    </div>
                    {pickupChoices}
                    <Button variant="ghost" className="w-full" onClick={() => update((s) => buyerNoResponse(s, stop.id))}>
                      <MessageSquareOff /> Leave unanswered
                    </Button>
                  </>
                ) : null}
                {buyer.kind === "confirmed" || buyer.kind === "changed" || buyer.kind === "pickup" ? (
                  <p className="text-center text-sm text-ok">Reply received. See the effect on the rider&apos;s plan.</p>
                ) : null}
              </div>
            </section>

            <div className="space-y-4">
              <Panel>
                <PanelHeader title="This order" />
                <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-faint">Original site</dt>
                    <dd>
                      {card.name} <span className="text-ink-faint">({TYPE_LABEL[card.type]})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Payment</dt>
                    <dd>{stop.payment === "cod" ? "Cash on delivery" : "Prepaid"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Planned</dt>
                    <dd>{ps && Number.isFinite(ps.arriveMin) ? <BlockTag block={ps.block} eta={ps.arriveMin} /> : ps ? "Not scheduled" : "No plan yet"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Chance in planned block</dt>
                    <dd>{ps ? <ChanceText p={ps.p} /> : "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-ink-faint">Why eligible</dt>
                    <dd>{confirmEligibility(stop.id, state).join("; ") || "Not on the risk list (can still be invited in the demo)"}</dd>
                  </div>
                </dl>
              </Panel>
              <Panel>
                <PanelHeader title="Effect on the rider's plan" />
                <div className="px-4 py-3">
                  {proposal ? (
                    <ProposalReview proposal={proposal} compact />
                  ) : !plan ? (
                    <p className="text-sm text-ink-soft">
                      No plan is dispatched yet, so the reply is stored and used by the next generated plan.{" "}
                      <Link className="text-info underline" href="/dispatcher">
                        Go to dispatcher
                      </Link>
                    </p>
                  ) : buyer.kind === "confirmed" ? (
                    <p className="text-sm text-ink-soft">The buyer confirmed the planned window. The route does not change; the window is now a commitment the planner keeps.</p>
                  ) : buyer.kind === "no_response" ? (
                    <p className="text-sm text-ink-soft">No reply. The order stays in the plan as before and is not cancelled. The rider calls on arrival.</p>
                  ) : lastProposal ? (
                    <ProposalReview proposal={lastProposal} compact />
                  ) : (
                    <p className="text-sm text-ink-soft">Send a confirmation request, then answer as the buyer.</p>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No pending orders left in this shift.</p>
        )}
      </div>
    </div>
  );
}

function OrderGroup({
  title,
  items,
  sel,
  setSel,
}: {
  title: string;
  items: { s: { id: string; buyer: string; locationKey: string }; why: string[] }[];
  sel: string;
  setSel: (id: string) => void;
}) {
  const { cards, state, shift } = useDemo();
  if (!items.length) return null;
  return (
    <div>
      <p className="sticky top-0 bg-surface px-4 py-2 text-xs font-medium text-ink-faint">{title}</p>
      <ul>
        {items.map(({ s, why }) => {
          const b = state.stopStates[shift.id][s.id].buyer;
          return (
            <li key={s.id}>
              <button
                onClick={() => setSel(s.id)}
                aria-current={sel === s.id}
                className={cn("w-full border-l-4 px-4 py-2 text-left text-sm hover:bg-canvas", sel === s.id ? "border-brand bg-brand-tint/50" : "border-transparent")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {s.id} · {s.buyer}
                  </span>
                  {b.kind !== "none" ? <Badge tone={b.kind === "no_response" ? "neutral" : b.kind === "invited" ? "warn" : "ok"}>{b.kind.replace("_", " ")}</Badge> : null}
                </span>
                <span className="block text-xs text-ink-faint">{cards[s.locationKey].name}</span>
                {why.length ? <span className="block text-xs text-warn">{why.join(" · ")}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
