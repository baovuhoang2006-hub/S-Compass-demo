"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { generatePlan, log } from "@/lib/demoState";
import { aiRisk, dataRisk, overloadRisk, type AiFault, type DataFault, type RiskKind, type RiskResult } from "@/lib/riskChallenge";
import type { Block } from "@/lib/types";
import { useDemo } from "@/state/DemoProvider";

const inputClass = "h-10 rounded-lg border border-line bg-surface px-3 text-sm";

export default function RiskChallengePage() {
  const { state, update, plan, shift } = useDemo();
  const [kind, setKind] = React.useState<RiskKind>("overload");
  const [workload, setWorkload] = React.useState(100);
  const [capacity, setCapacity] = React.useState(40);
  const [timeBudget, setTimeBudget] = React.useState(500);
  const [aiFault, setAiFault] = React.useState<AiFault>("nan");
  const [block, setBlock] = React.useState<Block>("morning");
  const [dataFault, setDataFault] = React.useState<DataFault>("duplicate_id");
  const [orderId, setOrderId] = React.useState(shift.stops.find((s) => s.pin)?.id ?? shift.stops[0].id);
  const [phase, setPhase] = React.useState<"idle" | "processing" | "complete">("idle");
  const [result, setResult] = React.useState<RiskResult | null>(null);
  const [operator, setOperator] = React.useState("");
  const pending = React.useRef<number | null>(null);
  React.useEffect(() => () => { if (pending.current !== null) window.clearTimeout(pending.current); }, []);

  const changeKind = (next: RiskKind) => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    setKind(next); setPhase("idle"); setResult(null); setOperator("");
  };
  const run = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    setResult(null); setOperator(""); setPhase("processing");
    pending.current = window.setTimeout(() => {
      const outcome = kind === "overload" ? overloadRisk(workload, capacity, timeBudget, plan) :
        kind === "ai" ? aiRisk(state, aiFault, block) : dataRisk(state, dataFault, orderId);
      setResult(outcome); setPhase("complete"); pending.current = null;
    }, 450);
  };
  const acknowledge = () => {
    if (!result) return;
    update((s) => log(s, { type: "risk_incident_reviewed", role: "dispatcher", summary: `${result.incidentId}: ${result.status}`, input: result.input, output: `${result.detection} | ${result.safeAction}` }));
    setOperator("Dispatcher recorded the incident; current dispatched plan remains unchanged.");
  };
  const rulesDraft = () => {
    if (!result) return;
    update((s) => log(generatePlan(s, "rules"), { type: "risk_rules_fallback", role: "dispatcher", summary: `${result.incidentId}: Rules draft created for review`, output: "Draft only; no automatic dispatch." }));
    setOperator("Rules draft created for dispatcher review; no automatic dispatch.");
  };
  return <div className="space-y-5">
    <Panel>
      <PanelHeader title="Risk Challenge · interactive demo" note="Three isolated fault-injection scenarios. No external AI API or production load test is used." />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Risk scenario">
          {([ ["overload", "A · System overload"], ["ai", "B · AI output"], ["data", "C · Anomalous data"] ] as const).map(([id, label]) =>
            <Button key={id} variant={kind === id ? "primary" : "outline"} onClick={() => changeKind(id)}>{label}</Button>)}
        </div>
        {kind === "overload" ? <div className="flex flex-wrap gap-3">
          <label className="text-sm">Simulated parcels <input aria-label="Simulated parcels" className={inputClass + " ml-2 w-24"} type="number" min="0" max="5000" value={workload} onChange={(e) => setWorkload(Number(e.target.value))} /></label>
          <label className="text-sm">Demo capacity <input aria-label="Demo capacity" className={inputClass + " ml-2 w-24"} type="number" min="1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
          <label className="text-sm">Demo time budget (ms) <input aria-label="Demo time budget" className={inputClass + " ml-2 w-28"} type="number" min="1" value={timeBudget} onChange={(e) => setTimeBudget(Number(e.target.value))} /></label>
        </div> : null}
        {kind === "ai" ? <div className="flex flex-wrap gap-3">
          <label className="text-sm">Fault injection <select aria-label="AI fault" className={inputClass + " ml-2"} value={aiFault} onChange={(e) => setAiFault(e.target.value as AiFault)}>
            <option value="none">Valid inference</option><option value="nan">NaN</option><option value="infinity">Infinity</option><option value="above_one">Probability above 1</option><option value="missing_feature">Missing feature</option><option value="hard_conflict">Buyer window conflict</option>
          </select></label>
          <label className="text-sm">Proposed block <select aria-label="Proposed block" className={inputClass + " ml-2"} value={block} onChange={(e) => setBlock(e.target.value as Block)}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></label>
        </div> : null}
        {kind === "data" ? <div className="flex flex-wrap gap-3">
          <label className="text-sm">Anomaly <select aria-label="Data anomaly" className={inputClass + " ml-2"} value={dataFault} onChange={(e) => setDataFault(e.target.value as DataFault)}>
            <option value="missing_pin">Missing pin</option><option value="duplicate_id">Duplicate ID</option><option value="negative_service">Negative processing time</option><option value="invalid_window">Invalid receiving window</option><option value="conflicting_card">Conflicting verified Stop Card</option>
          </select></label>
          <label className="text-sm">Order <select aria-label="Risk order" className={inputClass + " ml-2"} value={shift.stops.some((s) => s.id === orderId) ? orderId : shift.stops[0].id} onChange={(e) => setOrderId(e.target.value)}>{shift.stops.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
        </div> : null}
        <div className="flex flex-wrap items-center gap-3"><Button variant="primary" onClick={run} disabled={phase === "processing"}>{phase === "processing" ? "Processing…" : result ? "Retry scenario" : "Run scenario"}</Button>
          <span className="text-sm text-ink-soft">Current shift: {shift.id} · {shift.stops.length} source parcels · {plan ? "last dispatched plan preserved" : "no dispatched plan yet"}</span>
        </div>
        {phase === "processing" ? <div role="status" className="rounded-lg bg-info-tint p-3 text-sm">Processing isolated fixture… queued for one demo step. Timeout and capacity checks are applied before any plan can be dispatched.</div> : null}
      </div>
    </Panel>
    {result ? <Panel>
      <PanelHeader title={`Incident ${result.incidentId}`} note={`Status: ${result.status.toUpperCase()} · Fallback: ${result.fallback}`} />
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {([ ["INPUT", result.input], ["DETECTION", result.detection], ["EXPLANATION", result.explanation], ["SAFE ACTION", result.safeAction], ["RESULT", result.result] ] as const).map(([label, value]) =>
          <div key={label} className="rounded-lg border border-line bg-canvas p-3"><h2 className="mb-1 text-xs font-semibold tracking-wide text-ink-faint">{label}</h2><p className="break-words text-sm">{value}</p></div>)}
      </div>
      <div role="alert" className="mx-4 rounded-lg bg-warn-tint p-3 text-sm text-warn">{result.warning}</div>
      <div className="flex flex-wrap items-center gap-2 p-4"><Button onClick={acknowledge}>Record dispatcher review</Button>{kind === "ai" && result.status === "review" ? <Button variant="primary" onClick={rulesDraft}>Create Rules draft</Button> : null}<span role="status" className="text-sm">{operator}</span></div>
    </Panel> : null}
  </div>;
}
