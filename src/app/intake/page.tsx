"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, FlaskConical, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Stat } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { activeImportBatch, commitImportedBatch } from "@/lib/data";
import { log, recordImport, recordImportRemoved, selectShift } from "@/lib/demoState";
import { importUseReason } from "@/lib/importSafety";
import { screenImport, type RiskCase, type ScreenResult } from "@/lib/importRisk";
import { FAR_PIN_METERS, HEAVY_DAY_PARCELS, MAX_ROWS, messySampleRows, parseCsv, parseTable, selectDeliverySheet, templateRows, toCsvText, uploadProblem, type ImportBatch, type RowStatus } from "@/lib/intake";
import { downloadText } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

const STATUS_LABEL: Record<RowStatus, string> = { accepted: "Accepted", warning: "Accepted with warning", quarantined: "Quarantined" };
const STATUS_TONE: Record<RowStatus, "ok" | "warn" | "bad"> = { accepted: "ok", warning: "warn", quarantined: "bad" };

const RULES: [string, string, string, string][] = [
  ["Missing information", "Missing order ID value", "Uses a row-number ID. Supply stable order IDs for reliable duplicate detection.", "Accepted"],
  ["Missing information", "Mapped pin value missing or incomplete", "Uses a known suggested drop-off point when available; otherwise location review is still needed. Absent coordinate columns add a file note rather than a row warning. Buyer Confirm is a separate workflow.", "Accepted with warning"],
  ["Missing information", "Payment missing or unknown", "Defaults to COD. An absent payment column adds a file-level note; empty or unknown values in a mapped column add row warnings.", "Accepted with warning"],
  ["Missing information", "No place ID, name or pin", "Retains the row as a new place with a warning. New sites use place-type history; cards start unverified.", "Accepted with warning"],
  ["Missing information", "New place with no history", "Uses place-type history; the card starts unverified. No invented site evidence.", "Accepted"],
  ["Missing information", "No rider, or missing/unknown place type", "Quarantines the row. Correct the source file and check again; no in-app resolution is available yet.", "Quarantined"],
  ["Invalid dates or values", "Impossible/missing date or date outside 2020–2030", "Cannot create a valid rider-day; quarantines the row.", "Quarantined"],
  ["Invalid dates or values", "Service time below 0 or above 120 minutes", "Ignores the invalid service value; the Planner uses its existing fallback. Non-numeric service values parse as missing.", "Accepted with warning"],
  ["Invalid dates or values", "Unknown parcel type", "Uses standard parcel type and records a warning.", "Accepted with warning"],
  ["Duplicates", "Same order ID on the same day", "Quarantines the later eligible copy, across riders too. A later delivery date is a re-attempt, not a duplicate. Row-number fallback IDs are excluded from this duplicate check.", "Quarantined"],
  ["Location anomalies", "Pin outside broad HCMC box", "Ignores the anomalous pin; retains the row with a warning. This is not an official boundary check.", "Accepted with warning"],
  ["Location anomalies", "Latitude and longitude swapped", "Swaps them only when the reversed pair fits the existing HCMC box; records a warning.", "Accepted with warning"],
  ["Location anomalies", `Pin more than ${FAR_PIN_METERS} m from the site's other pins`, "Prefers the site's suggested drop-off point; records a warning.", "Accepted with warning"],
  ["Location anomalies", "Different place types at one site", "Uses the first type and records a warning.", "Accepted with warning"],
  ["Rider-day capacity warnings", `More than ${HEAVY_DAY_PARCELS} eligible parcels in one rider-day`, "Retains eligible orders and flags the rider-day for review. Scheduling feasibility is assessed in Dispatcher. Backup-rider transfers require an explicit dispatcher action; there is no automatic redistribution.", "Accepted with warning"],
  ["File-size limits", `More than ${MAX_ROWS.toLocaleString()} data rows`, "Validates only the first batch up to the limit; reports the remainder as not processed. Split the source file for a later check/import.", "Not processed"],
  ["File-size limits", "Missing required columns", "Rejects the check before row validation. The currently imported dataset and plans remain unchanged.", "Not processed"],
];

const OPTIONAL_COLUMNS = [
  ["location_id / location_name", "Group orders at a site and name its Stop Card."],
  ["payment_type", "Payment category; missing values use the existing COD fallback."],
  ["parcel_type", "Parcel category; missing or unknown categories use standard."],
  ["address_latitude / address_longitude", "Location pin, checked against the demo geographic rules."],
  ["buyer_address_processing_time_min", "Service/processing time for the order."],
  ["attempt_no / is_reattempt", "Attempt number or explicit re-attempt flag."],
  ["delivery_status / attempt_time", "Recorded outcome and delivery block for historical context; not invented outcomes."],
];

async function readFile(file: File): Promise<{ rows: unknown[][]; sheet: string | null }> {
  const name = file.name.toLowerCase();
  const problem = uploadProblem(file.name, file.size);
  if (problem) throw new Error(problem);
  if (name.endsWith(".csv") || name.endsWith(".txt")) return { rows: parseCsv(await file.text()), sheet: null };
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return selectDeliverySheet(sheets as { sheet: string; data: unknown[][] }[], file.name);
}

export default function IntakePage() {
  const { state, update } = useDemo();
  const router = useRouter();
  const [batch, setBatch] = React.useState<ImportBatch | null>(() => activeImportBatch());
  const [isActive, setIsActive] = React.useState<boolean>(() => activeImportBatch() !== null);
  const [error, setError] = React.useState<{ text: string; found: string[] } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<RowStatus | "issues">("issues");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [requirementsOpen, setRequirementsOpen] = React.useState(false);
  const [riskRecorded, setRiskRecorded] = React.useState(false);

  // Reset demo (from any page) clears the global import store and sets a new session id.
  // This page keeps its own local copy of the checked/imported batch, so re-sync it here —
  // otherwise Reset appears to do nothing until the user navigates away and back.
  React.useEffect(() => {
    const active = activeImportBatch();
    setBatch(active);
    setIsActive(active !== null);
    setError(null);
    setNote(null);
    setRiskRecorded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId]);

  const check = (rows: unknown[][], fileName: string, sheet: string | null) => {
    setRiskRecorded(false);
    const t0 = performance.now();
    const res = parseTable(rows, fileName, sheet);
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      const text = `Case C — Anomalous data: ${res.error} A/B were not assessed; no delivery rows were imported.`;
      setError({ text, found: res.foundColumns });
      setBatch(activeImportBatch());
      setIsActive(activeImportBatch() !== null);
      update((st) => log(st, { type: "import_risk_blocked", role: "dispatcher", summary: "Case C — structural file validation stopped import", input: fileName, output: text }));
      return;
    }
    setError(null);
    setBatch(res.batch);
    setIsActive(false);
    setNote(`Checked ${res.batch.summary.rowsRead.toLocaleString()} rows in ${ms} ms. Nothing is in the plan yet: review the results, then import.`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const { rows, sheet } = await readFile(file);
      check(rows, file.name, sheet);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "The file could not be read.";
      const text = reason.startsWith("Case ") ? reason : `Case C — Anomalous data: ${reason} Rows and AI inference were not checked.`;
      setError({ text, found: [] });
      setBatch(activeImportBatch());
      setIsActive(activeImportBatch() !== null);
      update((st) => log(st, { type: "import_risk_blocked", role: "dispatcher", summary: "File reading stopped import", input: file.name, output: text }));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = () => {
    if (!batch) return;
    const sc = screenImport(batch);
    if (sc.status === "blocked") {
      setNote("This file was stopped by risk screening and cannot be imported. Record the incident in Evidence instead.");
      return;
    }
    const previousBatch = activeImportBatch();
    const lockReason = previousBatch ? importUseReason(state, previousBatch) : null;
    if (lockReason) {
      setNote(lockReason);
      return;
    }
    const warn = commitImportedBatch(batch);
    if (warn) { setNote(`Import stopped: ${warn} The active dataset and plans are unchanged.`); return; }
    const s = batch.summary;
    update((st) => {
      const selectedOldImport = previousBatch?.shifts.some((shift) => shift.id === st.shiftId) ?? false;
      const next = selectedOldImport && batch.shifts[0] ? selectShift(st, batch.shifts[0].id) : st;
      const imported = recordImport(
        next,
        `Imported ${batch.fileName}: ${s.riderDays} rider-days`,
        `${s.rowsRead} rows read · ${s.accepted} accepted · ${s.warning} with warning · ${s.quarantined} quarantined · ${s.notProcessed} not processed · ${s.heavyDays} heavy days`,
      );
      return log(imported, {
        type: "import_risk_passed",
        role: "dispatcher",
        summary: `${sc.incidentId}: screening passed${sc.status === "warning" ? " with warnings" : ""} — eligible orders only`,
        input: batch.fileName,
        output: sc.okReason,
      });
    });
    setIsActive(true);
    setNote(warn ?? `Imported. ${s.riderDays} rider-days are now in the Dispatcher’s rider list, marked “Imported”. Quarantined rows are not planned.`);
  };

  const recordRiskIncident = () => {
    if (!batch) return;
    const sc = screenImport(batch);
    if (sc.status !== "blocked") return;
    const hit = sc.cases.filter((c) => c.triggered);
    update((st) =>
      log(st, {
        type: "import_risk_blocked",
        role: "dispatcher",
        summary: `${sc.incidentId}: ${hit.map((c) => c.label).join(", ")} — import stopped`,
        input: `${batch.fileName} · ${batch.summary.rowsRead} rows`,
        output: hit.map((c) => `${c.label}: ${c.detail}`).join(" | "),
      }),
    );
    setRiskRecorded(true);
    setNote("Risk incident recorded in Evidence. Nothing was imported; the current plans are unchanged.");
  };

  const open = (shiftId: string) => {
    update((st) => selectShift(st, shiftId));
    router.push("/dispatcher");
  };

  const remove = () => {
    const currentBatch = activeImportBatch();
    const lockReason = currentBatch ? importUseReason(state, currentBatch) : null;
    if (lockReason) {
      setNote(lockReason);
      return;
    }
    const warn = commitImportedBatch(null);
    if (warn) { setNote(`Removal stopped: ${warn} The active dataset and plans are unchanged.`); return; }
    update((st) => recordImportRemoved(st));
    setBatch(null);
    setIsActive(false);
    setNote("Imported data removed. The demo riders are unchanged.");
  };

  const s = batch?.summary;
  const screen = batch ? screenImport(batch) : null;
  const currentBatch = activeImportBatch();
  const importLock = currentBatch ? importUseReason(state, currentBatch) : null;
  const order: Record<RowStatus, number> = { quarantined: 0, warning: 1, accepted: 2 };
  const rows = (batch?.rows ?? []).filter((r) => (filter === "issues" ? true : r.status === filter)).sort((a, b) => order[a.status] - order[b.status] || a.row - b.row);
  const shown = rows.slice(0, 300);

  return (
    <div className="space-y-5">
      <Panel>
        <div className="space-y-2 border-b border-line px-5 py-4">
          <p className="text-base">Import and validate delivery orders from Excel or CSV before planning.</p>
          <p className="text-sm text-ink-soft">Valid orders proceed to planning. Records requiring review are flagged or quarantined.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Choose an Excel or CSV file" />
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload /> {busy ? "Reading…" : "Upload File"}
          </Button>
          <Button onClick={() => check(messySampleRows(), "practice-file-fictional.csv", null)} disabled={busy}>
            <FlaskConical /> Try Sample Data
          </Button>
          <Button variant="ghost" onClick={() => downloadText("s-compass-template.csv", toCsvText(templateRows()), "text/csv")}>
            <Download /> Download Template
          </Button>
          <Button variant="ghost" onClick={() => downloadText("s-compass-practice-file-fictional.csv", toCsvText(messySampleRows()), "text/csv")}>
            <FileSpreadsheet /> Download Sample CSV
          </Button>
          <Button variant="ghost" aria-expanded={requirementsOpen} aria-controls="file-requirements" onClick={() => setRequirementsOpen((value) => !value)}>File Requirements</Button>
          {activeImportBatch() ? (
            <Button variant="danger" onClick={remove} className="ml-auto" disabled={!!importLock}>
              <Trash2 /> Remove imported data
            </Button>
          ) : null}
        </div>
        {requirementsOpen ? <FileRequirements /> : null}
        <p className="border-t border-line px-4 py-3 text-xs text-ink-soft"><b>Browser Demo</b> — Imported data is stored locally in this browser. No live delivery system is connected.</p>
      </Panel>

      {note ? <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">{note}</div> : null}
      {importLock ? <div role="alert" className="rounded-lg border border-warn/40 bg-warn-tint px-4 py-3 text-sm text-warn">{importLock}</div> : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad-tint px-4 py-3 text-sm text-bad">
          <div className="font-medium">{error.text}</div>
          {error.found.length ? <div className="mt-1 text-xs">Columns found in the file: {error.found.join(", ")}</div> : null}
          <div className="mt-1 text-xs">Nothing was imported, so the plans are unchanged.</div>
        </div>
      ) : null}

      {batch && s ? (
        <>
          {screen ? <RiskScreen screen={screen} recorded={riskRecorded} onRecord={recordRiskIncident} /> : null}
          <Panel>
            <PanelHeader
              title={`Check results · ${batch.fileName}${batch.sheet ? ` (sheet “${batch.sheet}”)` : ""}`}
              note={isActive ? "Eligible rider-days are ready to open below." : "Checked — Not Imported"}
              actions={
                isActive ? (
                  <Badge tone="ok">Imported — Available in Dispatcher</Badge>
                ) : screen?.status === "blocked" ? (
                  <Badge tone="bad">Import stopped — see risk screening</Badge>
                ) : (
                  <Button variant="primary" size="sm" onClick={doImport} disabled={s.riderDays === 0 || !!importLock}>
                    {currentBatch ? "Replace with" : "Import"} {s.riderDays} rider-day{s.riderDays === 1 ? "" : "s"}
                  </Button>
                )
              }
            />
            <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Rows read" value={s.rowsRead.toLocaleString()} sub="validated in this batch" />
              <Stat label="Accepted" value={s.accepted.toLocaleString()} sub="no problem found" />
              <Stat label="Accepted with warning" value={s.warning.toLocaleString()} sub="eligible with stated fallbacks" />
              <Stat label="Quarantined" value={s.quarantined.toLocaleString()} sub="excluded from planning" />
              <Stat label="Eligible for planning" value={(s.accepted + s.warning).toLocaleString()} sub="accepted + accepted with warning" />
              {s.notProcessed ? <Stat label="Not processed" value={s.notProcessed.toLocaleString()} sub="outside the current batch limit" /> : null}
              <Stat label="Rider-days" value={s.riderDays.toLocaleString()} sub={`${s.heavyDays} heavy (> ${HEAVY_DAY_PARCELS} parcels)`} />
              <Stat label="Places" value={s.places.toLocaleString()} sub="new cards, unverified" />
            </div>
            {s.notProcessed ? <p role="status" className="border-t border-line bg-warn-tint px-4 py-3 text-sm text-warn">{(s.rowsRead + s.notProcessed).toLocaleString()} source rows: only the first {MAX_ROWS.toLocaleString()} were validated; {s.notProcessed.toLocaleString()} were not processed.</p> : null}
            {batch.fileNotes.some((note) => !note.startsWith("Heavy day:")) ? (
              <ul className="space-y-1 border-t border-line px-4 py-3 text-sm text-warn">
                {batch.fileNotes.filter((note) => !note.startsWith("Heavy day:")).map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            ) : null}
            <div className="border-t border-line px-4 py-3">
              <details className="ui-disclosure text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-semibold">
                  <span>Column Recognition</span>
                  <span className="text-xs font-normal text-ink-soft">{Object.keys(batch.columns).length} columns recognized · {(["order_id", "rider_id", "date", "location_type"] as const).filter((field) => field in batch.columns).length}/4 required fields found · View mappings</span>
                </summary>
                <p className="mt-2 text-xs text-ink-soft">See how columns from your file were matched to S-Compass fields. This does not change your data.</p>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(batch.columns).map(([field, original]) => <div key={field} className="rounded-md bg-canvas px-3 py-2"><dt className="break-words font-medium">{original}</dt><dd className="break-all text-xs text-ink-soft">→ {field}</dd></div>)}</dl>
              </details>
            </div>
          </Panel>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Panel className="min-w-0">
              <PanelHeader
                title="Order Issues"
                note={`${batch.rows.length.toLocaleString()} rows have a warning or were quarantined. Rows with no problem are not listed.`}
                actions={
                  <div className="inline-flex max-w-full flex-wrap rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="Filter order issues">
                    {(["issues", "warning", "quarantined"] as const).map((f) => (
                      <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-ink text-white" : "text-ink-soft"}`}>
                        {f === "issues" ? "All" : STATUS_LABEL[f]}
                      </button>
                    ))}
                  </div>
                }
              />
              <p className="px-4 py-2 text-xs text-ink-soft sm:hidden">Swipe the table to view full validation details.</p>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="sticky top-0 bg-canvas text-left text-xs text-ink-faint">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Rider · date</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">Validation details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.row} className="border-t border-line align-top">
                        <td className="px-3 py-2 tabular-nums text-ink-faint">{r.row}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{r.orderId}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                          {r.riderId} · {r.date || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                        </td>
                        <td className="px-3 py-2 text-ink-soft">{r.issues.join(" · ")}</td>
                      </tr>
                    ))}
                    {shown.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-ink-faint">
                          No rows in this group.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                {rows.length > shown.length ? <div className="px-3 py-2 text-xs text-ink-faint">Showing the first {shown.length} of {rows.length.toLocaleString()} rows.</div> : null}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={isActive ? "Imported Rider-days" : "Rider-days Ready to Import"} note={isActive ? "Choose the rider-day to review in Dispatcher." : "Preview only. Import explicitly to enable planning."} />
              <ul className="max-h-[560px] divide-y divide-line overflow-auto">
                {batch.shiftInfo.map((x) => (
                  <li key={x.shiftId} className="space-y-3 px-4 py-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words text-base font-semibold">{x.riderLabel.replace(/^Imported · /, "")}</div>
                        <div className="text-xs text-ink-faint">{x.weekday} {x.date}</div>
                        <div className="mt-1 font-medium">{x.parcels} eligible parcels</div>
                        {!x.heavy ? <Badge tone="ok">No capacity warning</Badge> : null}
                      </div>
                      <Button size="sm" className="shrink-0" onClick={() => open(x.shiftId)} disabled={!isActive}>
                        Open in Dispatcher
                      </Button>
                    </div>
                    {x.heavy ? <div className="rounded-lg border border-warn/30 bg-warn-tint p-3">
                      <Badge tone="warn">Capacity review</Badge>
                      <p className="mt-2 text-sm">This rider-day has {x.parcels} parcels, above the {HEAVY_DAY_PARCELS}-parcel demo warning threshold. This is a rider-day warning, not an individual order quarantine.</p>
                      <details className="ui-disclosure mt-2 text-sm">
                        <summary className="w-fit cursor-pointer font-medium text-info">Warning details</summary>
                        <p className="pt-2 text-ink-soft">Review scheduling in Dispatcher; any transfer to a backup rider requires an explicit dispatcher action. Individual row statuses and parcel eligibility are unchanged. Orders are not automatically reassigned.</p>
                      </details>
                    </div> : null}
                  </li>
                ))}
                {batch.shiftInfo.length === 0 ? <li className="px-4 py-6 text-center text-sm text-ink-faint">No rider-day could be built: every row was quarantined.</li> : null}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}

      <Panel className="p-4"><details className="ui-disclosure"><summary className="cursor-pointer font-semibold">Validation Rules &amp; Safe Fallbacks</summary>
        <p className="my-3 text-sm text-ink-soft">Deterministic demo policies, not AI decisions or automatically learned thresholds. Final row status reflects all applicable checks. Correct quarantined source rows and check again before importing.</p>
        <div className="space-y-4">{Array.from(new Set(RULES.map(([group]) => group))).map((group) => <section key={group}><h3 className="mb-2 font-semibold">{group}</h3><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-canvas text-left text-xs text-ink-soft"><tr><th className="px-3 py-2">Input problem</th><th className="px-3 py-2">Current handling</th><th className="px-3 py-2">Result</th></tr></thead><tbody>{RULES.filter(([category]) => category === group).map(([, problem, action, result]) => <tr key={problem} className="border-t border-line align-top"><td className="px-3 py-2 font-medium">{problem}</td><td className="px-3 py-2 text-ink-soft">{action}</td><td className="px-3 py-2"><Badge tone={result === "Quarantined" ? "bad" : result === "Accepted with warning" ? "warn" : result === "Not processed" ? "neutral" : "ok"}>{result}</Badge></td></tr>)}</tbody></table></div></section>)}</div>
        <p className="mt-4 text-xs text-ink-soft">Session: {state.sessionId.slice(-6)} · Import and removal actions are recorded in Evidence.</p>
      </details></Panel>
    </div>
  );
}

function RiskScreen({ screen, recorded, onRecord }: { screen: ScreenResult; recorded: boolean; onRecord: () => void }) {
  const blocked = screen.status === "blocked";
  const primaryLabel = screen.cases.find((c) => c.kind === screen.primary)?.label;
  return (
    <Panel aria-label="Import risk screening">
      <div className={`flex flex-wrap items-start gap-3 border-b border-line px-5 py-4 ${blocked ? "bg-bad-tint" : "bg-ok-tint"}`}>
        {blocked ? <ShieldAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-bad" /> : <ShieldCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-ok" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{blocked ? `Import stopped — ${primaryLabel}` : screen.status === "warning" ? "Screening passed with warnings — eligible rows only" : "Screening passed — safe to import"}</h2>
          <p className="mt-1 text-sm text-ink-soft">{blocked ? "This file falls into a risk case, so it is not imported. Record the incident in Evidence, fix the source file, then check again." : screen.okReason}</p>
          <p className="mt-1 text-xs text-ink-faint">Incident {screen.incidentId} · deterministic demo screening, not a learned model</p>
        </div>
        {blocked ? (
          <Button size="sm" variant={recorded ? "outline" : "danger"} onClick={onRecord} disabled={recorded}>
            <FileText /> {recorded ? "Recorded in Evidence" : "Record incident in Evidence"}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        {screen.cases.map((c) => (
          <div key={c.kind} className={`rounded-lg border p-3 ${c.triggered ? "border-bad/30 bg-bad-tint" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              {c.triggered ? <AlertTriangle aria-hidden="true" className="size-4 text-bad" /> : <CheckCircle2 aria-hidden="true" className="size-4 text-ok" />}
              <h3 className="text-sm font-semibold">{c.label}</h3>
              <Badge tone={c.triggered ? "bad" : "ok"}>{c.triggered ? "Risk found" : "Clear"}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">{c.reason}</p>
            <p className="mt-1 text-xs text-ink-faint">{c.detail}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FileRequirements() {
  return <section id="file-requirements" aria-label="File Requirements" className="ui-reveal grid gap-5 border-t border-line p-4 text-sm md:grid-cols-2">
    <div><h3 className="mb-2 font-semibold">Required Columns</h3><ul className="list-inside list-disc space-y-1">{["order_id", "rider_id", "delivery_date", "location_type"].map((column) => <li key={column}><code>{column}</code></li>)}</ul><p className="mt-2 text-ink-soft">Location types: school, office, industrial, gated_facility. A missing required column rejects the file check.</p></div>
    <div><h3 className="mb-2 font-semibold">Optional Columns</h3><dl className="space-y-2">{OPTIONAL_COLUMNS.map(([columns, purpose]) => <div key={columns}><dt className="break-words font-medium">{columns}</dt><dd className="text-ink-soft">{purpose}</dd></div>)}</dl></div>
    <div><h3 className="mb-2 font-semibold">File Compatibility</h3><ul className="list-disc space-y-2 pl-5 text-ink-soft"><li>CSV (.csv or .txt) and Excel .xlsx. Old .xls files must be saved as .xlsx or CSV.</li><li>Header detection checks the first 10 rows and chooses the most recognized columns. Common English/Vietnamese aliases and case-dataset headers are supported.</li><li>Excel: checks worksheets and uses the recognizable sheet with the most rows read; the first sheet wins ties. There is no manual worksheet selector.</li><li>The downloadable sample is fictional; the template supplies canonical headers.</li></ul></div>
    <div><h3 className="mb-2 font-semibold">Demo Validation Rules</h3><ul className="list-disc space-y-2 pl-5 text-ink-soft"><li>Only the first {MAX_ROWS.toLocaleString()} data rows per batch are validated. Additional rows are reported as Not processed.</li><li>More than {HEAVY_DAY_PARCELS} eligible parcels flags a rider-day for review; pins over {FAR_PIN_METERS} m from site peers trigger review.</li><li>Service time outside 0–120 minutes is ignored; missing/unreadable values use the existing fallback.</li><li>Broad HCMC box: 10.3–11.2° N, 106.3–107.1° E; not an official city boundary.</li><li>These are static demo heuristics, not empirically validated Calculation Sheet thresholds. They do not learn or change automatically.</li><li>Import is explicit. Data stays in this browser; replacement and removal safeguards remain in force. No live delivery system is connected.</li></ul></div>
  </section>;
}
