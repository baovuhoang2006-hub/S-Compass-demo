"use client";

import { Download, FileSpreadsheet, FlaskConical, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { SourceTag, Stat } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { activeImportBatch, saveImportedLocal, setImported } from "@/lib/data";
import { recordImport, recordImportRemoved, selectShift } from "@/lib/demoState";
import { importUseReason } from "@/lib/importSafety";
import { FAR_PIN_METERS, HEAVY_DAY_PARCELS, MAX_ROWS, messySampleRows, parseCsv, parseTable, templateRows, toCsvText, type ImportBatch, type RowStatus } from "@/lib/intake";
import { downloadText } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

const STATUS_LABEL: Record<RowStatus, string> = { accepted: "Accepted", warning: "Accepted with warning", quarantined: "Quarantined" };
const STATUS_TONE: Record<RowStatus, "ok" | "warn" | "bad"> = { accepted: "ok", warning: "warn", quarantined: "bad" };

const RULES: [string, string, string][] = [
  ["No map pin", "Uses the place’s suggested drop-off point if other orders there have pins; the buyer is invited by Buyer Confirm", "Accepted with warning"],
  ["Pin outside Ho Chi Minh City", "Pin ignored as anomalous; treated as no pin, buyer is asked", "Accepted with warning"],
  ["Latitude and longitude swapped", "Corrected automatically and shown", "Accepted with warning"],
  [`Pin more than 300 m from the place’s other pins`, "The place’s suggested drop-off point is used before the raw pin", "Accepted with warning"],
  ["Payment missing or unknown", "Treated as COD (the safer, riskier case), so the buyer is asked", "Accepted with warning"],
  ["Impossible handover time (below 0 or over 120 min)", "Ignored; the planner uses its default time", "Accepted with warning"],
  ["New place with no history", "Scored with the place-type average; card starts “unverified”", "Accepted"],
  [`More than ${HEAVY_DAY_PARCELS} parcels for one rider-day`, "Everything is planned; a late finish is flagged and a backup rider can take parcels", "Accepted with warning"],
  ["Unknown or missing place type", "No history to score it: the AI does not guess; a dispatcher must classify it", "Quarantined"],
  ["Impossible date (e.g. 31/02) or no date", "Cannot be put on a shift", "Quarantined"],
  ["Same order twice on the same day", "Later copy set aside (an order on a later day is a re-attempt, not a duplicate)", "Quarantined"],
  ["No rider", "The dispatcher must assign one", "Quarantined"],
  [`More than ${MAX_ROWS.toLocaleString()} rows`, "First batch processed; the rest is listed as not processed", "Not processed"],
];

async function readFile(file: File): Promise<{ rows: unknown[][]; sheet: string | null }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return { rows: parseCsv(await file.text()), sheet: null };
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported. In Excel choose File › Save As › Excel Workbook (.xlsx) or CSV.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  // Pick the sheet whose first rows look most like delivery data.
  let best = sheets[0];
  let bestScore = -1;
  for (const s of sheets) {
    const test = parseTable(s.data as unknown[][], file.name, s.sheet);
    const score = test.ok ? test.batch.summary.rowsRead : -1;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return { rows: (best?.data ?? []) as unknown[][], sheet: best?.sheet ?? null };
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

  const check = (rows: unknown[][], fileName: string, sheet: string | null) => {
    const t0 = performance.now();
    const res = parseTable(rows, fileName, sheet);
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      setError({ text: res.error, found: res.foundColumns });
      setBatch(null);
      setIsActive(false);
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
      setError({ text: e instanceof Error ? e.message : "The file could not be read.", found: [] });
      setBatch(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = () => {
    if (!batch) return;
    const previousBatch = activeImportBatch();
    const lockReason = previousBatch ? importUseReason(state, previousBatch) : null;
    if (lockReason) {
      setNote(lockReason);
      return;
    }
    setImported(batch);
    const warn = saveImportedLocal(batch);
    const s = batch.summary;
    update((st) => {
      const selectedOldImport = previousBatch?.shifts.some((shift) => shift.id === st.shiftId) ?? false;
      const next = selectedOldImport && batch.shifts[0] ? selectShift(st, batch.shifts[0].id) : st;
      return recordImport(
        next,
        `Imported ${batch.fileName}: ${s.riderDays} rider-days`,
        `${s.rowsRead} rows read · ${s.accepted} accepted · ${s.warning} with warning · ${s.quarantined} quarantined · ${s.notProcessed} not processed · ${s.heavyDays} heavy days`,
      );
    });
    setIsActive(true);
    setNote(warn ?? `Imported. ${s.riderDays} rider-days are now in the Dispatcher’s rider list, marked “Imported”. Quarantined rows are not planned.`);
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
    setImported(null);
    saveImportedLocal(null);
    update((st) => recordImportRemoved(st));
    setBatch(null);
    setIsActive(false);
    setNote("Imported data removed. The demo riders are unchanged.");
  };

  const s = batch?.summary;
  const currentBatch = activeImportBatch();
  const importLock = currentBatch ? importUseReason(state, currentBatch) : null;
  const order: Record<RowStatus, number> = { quarantined: 0, warning: 1, accepted: 2 };
  const rows = (batch?.rows ?? []).filter((r) => (filter === "issues" ? true : r.status === filter)).sort((a, b) => order[a.status] - order[b.status] || a.row - b.row);
  const shown = rows.slice(0, 300);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Data intake"
          note="Bring orders from an outside Excel (.xlsx) or CSV file. Every row is checked before planning, and nothing is dropped silently: each row is accepted, accepted with a warning, or quarantined for a dispatcher."
        />
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Choose an Excel or CSV file" />
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload /> {busy ? "Reading…" : "Upload Excel or CSV"}
          </Button>
          <Button onClick={() => check(messySampleRows(), "practice-file-fictional.csv", null)} disabled={busy}>
            <FlaskConical /> Check the practice file
          </Button>
          <Button variant="ghost" onClick={() => downloadText("s-compass-template.csv", toCsvText(templateRows()), "text/csv")}>
            <Download /> Template
          </Button>
          <Button variant="ghost" onClick={() => downloadText("s-compass-practice-file-fictional.csv", toCsvText(messySampleRows()), "text/csv")}>
            <FileSpreadsheet /> Practice file
          </Button>
          {activeImportBatch() ? (
            <Button variant="danger" onClick={remove} className="ml-auto" disabled={!!importLock}>
              <Trash2 /> Remove imported data
            </Button>
          ) : null}
        </div>
        <div className="border-t border-line px-4 py-3 text-xs leading-5 text-ink-faint">
          Required: <b>order_id</b>, <b>rider_id</b>, <b>delivery_date</b>, and <b>location_type</b> (school, office, industrial, gated_facility). Optional: location_id or location_name, payment_type,
          parcel_type, address_latitude, address_longitude, buyer_address_processing_time_min, attempt_no, delivery_status, attempt_time. Column names from the Shopee case dataset are recognised, plus common
          English and Vietnamese names. The header can be in any of the first 10 rows; for Excel, the sheet that looks most like delivery data is used. The practice file is fictional. Imported data stays in
          this browser only. Demo validation rules: more than {HEAVY_DAY_PARCELS} parcels marks a heavy rider-day, pins more than {FAR_PIN_METERS} m apart at one place trigger review, service time outside 0–120 minutes is ignored, and the HCMC check uses a broad bounding box (10.3–11.2° N, 106.3–107.1° E), not an official city boundary. These are demo heuristics, not empirical thresholds from the Calculation Sheet.
        </div>
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
          <Panel>
            <PanelHeader
              title={`Check results · ${batch.fileName}${batch.sheet ? ` (sheet “${batch.sheet}”)` : ""}`}
              note={isActive ? "Imported: these rider-days are in the Dispatcher." : "Checked only: not in the plan yet."}
              actions={
                isActive ? (
                  <Badge tone="ok">Imported</Badge>
                ) : (
                  <Button variant="primary" size="sm" onClick={doImport} disabled={s.riderDays === 0 || !!importLock}>
                    {currentBatch ? "Replace with" : "Import"} {s.riderDays} rider-day{s.riderDays === 1 ? "" : "s"}
                  </Button>
                )
              }
            />
            <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Rows read" value={s.rowsRead.toLocaleString()} sub={s.notProcessed ? `${s.notProcessed.toLocaleString()} not processed` : "all rows checked"} />
              <Stat label="Accepted" value={s.accepted.toLocaleString()} sub="no problem found" />
              <Stat label="Accepted with warning" value={s.warning.toLocaleString()} sub="planned, with a safe fallback" />
              <Stat label="Quarantined" value={s.quarantined.toLocaleString()} sub="not planned, dispatcher decides" />
              <Stat label="Rider-days" value={s.riderDays.toLocaleString()} sub={`${s.heavyDays} heavy (> ${HEAVY_DAY_PARCELS} parcels)`} />
              <Stat label="Places" value={s.places.toLocaleString()} sub="new cards, unverified" />
            </div>
            {batch.fileNotes.length ? (
              <ul className="space-y-1 border-t border-line px-4 py-3 text-sm text-warn">
                {batch.fileNotes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            ) : null}
            <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
              <SourceTag kind="live" /> Columns used:{" "}
              {Object.entries(batch.columns)
                .map(([f, c]) => `${c} → ${f}`)
                .join(" · ")}
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <Panel>
              <PanelHeader
                title="Rows that need attention"
                note={`${batch.rows.length.toLocaleString()} rows have a warning or were quarantined. Rows with no problem are not listed.`}
                actions={
                  <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
                    {(["issues", "warning", "quarantined"] as const).map((f) => (
                      <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-ink text-white" : "text-ink-soft"}`}>
                        {f === "issues" ? "All" : STATUS_LABEL[f]}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-canvas text-left text-xs text-ink-faint">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Rider · date</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">What S-Compass did</th>
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
              <PanelHeader title="Rider-days created" note={isActive ? "Open one to plan it with the same AI scorer and rules." : "Import first, then open a rider-day in the Dispatcher."} />
              <ul className="max-h-[560px] divide-y divide-line overflow-auto">
                {batch.shiftInfo.map((x) => (
                  <li key={x.shiftId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{x.riderLabel}</div>
                      <div className="text-xs text-ink-faint">
                        {x.weekday} {x.date} · {x.parcels} parcels {x.heavy ? <Badge tone="warn">Heavy day</Badge> : null}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => open(x.shiftId)} disabled={!isActive}>
                      Open
                    </Button>
                  </li>
                ))}
                {batch.shiftInfo.length === 0 ? <li className="px-4 py-6 text-center text-sm text-ink-faint">No rider-day could be built: every row was quarantined.</li> : null}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}

      <Panel>
        <PanelHeader title="How each problem is handled" note="The AI never guesses missing information. It uses a stated fallback, asks the buyer, or hands the row to a dispatcher." />
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-2">Problem in the file</th>
                <th className="px-4 py-2">What S-Compass does</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(([a, b, c]) => (
                <tr key={a} className="border-t border-line align-top">
                  <td className="px-4 py-2 font-medium">{a}</td>
                  <td className="px-4 py-2 text-ink-soft">{b}</td>
                  <td className="px-4 py-2">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
          Session: {state.sessionId.slice(-6)} · every import and removal is written to the Evidence log.
        </div>
      </Panel>
    </div>
  );
}
