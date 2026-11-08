"use client";

import { SourceTag } from "@/components/bits";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { evaluation, historical, modelSpec, successTable } from "@/lib/data";
import { ASSUMPTION_LABELS } from "@/lib/planner";
import { cn, pct } from "@/lib/utils";

const TYPES = ["school", "office", "industrial", "gated_facility"] as const;
const WINS = ["morning", "afternoon", "evening"] as const;
const TYPE_NAME: Record<string, string> = { school: "School", office: "Office", industrial: "Industrial", gated_facility: "Gated site" };

function cellTone(p: number) {
  return p >= 0.8 ? "bg-ok-tint text-ok" : p >= 0.65 ? "bg-warn-tint text-warn" : "bg-bad-tint text-bad";
}

export default function HowItWorks() {
  const tw = historical.byTypeWindow as { location_type: string; attempt_time: string; n: number; success: number }[];
  const td = historical.byTypeDay as { location_type: string; weekend: boolean; n: number; success: number }[];
  const sc = evaluation.scores;
  const scoreRows = [
    { name: "Overall rate (no information)", s: sc.baseRate },
    { name: "History table (used by the rules planner)", s: sc.historyTable },
    { name: "Logistic-regression model (experimental planner)", s: sc.model },
    { name: "Gradient boosting (tried, not adopted)", s: evaluation.gradientBoosting },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">How S-Compass decides</h1>
        <p className="mt-1 max-w-3xl text-ink-soft">
          Every plan in this prototype is computed in your browser by the logic below. The success estimates come from the Strategy Round dataset; times and
          distances are simulated with the assumptions listed at the end.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Input, processing, output" />
        <div className="grid gap-px bg-line md:grid-cols-3">
          {[
            {
              h: "Input",
              items: [
                "Today's loaded parcels: site type, payment (COD or prepaid), parcel type, map pin, processing time, re-attempt flag",
                "Stop cards: entrance, handover, access rules, receiving windows and their status (suggested or verified)",
                "Buyer replies: confirmed window, new window, pickup point or no reply",
                "Live events: entrance closures, completed stops, simulated clock and position",
              ],
            },
            {
              h: "Processing",
              items: [
                "Look up the chance of first-attempt success for each stop in each block (history table, or the model in the experimental planner)",
                "Apply hard rules: verified site windows, weekend closures, buyer-confirmed windows, temporary closures",
                "Choose the block with the best chance; check each block's time capacity and push the cheapest stop later if it overflows",
                "Order stops inside each block by deadline, then nearest next drop-off point",
              ],
            },
            {
              h: "Output",
              items: [
                "Ordered route with block, simulated ETA, drop-off point and the reason for each stop",
                "Flags for the dispatcher: stops that cannot be scheduled, capacity or deadline risks; no stop is dropped",
                "Buyer Confirm list (risky orders) and replanning proposals with accept or override",
                "Evidence log of every action, exportable as CSV or JSON",
              ],
            },
          ].map((col) => (
            <div key={col.h} className="bg-surface p-4">
              <h3 className="mb-2 font-semibold">{col.h}</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
                {col.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="What the dataset shows" note={`First attempts of ${historical.orders.toLocaleString()} orders, ${historical.period.from} to ${historical.period.to}`} actions={<SourceTag kind="dataset" />} />
        <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">First-attempt success by site type and block</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="py-1 text-left font-normal">Site type</th>
                  {WINS.map((w) => (
                    <th key={w} className="py-1 text-center font-normal">
                      {w[0].toUpperCase() + w.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TYPES.map((t) => (
                  <tr key={t}>
                    <td className="py-1 pr-2">{TYPE_NAME[t]}</td>
                    {WINS.map((w) => {
                      const c = tw.find((x) => x.location_type === t && x.attempt_time === w)!;
                      return (
                        <td key={w} className="p-0.5">
                          <div className={cn("rounded-md py-1.5 text-center font-medium", cellTone(c.success))} title={`${c.n} first attempts`}>
                            {pct(c.success)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-faint">Schools and offices in the evening: about 43–44%. Industrial sites in the morning: 56%. Choosing the block is the biggest lever in this data.</p>
          </div>
          <div className="space-y-3 text-sm">
            <p className="font-medium">Other patterns</p>
            <ul className="space-y-1.5 text-ink-soft">
              <li>
                Offices at the weekend: {pct(td.find((x) => x.location_type === "office" && x.weekend)!.success)} vs {pct(td.find((x) => x.location_type === "office" && !x.weekend)!.success)} on weekdays.
              </li>
              <li>
                COD orders: {pct(historical.byPayment.find((x) => x.payment_type === "cod")!.success)} vs prepaid {pct(historical.byPayment.find((x) => x.payment_type === "prepaid")!.success)}.
              </li>
              <li>
                {pct(historical.missingPinShare)} of orders have no map pin; for one demo site the pins spread about 240 m, so a pin is not an entrance.
              </li>
              <li>
                Longer on-site processing time goes with lower success:{" "}
                {(historical.byServiceBand as { service_band: string; success: number }[])
                  .slice()
                  .sort((x, y) => (x.service_band.startsWith("≤") ? -1 : y.service_band.startsWith("≤") ? 1 : x.service_band.localeCompare(y.service_band)))
                  .map((b) => `${b.service_band} ${pct(b.success)}`)
                  .join(", ")}.
              </li>
              <li>
                Dataset KPIs match the case: first-attempt success {pct(historical.kpis.firstAttemptSuccess, 1)}, re-delivery {pct(historical.kpis.redeliveryRate, 1)}, return {pct(historical.kpis.returnRate, 1)}, average attempts {historical.kpis.avgAttempts.toFixed(2)}.
              </li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Rules-based planner (non-AI)" note="The main planner in this prototype" />
        <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Decision rules, in order</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>A buyer-confirmed window is fixed. If the site card forbids it, the stop is flagged for the dispatcher.</li>
              <li>Verified card rules are hard limits (office hours only, after 17:00, lunch 11:30–13:00 by 13:00, closed at weekends). Suggested rules are only preferences.</li>
              <li>A temporary closure removes blocks before it ends; closed for the rest of the shift means the stop is kept but not scheduled.</li>
              <li>Among allowed blocks, pick the highest chance in the history table ({Object.keys(successTable.cells).length} cells: site type × block × weekday or weekend × payment, from September data, shrunk toward {pct(successTable.prior, 1)} with {successTable.priorStrength} pseudo-attempts).</li>
              <li>If a block's travel, search and service time runs past its end, move the stop that loses the least chance to a later allowed block. Buyer-confirmed stops are never moved.</li>
              <li>Inside a block, serve deadlines first, then the nearest drop-off point. Verified or suggested entrances are used before raw pins.</li>
              <li>Buyer Confirm invites: COD, re-attempts, missing pin, chance under 70% in the planned block, or offices and schools at the weekend.</li>
            </ol>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Edge cases it cannot handle</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>Weather, traffic and flooding: not in the dataset, so they only enter as manual reports.</li>
              <li>Sites with very few visits get the site-type average, not their own pattern.</li>
              <li>Two buyers at one site with conflicting windows are planned separately; the rider may visit twice.</li>
              <li>Real travel times: distance is straight-line × 1.3 at an assumed speed.</li>
              <li>The effect of buyer confirmation or pickup points on success is unknown; the planner does not count any gain from them.</li>
              <li>Pickup points have no history, so their stops are not estimated.</li>
              <li>Rural and mountain areas: the dataset covers Ho Chi Minh City only.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Experimental model: is AI worth it here?" note={`${modelSpec.kind.replace("_", " ")} · trained on ${modelSpec.nTrain.toLocaleString()} attempts, tested on ${modelSpec.nHoldout.toLocaleString()} later attempts`} />
        <div className="space-y-4 px-4 py-4 text-sm">
          <p>
            <span className="font-medium">Target predicted:</span> {modelSpec.target}. <span className="font-medium">Inputs:</span> site type, block and their interaction, weekend,
            COD, parcel type, missing pin, processing time, re-attempt, and the site&apos;s own delivery history (shrunk toward its type). Raw rider notes are not used
            because many are written after arrival and would leak the result.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">Holdout, 1–15 Oct 2026</th>
                  <th className="py-2 text-right font-normal">AUC (higher is better)</th>
                  <th className="py-2 text-right font-normal">Brier score (lower is better)</th>
                  <th className="py-2 text-right font-normal">Log loss</th>
                </tr>
              </thead>
              <tbody>
                {scoreRows.map((r) => (
                  <tr key={r.name} className="border-b border-line/70">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right">{r.s.auc.toFixed(3)}</td>
                    <td className="py-2 text-right">{r.s.brier.toFixed(4)}</td>
                    <td className="py-2 text-right">{r.s.log_loss.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border-l-4 border-brand bg-brand-tint/60 p-3">
            <p className="font-medium">Verdict</p>
            <p className="text-ink-soft">
              On this dataset the learned model is not more accurate than the simple history table, and a site&apos;s own history adds almost nothing beyond its
              type. So the prototype runs on rules, and the model planner is shown only as an experiment. The pilot should test AI again once it has data the
              dataset lacks: arrival timestamps, verified entrances, buyer replies and real travel times.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Calibration on the holdout</p>
              <table className="w-full text-xs">
                <thead className="text-ink-faint">
                  <tr>
                    <th className="text-left font-normal">Group (by predicted chance)</th>
                    <th className="text-right font-normal">Predicted</th>
                    <th className="text-right font-normal">Observed</th>
                    <th className="text-right font-normal">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.calibration.map((c, i) => (
                    <tr key={i}>
                      <td>{i + 1} of {evaluation.calibration.length}</td>
                      <td className="text-right">{pct(c.mean_predicted)}</td>
                      <td className="text-right">{pct(c.observed)}</td>
                      <td className="text-right">{c.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="mb-1 font-medium">Failure modes</p>
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                {evaluation.byType.map((b) => (
                  <li key={b.location_type}>
                    {TYPE_NAME[b.location_type]}: AUC {b.auc === null ? "—" : b.auc.toFixed(2)} on {b.n} attempts
                    {b.auc !== null && b.auc < 0.6 ? " — close to guessing inside this type" : ""}
                  </li>
                ))}
                <li>Under-predicts the lowest group (predicted {pct(evaluation.calibration[0].mean_predicted)}, observed {pct(evaluation.calibration[0].observed)}).</li>
                <li>Holdout success ({pct(evaluation.split.holdoutSuccess, 1)}) was higher than training ({pct(evaluation.split.trainSuccess, 1)}); a drift like this needs monthly re-checks.</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Observational check (not causal): when the real attempt happened in the block the rules would choose, {pct(evaluation.windowCheck.rules_win.match_success, 1)} succeeded ({evaluation.windowCheck.rules_win.match_n} attempts) vs {pct(evaluation.windowCheck.rules_win.other_success, 1)} otherwise. For the model&apos;s choice: {pct(evaluation.windowCheck.model_win.match_success, 1)} vs {pct(evaluation.windowCheck.model_win.other_success, 1)}.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Simulation assumptions" note="Not in the dataset; to be measured in the pilot" actions={<SourceTag kind="assumption" />} />
        <ul className="list-disc space-y-1.5 px-9 py-4 text-sm text-ink-soft">
          {ASSUMPTION_LABELS.map((a) => (
            <li key={a.key}>{a.text}</li>
          ))}
          <li>Rider names, the backup rider, pickup points and one pre-verified card are demo fixtures.</li>
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Data and privacy" />
        <ul className="list-disc space-y-1.5 px-9 py-4 text-sm text-ink-soft">
          <li>The raw competition dataset is not in this website. A build script turns it into aggregate tables, model coefficients and de-identified demo fixtures.</li>
          <li>Order, buyer, location and rider IDs are removed. Buyer and site names are fictional. Pins are rotated into local metres, so no latitude or longitude is published.</li>
          <li>Demo shifts are 12 real rider-days: all 6 dataset rider zones, each on Wednesday 14 Oct and Saturday 10 Oct 2026, outside the model&apos;s training period. Rider names are fictional; the dataset has no tenure, so every rider uses a new-rider persona.</li>
          <li>Buyer messages are simulated on the page. Nothing is sent to any phone, inbox or payment system.</li>
        </ul>
      </Panel>
    </div>
  );
}
