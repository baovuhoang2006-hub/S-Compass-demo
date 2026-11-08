"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock3, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { generatePlan, log } from "@/lib/demoState";
import { aiRisk, dataRisk, overloadRisk, type AiFault, type DataFault, type RiskKind, type RiskResult } from "@/lib/riskChallenge";
import type { Block } from "@/lib/types";
import { useDemo } from "@/state/DemoProvider";
import { presentRisk, type RiskSelection } from "./presentation";

const inputClass = "mt-1.5 h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm";
const scenarios = [["overload", "A · System overload"], ["ai", "B · AI output"], ["data", "C · Anomalous data"]] as const;
const statusStyle = { safe: "bg-ok-tint text-ok", review: "bg-warn-tint text-warn", timeout: "bg-bad-tint text-bad" };
const checkStyle = { Pass: "text-ok", Failed: "text-bad", "Not evaluated": "text-ink-soft" };

type TestRun = { result: RiskResult; selection: RiskSelection; planLabel: string; sourceCount: number };

export default function RiskChallengePage() {
  const { state, update, plan, shift, cards } = useDemo();
  const [kind, setKind] = React.useState<RiskKind>("overload");
  const [workload, setWorkload] = React.useState(100);
  const [capacity, setCapacity] = React.useState(40);
  const [timeBudget, setTimeBudget] = React.useState(500);
  const [aiFault, setAiFault] = React.useState<AiFault>("nan");
  const [block, setBlock] = React.useState<Block>("morning");
  const [dataFault, setDataFault] = React.useState<DataFault>("duplicate_id");
  const [orderId, setOrderId] = React.useState(shift.stops.find((s) => s.pin)?.id ?? shift.stops[0].id);
  const [phase, setPhase] = React.useState<"idle" | "processing" | "complete">("idle");
  const [test, setTest] = React.useState<TestRun | null>(null);
  const [operator, setOperator] = React.useState("");
  const pending = React.useRef<number | null>(null);
  React.useEffect(() => () => { if (pending.current !== null) window.clearTimeout(pending.current); }, []);

  const clearResult = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
    setPhase("idle"); setTest(null); setOperator("");
  };
  const selectedOrder = shift.stops.find((s) => s.id === orderId) ?? shift.stops[0];
  const run = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    setTest(null); setOperator(""); setPhase("processing");
    // Keep display context with this run, so later control edits cannot relabel old evidence.
    const stop = kind === "ai" ? shift.stops.find((s) => state.stopStates[shift.id][s.id]?.status === "pending") ?? shift.stops[0] : selectedOrder;
    const selection = { aiFault, dataFault, orderId: stop.id, siteName: cards[stop.locationKey].name };
    pending.current = window.setTimeout(() => {
      const result = kind === "overload" ? overloadRisk(workload, capacity, timeBudget, plan) :
        kind === "ai" ? aiRisk(state, aiFault, block) : dataRisk(state, dataFault, selectedOrder.id);
      setTest({ result, selection, planLabel: plan ? `Dispatched plan unchanged · ${plan.stops.length} stops retained` : "No dispatched plan changed · source parcels remain in the queue", sourceCount: shift.stops.length });
      setPhase("complete"); pending.current = null;
    }, 450);
  };
  const result = test?.result;
  const view = test ? presentRisk(test.result, test.selection) : null;
  const acknowledge = () => {
    if (!result) return;
    update((s) => log(s, { type: "risk_incident_reviewed", role: "dispatcher", summary: `${result.incidentId}: ${result.status}`, input: result.input, output: `${result.detection} | ${result.safeAction}` }));
    setOperator(result.status === "safe" ? "Test result saved to Evidence. No delivery plan was changed." : "Dispatcher review recorded in Evidence. This does not resolve the incident or apply a correction; the dispatched plan remains unchanged.");
  };
  const rulesDraft = () => {
    if (!result) return;
    update((s) => log(generatePlan(s, "rules"), { type: "risk_rules_fallback", role: "dispatcher", summary: `${result.incidentId}: Rules draft created for review`, output: "Draft only; no automatic dispatch." }));
    setOperator("Rules draft created for dispatcher review; no automatic dispatch.");
  };
  const StatusIcon = result?.status === "safe" ? ShieldCheck : result?.status === "timeout" ? Clock3 : AlertTriangle;

  return <div className="space-y-5">
    <div>
      <p className="mt-1 text-sm text-ink-soft">Test a risk. See what is protected. Choose the next action.</p>
      <p className="mt-2 text-xs text-ink-faint">Isolated demo tests · no external AI API · no measured production load test</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Risk scenario">
      {scenarios.map(([id, label]) => <Button key={id} className="h-auto min-h-12 whitespace-normal py-3" aria-pressed={kind === id} variant={kind === id ? "dark" : "outline"} onClick={() => { clearResult(); setKind(id); }}>{label}</Button>)}
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <Panel aria-label="Test inputs" className="min-w-0">
        <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Test inputs</h2><p className="mt-1 text-xs text-ink-faint">Change the inputs, then run the test.</p></div>
        <div className="space-y-4 p-4">
          {kind === "overload" ? <>
            <label className="block text-sm">Simulated parcels<input aria-label="Simulated parcels" className={inputClass} type="number" min="0" max="5000" value={workload} onChange={(e) => { clearResult(); setWorkload(Number(e.target.value)); }} /></label>
            <label className="block text-sm">Demo capacity<input aria-label="Demo capacity" className={inputClass} type="number" min="1" value={capacity} onChange={(e) => { clearResult(); setCapacity(Number(e.target.value)); }} /></label>
            <label className="block text-sm">Demo time budget (ms)<input aria-label="Demo time budget" className={inputClass} type="number" min="1" value={timeBudget} onChange={(e) => { clearResult(); setTimeBudget(Number(e.target.value)); }} /></label>
            <p className="text-xs text-ink-soft">Simulated work = parcels × 10 ms. This existing demo calculation is not measured production performance.</p>
          </> : null}
          {kind === "ai" ? <>
            <label className="block text-sm">Fault injection<select aria-label="AI fault" className={inputClass} value={aiFault} onChange={(e) => { clearResult(); setAiFault(e.target.value as AiFault); }}>
              <option value="none">Valid inference</option><option value="nan">NaN</option><option value="infinity">Infinity</option><option value="above_one">Probability above 1</option><option value="missing_feature">Missing feature</option><option value="hard_conflict">Buyer window conflict</option>
            </select></label>
            <label className="block text-sm">Proposed block<select aria-label="Proposed block" className={inputClass} value={block} onChange={(e) => { clearResult(); setBlock(e.target.value as Block); }}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></label>
            <p className="text-xs text-ink-soft">Uses the existing experimental logistic-regression model. Faults affect this isolated test only.</p>
          </> : null}
          {kind === "data" ? <>
            <label className="block text-sm">Anomaly<select aria-label="Data anomaly" className={inputClass} value={dataFault} onChange={(e) => { clearResult(); setDataFault(e.target.value as DataFault); }}>
              <option value="missing_pin">Missing pin</option><option value="duplicate_id">Duplicate ID</option><option value="negative_service">Negative processing time</option><option value="invalid_window">Invalid receiving window</option><option value="conflicting_card">Conflicting verified Stop Card</option>
            </select></label>
            <label className="block text-sm">Order<select aria-label="Risk order" className={inputClass} value={selectedOrder.id} onChange={(e) => { clearResult(); setOrderId(e.target.value); }}>{shift.stops.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
            <p className="break-words text-sm text-ink-soft">{cards[selectedOrder.locationKey].name}</p>
            <p className="text-xs text-ink-soft">Injects an anomaly into a copy. No source record is quarantined, repaired or approved here.</p>
          </> : null}
          <Button className="w-full" variant="primary" onClick={run} disabled={phase === "processing"}>{phase === "processing" ? "Processing…" : result ? "Retry scenario" : "Run scenario"}<ArrowRight aria-hidden="true" /></Button>
          <p className="break-words text-xs text-ink-faint">{shift.id} · {shift.stops.length} source parcels<br />{plan ? "Dispatched plan protected" : "No dispatched plan yet"}</p>
        </div>
      </Panel>
      <div className="min-w-0" aria-live="polite" aria-busy={phase === "processing"}>
        {phase === "processing" ? <Panel className="p-6" role="status"><Clock3 aria-hidden="true" className="mb-3 size-6 text-info" /><h2 className="font-semibold">Processing isolated test…</h2><p className="mt-2 text-sm text-ink-soft">Waiting for one demo step. No delivery plan is being dispatched.</p></Panel> : null}
        {phase === "idle" ? <Panel className="p-6"><ShieldCheck aria-hidden="true" className="mb-3 size-7 text-info" /><h2 className="font-semibold">Ready to test safely</h2><p className="mt-2 text-sm text-ink-soft">Run a scenario to see the result, failed checks and recommended action. Source data and the dispatched plan stay unchanged.</p></Panel> : null}
        {result && test && view ? <Panel aria-label="Risk test result" className="min-w-0 overflow-hidden">
          <div className="space-y-3 p-5">
            <span data-risk-status={result.status} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${statusStyle[result.status]}`}><StatusIcon aria-hidden="true" className="size-4" />{result.status.toUpperCase()}</span>
            <h2 className="text-xl font-semibold leading-snug sm:text-2xl">{view.headline}</h2>
            <p className="text-sm leading-relaxed text-ink-soft">{view.reason}</p>
            {result.kind !== "overload" ? <p className="break-words text-sm"><span className="font-semibold">Selected order/site:</span> {test.selection.orderId} · {test.selection.siteName}</p> : null}
            {view.value ? <div className="rounded-lg bg-canvas p-3" aria-label={view.value.label}><p className="text-xs font-semibold text-ink-soft">{view.value.label}</p><p className={`mt-1 break-words font-semibold ${result.kind === "ai" ? "text-3xl" : "text-base"}`}>{view.value.text}</p><p className="mt-1 text-xs leading-relaxed text-ink-soft">{view.value.note}</p></div> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {view.checks.map((check) => <div key={check.label} data-risk-check={check.label} className="min-w-0 rounded-lg border border-line p-3"><h3 className="text-sm font-semibold">{check.label}</h3><p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${checkStyle[check.status]}`}>{check.status === "Pass" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : check.status === "Failed" ? <AlertTriangle aria-hidden="true" className="size-4" /> : null}{check.status}</p><p className="mt-1 break-words text-sm text-ink-soft">{check.detail}</p></div>)}
            </div>
            {view.impact ? <div className="rounded-lg bg-warn-tint p-3 text-sm"><p className="font-semibold text-warn">Potential logistics risk · not an observed outcome</p><p className="mt-1 text-ink-soft">{view.impact}</p></div> : null}
            <div className="rounded-lg border border-line p-3" aria-label="Protected data">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck aria-hidden="true" className="size-4 text-ok" />What stays protected</h3>
              <p className="mt-1 text-sm">{test.planLabel}.</p>
              <p className="mt-1 text-sm text-ink-soft">All {test.sourceCount} source parcels, buyer commitments, completed stops and accepted Stop Cards remain unchanged by this test.</p>
            </div>
            <div><h3 className="text-sm font-semibold">Recommended next action</h3><p className="mt-1 text-sm leading-relaxed text-ink-soft">{view.nextAction}</p><p className="mt-2 text-sm"><span className="font-semibold">Fallback:</span> {view.fallback}.</p></div>
            <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-11 whitespace-normal py-2" onClick={acknowledge}><FileText aria-hidden="true" />{result.status === "safe" ? "Save test result to Evidence" : "Record dispatcher review"}</Button>{result.kind === "ai" && result.status === "review" ? <Button className="h-auto min-h-11 py-2" variant="primary" onClick={rulesDraft}>Create Rules draft</Button> : null}</div>
            {operator ? <p role="status" className="rounded-lg bg-info-tint p-3 text-sm text-info">{operator}</p> : null}
          </div>
          <details className="group border-t border-line" key={result.incidentId}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 text-sm font-semibold">Technical details &amp; Evidence<ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" /></summary>
            <div className="space-y-3 px-5 pb-5">
              <p className="text-xs text-ink-soft">Original engine evidence for this run. SAFE ACTION and FALLBACK describe guidance, not an executed dispatch, quarantine or correction. Saving a review does not mark the incident resolved.</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[["Incident ID", result.incidentId], ["Status", result.status.toUpperCase()], ["INPUT", result.input], ["DETECTION", result.detection], ["EXPLANATION", result.explanation], ["SAFE ACTION", result.safeAction], ["OUTPUT", result.result], ["FALLBACK", result.fallback], ["WARNING", result.warning]].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-canvas p-3"><dt className="text-xs font-semibold text-ink-faint">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{value}</dd></div>)}
              </dl>
            </div>
          </details>
        </Panel> : null}
      </div>
    </div>
  </div>;
}
