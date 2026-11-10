"use client";

import { ArrowLeftRight, BarChart3, Check, Info, Send, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PlanFollowUp } from "@/components/ProposalReview";
import { BlockTag, CardStatusBadge, ChanceText, EmptyState, MethodBadge, SourceTag, Stat, TYPE_LABEL } from "@/components/bits";
import { RouteMap } from "@/components/RouteMap";
import { ShiftRibbon } from "@/components/ShiftRibbon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { BACKUP_RIDER, fixtures, historical, riderOfShift } from "@/lib/data";
import { comparePlans, comparisonRunIdFor, dispatchPlan, draftDispatchBlocker, generateBestProposedPlan, planningInputSignature, useComparedDraft, selectRider, selectShift, transferParcel } from "@/lib/demoState";
import { metrics } from "@/lib/evidence";
import { onRoadMinutesPerParcel } from "@/lib/kpi";
import { METHOD_LABEL } from "@/lib/planner";
import { fmt } from "@/lib/time";
import type { Plan, PlannedStop } from "@/lib/types";
import { cn, pct } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

type Filter = "all" | "pending" | "risk" | "done";

function planInputSignature(plan: Plan) {
  return JSON.stringify({
    shiftId: plan.shiftId,
    startMin: plan.startMin,
    stops: plan.stops,
    totals: {
      stops: plan.totals.stops,
      scheduledStops: plan.totals.scheduledStops,
      onRoadMin: plan.totals.onRoadMin,
      endMin: plan.totals.endMin,
      lowChance: plan.totals.lowChance,
      flagged: plan.totals.flagged,
    },
  });
}

export default function DispatcherPage() {
  const { state, update, shift, cards, plan } = useDemo();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [justSent, setJustSent] = React.useState(false);
  const [transferStop, setTransferStop] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const deliveryTable = React.useRef<HTMLDivElement>(null);
  const selectDelivery = (stopId: string) => { setFilter("all"); setSelected(stopId); };
  React.useEffect(() => {
    const container = deliveryTable.current;
    const row = container?.querySelector<HTMLElement>(`[data-delivery-stop="${CSS.escape(selected ?? "")}"]`);
    if (container && row && (row.getBoundingClientRect().top < container.getBoundingClientRect().top + 40 || row.getBoundingClientRect().bottom > container.getBoundingClientRect().bottom)) container.scrollTo({
      top: container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - 40,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selected, filter]);

  const rider = riderOfShift(shift);
  const draft = state.draftPlan && state.draftPlan.shiftId === shift.id ? state.draftPlan : null;
  const shown: Plan | null = draft ?? plan;
  const states = state.stopStates[shift.id];
  const stopById = Object.fromEntries(shift.stops.map((s) => [s.id, s]));

  const isRisk = (ps: PlannedStop) => states[ps.stopId]?.status === "pending" && (ps.flags.length > 0 || (ps.p !== null && ps.p < 0.65));
  const pendingCount = shift.stops.filter((s) => states[s.id].status === "pending").length;
  const riskCount = shown ? shown.stops.filter(isRisk).length : 0;
  const doneCount = shift.stops.filter((s) => ["delivered", "failed"].includes(states[s.id].status)).length;
  const transferred = state.transfers.filter((t) => t.shiftId === shift.id);
  const m = metrics(state.events);
  const pendingCorrections = state.corrections.filter((c) => c.status === "pending");
  const openProposal = state.proposals.find((p) => p.status === "open" && p.previous.shiftId === shift.id);
  const dispatchBlockReason = draft ? draftDispatchBlocker(state, draft) : null;
  const generateProposedPlan = () => update(generateBestProposedPlan);
  const comparisonCurrent = state.comparisonMeta?.runId === comparisonRunIdFor(state) && state.comparisonMeta?.safetyRunId === planningInputSignature(state);
  const selection = state.planSelection?.shiftId === shift.id ? state.planSelection : null;
  const selectionCurrent = selection?.inputSignature === planningInputSignature(state);
  const baselinePlan = comparisonCurrent ? state.comparison?.find((p) => p.method === "baseline") : undefined;
  const rulesPlan = comparisonCurrent ? state.comparison?.find((p) => p.method === "rules") : undefined;
  const comparisonReady = !!(baselinePlan && rulesPlan && state.comparisonMeta);
  const comparedDraft = state.comparison?.find((p) => p.method === draft?.method);
  const draftAligned = !draft || !!(comparedDraft && planInputSignature(draft) === planInputSignature(comparedDraft));
  const openComparison = () => {
    if (!comparisonReady) update((s) => comparePlans(s));
    setCompareOpen(true);
  };

  const shownRows = shown
    ? shown.stops.filter((ps) => {
        const st = states[ps.stopId]?.status;
        if (filter === "pending") return st === "pending";
        if (filter === "done") return st === "delivered" || st === "failed";
        if (filter === "risk") return isRisk(ps);
        return true;
      })
    : [];

  return (
    <div className="space-y-5">
      {/* Shift and planning controls */}
      <Panel>
        <div className="flex flex-wrap items-end gap-4 px-4 py-4">
          <div>
            <label htmlFor="rider" className="text-xs text-ink-faint">
              Rider
            </label>
            <select
              id="rider"
              className="mt-1 block h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
              value={rider.id}
              onChange={(e) => { setSelected(null); setFilter("all"); update((s) => selectRider(s, e.target.value)); }}
            >
              {fixtures.riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.zoneLabel} ({r.locations} sites)
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-ink-faint">Demo persona: new rider. Tenure is not in the dataset.</div>
          </div>
          <div>
            <label htmlFor="shift" className="text-xs text-ink-faint">
              Demo shift
            </label>
            <select
              id="shift"
              className="mt-1 block h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
              value={shift.id}
              onChange={(e) => { setSelected(null); setFilter("all"); update((s) => selectShift(s, e.target.value)); }}
            >
              {rider.shiftIds.map((id) => {
                const s = fixtures.shifts.find((x) => x.id === id)!;
                return (
                  <option key={s.id} value={s.id}>
                    {s.weekday} {s.date} · {s.stops.length} parcels
                  </option>
                );
              })}
            </select>
            <div className="mt-1 text-xs text-ink-faint">A real rider-day from the dataset, de-identified</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" onClick={generateProposedPlan}>
              <Sparkles /> Generate Proposed Plan
            </Button>
            <Button onClick={openComparison}>
              <BarChart3 /> Compare Plans
            </Button>
            {draft ? (
              <Button variant="dark" disabled={!!dispatchBlockReason} title={dispatchBlockReason ?? "Dispatch this draft plan"} onClick={() => { update((s) => dispatchPlan(s, draft)); setJustSent(true); window.setTimeout(() => setJustSent(false), 2600); }}>
                <Send /> Dispatch to rider
              </Button>
            ) : justSent ? (
              <span className="sc-check inline-flex items-center gap-2 rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-white shadow-sm" role="status">
                <Check className="size-4" /> Sent to rider
              </span>
            ) : null}
          </div>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
          Automatic: compare Baseline, Rules-based and experimental Model on the same inputs. Select the best eligible draft; dispatch remains a separate Dispatcher action.
        </p>
      </Panel>

      {dispatchBlockReason ? <div role="alert" className="rounded-lg border border-warn/50 bg-warn-tint px-4 py-3 text-sm text-warn"><b>Dispatch is blocked:</b> {dispatchBlockReason}{openProposal ? <Link className="ml-2 underline" href="/replan">Open Replanning</Link> : null}</div> : null}

      {/* Main view keeps operational decisions prominent; reference and session detail stay available below. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-label="Current plan summary" data-plan-method={shown?.method}>
                <PanelHeader
            title={shown ? (draft ? "Draft plan" : "Dispatched plan") : "No plan yet"}
            note={shown ? `${METHOD_LABEL[shown.method]} · Simulated estimate` : "Generate a proposed plan to see the schedule"}
            actions={<SourceTag kind="simulated" />}
          />
          {shown ? (
            <div className="grid grid-cols-2 gap-4 px-4 py-3">
              <Stat label="Stops scheduled" value={`${shown.totals.scheduledStops} / ${shown.totals.stops}`} sub="scheduled / total pending stops" />
              <Stat label="Expected successful first attempts" value={`${shown.totals.expectedSuccess.toFixed(1)} / ${shown.totals.estimatedStops}`} sub="Simulated history-table estimate · shared comparison sample" />
              <Stat label="Estimated finish" value={fmt(shown.totals.endMin)} sub="Simulated estimate" />
              <Stat label="Attention / decisions waiting" value={`${shown.totals.flagged} / ${pendingCorrections.length + (openProposal ? 1 : 0)}`} sub={`${pendingCount} stops pending`} />
              {shown.totals.scheduledStops !== shown.totals.stops ? <p className="col-span-2 text-xs text-warn">{shown.totals.stops - shown.totals.scheduledStops} of {shown.totals.stops} stops are unscheduled. Per-parcel time is not comparable.</p> : null}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-faint">No draft or dispatched plan yet.</p>
          )}
          {selection ? <div className="space-y-2 border-t border-line px-4 py-3" aria-label="Automatic planner selection">
            {!selectionCurrent ? <p role="status" className="text-sm text-warn">Selection is out of date. Inputs changed; generate a new proposed plan before dispatch.</p> : <>
              <p className="text-sm font-semibold">{selection.selectedMethod ? draft && draft.id !== selection.selectedPlanId ? `Manual draft: ${METHOD_LABEL[draft.method]}. Automatic recommendation: ${METHOD_LABEL[selection.selectedMethod]}.` : `Automatically selected: ${METHOD_LABEL[selection.selectedMethod]}` : "Dispatcher review required — no automatic draft"}</p>
              <p className="text-sm text-ink-soft">{selection.reason}</p>
              {selection.experimentalWarning ? <p className="text-xs text-warn">{selection.experimentalWarning}</p> : null}
            </>}
            <details><summary className="cursor-pointer text-sm font-medium">Selection details &amp; safety checks</summary><div className="mt-2 space-y-3">
              <p className="break-words text-xs text-ink-faint">Run: {selection.runId} · {selection.scenarioId}. All estimates use the common history-table sample; model predictions are separate.</p>
              {selection.evaluations.map(e => <div key={e.method} className="rounded-lg border border-line p-3 text-sm"><p className="font-semibold">{METHOD_LABEL[e.method]} · {e.eligible ? "Eligible" : "Not eligible for automatic selection"}</p><p>Expected first attempts: {e.expectedSuccess?.toFixed(1) ?? "Invalid"} / {e.eligibleStopIds.length} · Minutes/parcel: {e.minutesPerParcel?.toFixed(1) ?? "Not comparable"}</p>{e.errors.map(error => <p key={error} className="mt-1 text-bad">{error}</p>)}{e.warnings.map(warning => <p key={warning} className="mt-1 text-warn">Warning: {warning}</p>)}</div>)}
            </div></details>
          </div> : null}
          <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">Source: de-identified delivery history · Method: {shown ? METHOD_LABEL[shown.method] : "not run"}.</p>
        </Panel>
        <Panel>
          <PanelHeader title="Delivery progress" note="Actions in this demo session" actions={<SourceTag kind="live" />} />
          <div className="px-4 py-3"><Stat label="Stops completed" value={`${doneCount} / ${shift.stops.length}`} sub={`${shift.stops.filter((s) => states[s.id].status === "delivered").length} delivered · ${shift.stops.filter((s) => states[s.id].status === "failed").length} failed`} /></div>
          <details className="border-t border-line px-4 py-3"><summary className="cursor-pointer font-medium">Demo activity · {m.buyerAnswered} buyer replies · {pendingCorrections.length + (openProposal ? 1 : 0)} decisions waiting</summary><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Stat label="Buyer replies" value={m.buyerAnswered} sub={`${m.buyerNoResponse} no response`} /><Stat label="Corrections" value={`${m.correctionsApproved} approved`} sub={`${pendingCorrections.filter((c) => c.field !== "confirmation" && c.field !== "dispute").length} waiting`} /><Stat label="Plan changes" value={`${m.replansAccepted} accepted`} sub={`${m.replansOverridden} overridden`} /></div></details>
        </Panel>
      </div>



      <div className="space-y-3">
        <Panel className="px-4 py-3"><details className="ui-disclosure"><summary className="cursor-pointer font-medium">Fixed historical data · {historical.orders.toLocaleString()} orders</summary><div className="space-y-4 pt-4">
          <p className="text-sm text-ink-soft">Observed outcomes from {historical.period.from} to {historical.period.to}. Business targets come from the BCE004 Proposal; they are goals, not measured achievements. Draft-plan estimates are simulated separately above.</p>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Historical first-attempt success" value={pct(historical.kpis.firstAttemptSuccess, 1)} sub="Observed dataset outcome" />
            <Stat label="Business target: first-attempt success" value={pct(historical.caseTargets.firstAttemptSuccess)} sub="Case target; not an achieved result" />
            <Stat label="Historical re-delivery rate" value={pct(historical.kpis.redeliveryRate, 1)} sub={`Case target: ${pct(historical.caseTargets.redeliveryRate, 1)}`} />
            <Stat label="Evening vs morning success" value={`${pct(historical.byWindow.find((w) => w.attempt_time === "evening")!.success, 0)} vs ${pct(historical.byWindow.find((w) => w.attempt_time === "morning")!.success, 0)}`} sub="Observed first attempts" />
            <Stat label="Selected rider-day actual outcome" value={shift.actualDatasetOutcome.attempts ? `${shift.actualDatasetOutcome.delivered} / ${shift.actualDatasetOutcome.attempts}` : "No actual outcome available"} sub={shift.actualDatasetOutcome.attempts ? "Delivered / actual delivery attempts in dataset" : "No recorded outcome for this rider-day"} />
          </div>
        </div></details></Panel>
        <details className="ui-disclosure text-sm">
          <summary className="w-fit cursor-pointer rounded-md px-1 py-1 font-medium text-info">How are these estimates calculated?</summary>
          <div className="max-w-2xl space-y-2 px-1 pt-2 text-ink-soft">
            <p><b>Historical Dataset:</b> observed delivery outcomes.</p>
            <p><b>Simulated:</b> planner estimates, not measured results.</p>
            <p><b>Model:</b> experimental Logistic Regression prediction, shown separately.</p>
            <p><Link href="/how-it-works" className="text-info underline">How it works — full methodology</Link></p>
          </div>
        </details>
      </div>

      <PlanFollowUp />
      {openProposal || pendingCorrections.length ? (
        <div className="flex flex-wrap gap-3">
          {openProposal ? (
            <Link href="/replan" className="flex items-center gap-2 rounded-lg border border-brand/40 bg-brand-tint px-3 py-2 text-sm text-brand-ink">
              <TriangleAlert className="size-4" /> Plan change waiting: {openProposal.triggerText}
            </Link>
          ) : null}
          {pendingCorrections.length ? (
            <Link href="/stops" className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn-tint px-3 py-2 text-sm text-warn">
              <Info className="size-4" /> {pendingCorrections.length} stop-card correction(s) waiting for review
            </Link>
          ) : null}
        </div>
      ) : null}

      <Panel className="min-w-0" aria-label="Delivery Schedule">
        <PanelHeader title="Delivery Schedule" note="Simulated arrival times · select a stop to highlight it in Deliveries and Route" actions={<SourceTag kind="simulated" />} />
        <div className="p-4 sm:p-5">{shown ? <ShiftRibbon key={shift.id} plan={shown} states={states} clockMin={plan ? state.clockMin[shift.id] : undefined} onSelect={selectDelivery} selected={selected} /> : <p className="text-sm text-ink-faint">Appears after you generate a plan.</p>}</div>
      </Panel>

      <div className="min-w-0 space-y-5">
        <Panel className="min-w-0">
                <PanelHeader
            title="Deliveries"
            note={
              shown
                ? `${shown.stops.length} assigned · ${pendingCount} pending · ${riskCount} at risk${transferred.length ? ` · ${transferred.length} moved to the backup rider` : ""}`
                : `${shift.stops.length} parcels loaded, in the order they were received`
            }
            actions={
              shown ? (
                <div className="flex items-center gap-2">
                  <MethodBadge method={shown.method} />
                  {draft ? <Badge tone="brand">Draft, not dispatched</Badge> : <Badge tone="ok">Dispatched</Badge>}
                </div>
              ) : null
            }
          />
          {shown ? (
            <>
              <div className="flex gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Filter deliveries">
                {(["all", "pending", "risk", "done"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-canvas font-medium text-ink" : "text-ink-soft hover:text-ink")}
                  >
                    {f === "all" ? "All" : f === "pending" ? "Pending" : f === "risk" ? `At risk (${riskCount})` : "Done"}
                  </button>
                ))}
              </div>
              <div ref={deliveryTable} className="max-h-[520px] overflow-auto">
                <p className="px-3 py-1 text-xs text-ink-faint sm:hidden">Swipe horizontally to see all order details.</p>
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-surface text-left text-xs text-ink-faint">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 font-normal">#</th>
                      <th className="px-3 py-2 font-normal">Parcel</th>
                      <th className="px-3 py-2 font-normal">Location</th>
                      <th className="px-3 py-2 font-normal">Payment</th>
                      <th className="px-3 py-2 font-normal">Block and ETA</th>
                      <th className="px-3 py-2 font-normal">Chance</th>
                      <th className="px-3 py-2 font-normal">Knowledge</th>
                      <th className="px-3 py-2 font-normal">Status</th>
                      <th className="px-3 py-2 font-normal">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((ps) => {
                      const st = stopById[ps.stopId];
                      const card = cards[st.locationKey];
                      const ss = states[ps.stopId];
                      const buyer = ss.buyer;
                      return (
                        <tr
                          key={ps.stopId}
                          data-delivery-stop={ps.stopId}
                          aria-selected={selected === ps.stopId}
                          className={cn("ui-select border-b border-line/70 align-top hover:bg-canvas/60", selected === ps.stopId && "bg-brand-tint/50")}
                          onClick={() => setSelected(ps.stopId)}
                        >
                          <td className="px-3 py-2.5 text-ink-faint">{ps.seq}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{ps.stopId}</div>
                            <div className="text-xs text-ink-faint">{st.buyer}</div>
                            {st.isReattempt ? <div className="text-xs text-warn">Re-attempt</div> : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              className="text-left font-medium text-info underline-offset-2 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(ps.stopId);
                              }}
                            >
                              {card.name}
                            </button>
                            <div className="text-xs text-ink-faint">
                              {TYPE_LABEL[st.locationType]} · {st.parcel}
                              {!st.pin ? " · no map pin" : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">{st.payment === "cod" ? <Badge tone="warn">COD</Badge> : <span className="text-ink-soft">Prepaid</span>}</td>
                          <td className="px-3 py-2.5">
                            {Number.isNaN(ps.arriveMin) ? <span className="text-bad">Not scheduled</span> : <BlockTag block={ps.block} eta={ps.arriveMin} />}
                            {buyer.kind === "confirmed" || buyer.kind === "changed" ? <div className="text-xs text-ok">Buyer confirmed</div> : null}
                            {buyer.kind === "pickup" ? <div className="text-xs text-info">Pickup point</div> : null}
                            {buyer.kind === "invited" ? <div className="text-xs text-warn">Waiting for buyer</div> : null}
                            {buyer.kind === "no_response" ? <div className="text-xs text-ink-faint">No buyer reply</div> : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <ChanceText p={ps.p} />
                          </td>
                          <td className="px-3 py-2.5">
                            <CardStatusBadge status={card.status} />
                          </td>
                          <td className="px-3 py-2.5">
                            {ss.status === "pending" ? (
                              ps.flags.length ? (
                                <span className="text-xs text-bad" title={ps.flags.join("\n")}>
                                  {ps.flags[0]}
                                </span>
                              ) : (
                                <span className="text-xs text-ink-soft">Pending</span>
                              )
                            ) : (
                              <Badge tone={ss.status === "delivered" ? "ok" : "bad"}>{ss.status}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {ss.status === "pending" && !draft && plan ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTransferStop(ps.stopId);
                                }}
                                title="Move this parcel to the backup rider (explicit dispatcher action)"
                              >
                                <ArrowLeftRight /> Move
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shownRows.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">No deliveries match this filter.</p> : null}
              </div>
              {shown.warnings.length ? (
                <ul className="space-y-1 border-t border-line px-4 py-3 text-sm text-bad">
                  {shown.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No plan for this shift yet"
                action={
                  <Button variant="primary" onClick={generateProposedPlan}>
                    <Sparkles /> Generate Proposed Plan
                  </Button>
                }
              >
                {shift.stops.length} parcels are loaded for {rider.label}. Generate a proposed plan, compare methods, then dispatch it to the rider.
              </EmptyState>
              <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
                {shift.stops.map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-canvas">
                    <span className="text-left">
                      <span className="font-medium">{s.id}</span> <span className="text-ink-soft">{cards[s.locationKey].name}</span>
                    </span>
                    <span className="text-xs text-ink-faint">
                      {TYPE_LABEL[s.locationType]} · {s.payment.toUpperCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

          <Panel>
            <PanelHeader title="Route" />
            <div className="px-4 py-3">
              <RouteMap key={shift.id} riderId={rider.id} plan={shown} states={states} selected={selected} onSelect={selectDelivery} locations={Object.fromEntries(shift.stops.map((s) => [s.id, cards[s.locationKey].name]))} />
            </div>
          </Panel>

          {transferred.length ? (
            <Panel>
              <PanelHeader title={BACKUP_RIDER} note="Parcels moved here by the dispatcher" />
              <ul className="space-y-1 px-4 py-3 text-sm">
                {transferred.map((t) => (
                  <li key={t.stopId}>
                    <span className="font-medium">{t.stopId}</span> — {t.note} <span className="text-xs text-ink-faint">({new Date(t.at).toLocaleTimeString()})</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
      </div>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent title="Projected Impact — Simulated Estimates" description="Same rider, same parcels and common historical scorer. These are simulated estimates, not measured outcomes." wide className="sm:max-h-[88vh]">
          {comparisonReady && baselinePlan && rulesPlan && state.comparisonMeta ? (
            <ProjectedImpact key={state.comparisonMeta.runId} baseline={baselinePlan} rules={rulesPlan} sampleSize={state.comparisonMeta.eligibleEstimatedStops} totalPending={state.comparisonMeta.totalStops} draftAligned={draftAligned} />
          ) : <div role="status" className="space-y-3 rounded-lg bg-warn-tint p-4 text-sm text-warn">
            <p>Comparison is out of date. Inputs changed; refresh before reviewing estimates or selecting a draft.</p>
            <Button onClick={() => update((s) => comparePlans(s))}>Refresh comparison</Button>
          </div>}
        </DialogContent>
      </Dialog>
      <TransferDialog stopId={transferStop} riderName={rider.label} onClose={() => setTransferStop(null)} onConfirm={(note) => transferStop && update((s) => transferParcel(s, transferStop, note))} />
    </div>
  );
}

function signed(value: number, digits = 1) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
}

function ProjectedImpact({ baseline, rules, sampleSize, totalPending, draftAligned }: { baseline: Plan; rules: Plan; sampleSize: number; totalPending: number; draftAligned: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const detailId = React.useId();
  const baselineMinutes = onRoadMinutesPerParcel(baseline);
  const rulesMinutes = onRoadMinutesPerParcel(rules);
  const minutesComparable = baselineMinutes !== null && rulesMinutes !== null && baseline.totals.stops === rules.totals.stops;
  const finishComparable = totalPending > 0 && baseline.totals.stops === rules.totals.stops && baseline.totals.scheduledStops === baseline.totals.stops && rules.totals.scheduledStops === rules.totals.stops;
  const successDelta = rules.totals.expectedSuccess - baseline.totals.expectedSuccess;
  const successPercent = baseline.totals.expectedSuccess > 0 ? (successDelta / baseline.totals.expectedSuccess) * 100 : null;
  const minutesDelta = minutesComparable ? rulesMinutes! - baselineMinutes! : null;
  const minutesPercent = minutesComparable && baselineMinutes! > 0 ? (minutesDelta! / baselineMinutes!) * 100 : null;
  const finishDelta = rules.totals.endMin - baseline.totals.endMin;
  const lowChanceDelta = rules.totals.lowChance - baseline.totals.lowChance;
  const scheduledComparable = baseline.totals.stops === rules.totals.stops;
  const sampleComparable = sampleSize > 0 && scheduledComparable && baseline.totals.estimatedStops === sampleSize && rules.totals.estimatedStops === sampleSize;
  const relative = (v: number | null) => v === null ? "" : ` (${signed(v)}%)`;
  const stopTimeReason = totalPending === 0 ? "No pending stops to compare." : !scheduledComparable
    ? `Pending-stop totals differ (${baseline.totals.stops} vs ${rules.totals.stops}).`
    : `Not comparable: Baseline has ${baseline.totals.stops - baseline.totals.scheduledStops} unscheduled and Rules-based has ${rules.totals.stops - rules.totals.scheduledStops} unscheduled stops.`;
  return <div className="space-y-4">
    {!draftAligned ? <p role="status" className="rounded-md bg-warn-tint p-3 text-sm text-warn">This comparison uses current inputs; the existing draft differs. Choose Use as draft in the detailed comparison or generate a new proposed plan before dispatch review.</p> : null}
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="sc-fade rounded-lg border border-line bg-canvas/60 p-4">
        <h3 className="font-semibold">Baseline</h3>
        <ImpactMetrics plan={baseline} minutes={baselineMinutes} />
      </div>
      <span aria-hidden="true" className="self-center justify-self-center text-2xl text-ink-faint rotate-90 md:rotate-0">→</span>
      <div className="sc-fade [--d:0.12s] rounded-lg border border-brand/40 bg-brand-tint/30 p-4 shadow-sm">
        <h3 className="font-semibold text-brand-ink">S-Compass Rules-based</h3>
        <ImpactMetrics plan={rules} minutes={rulesMinutes} />
      </div>
    </div>
    <div className="grid gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <p><span className="text-ink-faint">Expected first attempts:</span> {sampleComparable ? <b className={successDelta > 0 ? "text-ok" : ""}>{signed(successDelta)} stops{relative(successPercent)}</b> : <b>Not comparable</b>}</p>
      <p><span className="text-ink-faint">Minutes per parcel:</span> {minutesComparable ? <b className={minutesDelta! < 0 ? "text-ok" : ""}>{signed(minutesDelta!)} min{relative(minutesPercent)}</b> : <b title={stopTimeReason}>Not comparable</b>}</p>
      <p><span className="text-ink-faint">Estimated finish:</span> {finishComparable ? <b className={finishDelta < 0 ? "text-ok" : ""}>{finishDelta === 0 ? "No change" : `${Math.round(Math.abs(finishDelta))} min ${finishDelta < 0 ? "earlier" : "later"}`}</b> : <b title={stopTimeReason}>Not comparable</b>}</p>
      <p><span className="text-ink-faint">Low-chance stops:</span> {finishComparable ? <b className={lowChanceDelta < 0 ? "text-ok" : ""}>{lowChanceDelta === 0 ? "No change" : `${Math.abs(lowChanceDelta)} ${lowChanceDelta < 0 ? "fewer" : "more"} stops`}</b> : <b title={stopTimeReason}>Not comparable</b>}</p>
    </div>
    {!minutesComparable ? <p role="status" className="px-4 pb-3 text-xs text-warn">{stopTimeReason} Time and low-chance improvements require the same pending-stop totals and every pending stop scheduled.</p> : null}
    {!sampleComparable ? <p role="status" className="px-4 text-xs text-warn">Expected first-attempt changes require the same non-empty common eligible sample.</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-faint">
      <span>Sample: {totalPending} total pending stops · {sampleSize} common eligible estimates. Baseline and Rules use the same start conditions.</span>
      <Button variant="outline" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded((value) => !value)}><BarChart3 /> {expanded ? "Hide Detailed Comparison" : "View Detailed Comparison"}</Button>
    </div>
    {expanded ? <div id={detailId} className="ui-reveal border-t border-line pt-4"><ComparisonDetails /></div> : null}
  </div>;
}

function ImpactMetrics({ plan, minutes }: { plan: Plan; minutes: number | null }) {
  return <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
    <div><dt className="text-xs text-ink-faint">Expected successful first attempts</dt><dd className="font-semibold">{plan.totals.expectedSuccess.toFixed(1)} / {plan.totals.estimatedStops}</dd></div>
    <div><dt className="text-xs text-ink-faint">Estimated minutes per parcel</dt><dd className="font-semibold">{minutes === null ? "Not comparable" : `${minutes.toFixed(1)} min`}</dd></div>
    <div><dt className="text-xs text-ink-faint">Estimated finish</dt><dd className="font-semibold">{plan.totals.scheduledStops === plan.totals.stops ? fmt(plan.totals.endMin) : "Not comparable"}</dd></div>
    <div><dt className="text-xs text-ink-faint">Stops at low-chance times</dt><dd className="font-semibold">{plan.totals.lowChance}</dd></div>
    <div className="col-span-2"><dt className="text-xs text-ink-faint">Stops scheduled / total pending</dt><dd className="font-semibold">{plan.totals.scheduledStops} / {plan.totals.stops}</dd></div>
  </dl>;
}

function ComparisonDetails() {
  const { state, update } = useDemo();
  const plans = state.comparison ?? [];
  const meta = state.comparisonMeta;
  const best = plans.length ? Math.max(...plans.map((p) => p.totals.expectedSuccess)) : 0;
  const rows: { label: string; get: (p: Plan) => string; note?: string }[] = [
    { label: "Expected successful first attempts", get: (p) => p.totals.expectedSuccess.toFixed(1), note: "History-table estimate, same scorer for every method" },
    { label: "Stops with an estimate", get: (p) => `${p.totals.estimatedStops} / ${p.totals.stops}` },
    { label: "Estimated on-road minutes per parcel", get: (p) => onRoadMinutesPerParcel(p) === null ? `Not comparable: ${p.totals.stops - p.totals.scheduledStops} unscheduled / ${p.totals.stops} total` : `${onRoadMinutesPerParcel(p)!.toFixed(1)} min (${p.totals.stops} parcels)`, note: "Only shown when every pending parcel has a scheduled time" },
    { label: "Model prediction (experimental)", get: (p) => p.totals.modelExpectedSuccess === null ? "Not scored" : `${p.totals.modelExpectedSuccess.toFixed(1)} / ${p.totals.modelEstimatedStops} stops`, note: "Logistic regression prediction; not the common comparison score" },
    { label: "Stops in a block with under 65% chance", get: (p) => String(p.totals.lowChance), note: "e.g. schools and offices in the evening" },
    { label: "Distance (straight-line × 1.3)", get: (p) => `${p.totals.distanceKm.toFixed(1)} km` },
    { label: "Working time (travel + search + service)", get: (p) => `${Math.round(p.totals.onRoadMin)} min` },
    { label: "Estimated finish", get: (p) => fmt(p.totals.endMin) },
    { label: "Stops flagged for dispatcher", get: (p) => String(p.totals.flagged) },
    { label: "Buyer-confirmed windows kept", get: (p) => (p.totals.confirmedTotal ? `${p.totals.confirmedKept} / ${p.totals.confirmedTotal}` : "none confirmed") },
    { label: "Planner run time", get: (p) => `${p.computeMs} ms` },
  ];
  return (
    <section aria-label="Detailed Comparison">
      <h3 className="mb-3 font-semibold">Detailed Comparison · Simulated estimates</h3>
        {plans.length ? (
          <>
            {meta ? <div className="mb-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
              <div><b>Scenario:</b> {meta.scenarioId} · <b>Run:</b> {meta.runId}</div>
              <div><b>Sample:</b> {meta.totalStops} total stops · {meta.eligibleEstimatedStops} common eligible stops · <b>Source:</b> {meta.dataset}</div>
              <div><b>KPI method:</b> {meta.successMetric} <span className="font-medium">· SIMULATED</span></div>
              <div><b>Run time:</b> {new Date(meta.createdAt).toLocaleString()}</div>
            </div> : null}
            <p className="mb-2 text-xs text-ink-soft sm:hidden">Swipe the table to see Rules-based and Model.</p>
            <div className="overflow-x-auto overscroll-x-contain rounded-md" role="region" aria-label="Comparison metrics table" tabIndex={0}>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 pr-3 font-normal text-ink-faint">Measure</th>
                    {plans.map((p) => (
                      <th key={p.method} className="py-2 pr-3">
                        <MethodBadge method={p.method} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        {r.label}
                        {r.note ? <div className="text-xs text-ink-faint">{r.note}</div> : null}
                      </td>
                      {plans.map((p) => (
                        <td key={p.method} className={cn("py-2 pr-3 font-medium", r.label.startsWith("Expected") && p.totals.expectedSuccess === best && "text-ok")}>
                          {r.get(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="py-3 pr-3 text-ink-faint">Use as draft</td>
                    {plans.map((p) => (
                      <td key={p.method} className="py-3 pr-3">
                          <Button size="sm" aria-pressed={state.draftPlan?.id === p.id} variant={state.draftPlan?.id === p.id ? "primary" : "outline"} onClick={() => update((s) => useComparedDraft(s, p.id))}>
                            Use {p.method === "model" ? "model" : p.method}
                          </Button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2 rounded-lg bg-canvas p-3 text-sm text-ink-soft">
              <p><b className="text-ink">Method:</b> Baseline follows nearest map pins. Rules-based uses delivery history and operational constraints. Model uses experimental Logistic Regression with the same constraints.</p>
              <p><b className="text-ink">Assumptions:</b> straight-line distance × 1.3; travel, entrance search and service use existing demo assumptions. Per-parcel time requires every pending order to be scheduled.</p>
              <p>Model predictions are separate from the common history-table score. Held-out October evaluation did not show the Model to be more accurate than the history table.</p>
              <Link className="text-info underline" href="/how-it-works">How it works — methodology and evaluation</Link>
            </div>
            {state.draftPlan ? <p role="status" className="mt-3 text-sm text-ink-soft">Current draft: <b>{METHOD_LABEL[state.draftPlan.method]}</b>. Review the delivery schedule before dispatch.</p> : null}
          </>
        ) : (
          <p className="text-sm text-ink-faint">Run Compare Plans to see the three methods side by side.</p>
        )}
    </section>
  );
}

function TransferDialog({ stopId, riderName, onClose, onConfirm }: { stopId: string | null; riderName: string; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = React.useState("Rider is over capacity in the evening block");
  return (
    <Dialog open={!!stopId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move ${stopId} to the backup rider?`} description={`The parcel is already loaded on ${riderName}. Moving it to ${BACKUP_RIDER} needs a physical handover, so it only happens when you confirm here.`}>
        <Label htmlFor="transfer-note">Reason (saved in the evidence log)</Label>
        <Textarea id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Keep with {riderName}</Button>
          <Button
            variant="primary"
            disabled={!note.trim()}
            onClick={() => {
              onConfirm(note.trim());
              onClose();
            }}
          >
            Move parcel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
