// Builds the 3-sheet Excel workbook for a safe file. Library-free data (write-excel-file "Sheet" shape),
// so the same output is written in the browser and checked in tests.
import { TEMPLATE_COLUMNS } from "./intake";
import type { RiskKind } from "./importRisk";
import { LIMITS, NOTE_COLUMN, SAFE_DAY_PARCELS, type SafeFileResult } from "./safeFile";

type Cell = { value?: string | number; type?: StringConstructor | NumberConstructor; fontWeight?: "bold"; textColor?: string; backgroundColor?: string; wrap?: boolean } | null;
export interface WorkbookSheet { sheet: string; data: Cell[][]; columns?: { width: number }[] }

const RED = "#FDE2DD", GREEN = "#DDF3E8", YELLOW = "#FFF3B0", NAVY = "#113366", ORANGE = "#EE4D2D";
const RISK_LABEL: Record<RiskKind, string> = { overload: "System overload", ai: "AI uncertainty", data: "Anomalous data" };
const RISK_FILL: Record<RiskKind, string> = { overload: "#FFE3D6", ai: "#E3E8FF", data: "#FFF0C2" };

const txt = (value: string, extra: Omit<NonNullable<Cell>, "value" | "type"> = {}): Cell => ({ value, type: String, ...extra });
const head = (value: string): Cell => txt(value, { fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: NAVY });
const val = (v: string | number | null): Cell => (v === null || v === "" ? null : typeof v === "number" ? { value: v, type: Number } : { value: v, type: String });

export function buildSafeWorkbook(r: Extract<SafeFileResult, { ok: true }>, createdAt: string): WorkbookSheet[] {
  const b = r.before, a = r.after;
  const status = (bad: boolean) => txt(bad ? "RISK" : "CLEAR", { fontWeight: "bold", backgroundColor: bad ? RED : GREEN });
  const ov = (m: typeof b) => m.triggered.includes("overload");
  const ai = (m: typeof b) => m.triggered.includes("ai");
  const dt = (m: typeof b) => m.triggered.includes("data");
  const counts = { overload: 0, ai: 0, data: 0 } as Record<RiskKind, number>;
  for (const x of r.actions) counts[x.risk] += 1;

  const summary: Cell[][] = [
    [txt("S-Compass · Safe file report", { fontWeight: "bold", textColor: ORANGE })],
    [txt(`Original file: ${r.sourceName} (not changed)`)],
    [txt(`Created: ${createdAt} · Re-checked with the S-Compass import screening: ${a.blocked ? "STILL BLOCKED" : "PASSES ALL 3 CHECKS"}`, { fontWeight: "bold", backgroundColor: a.blocked ? RED : GREEN })],
    [],
    [head("Risk check"), head("Original file"), head(""), head("Safe file"), head(""), head("Limit")],
    [txt("System overload: largest rider-day", { fontWeight: "bold" }), val(`${b.maxDay} parcels`), status(ov(b)), val(`${a.maxDay} parcels`), status(ov(a)), val(`${LIMITS.day} parcels`)],
    [txt("System overload: heavy rider-days (over 40)"), val(String(b.heavyDays)), null, val(String(a.heavyDays)), null, val(`under ${LIMITS.heavy}`)],
    [txt("System overload: rows in the file"), val(b.rows.toLocaleString()), null, val(a.rows.toLocaleString()), null, val("10,000")],
    [txt("AI uncertainty: orders with no pin or repeat attempt", { fontWeight: "bold" }), val(`${b.lowInfoPct}%`), status(ai(b)), val(`${a.lowInfoPct}%`), status(ai(a)), val(`under ${LIMITS.ai}%`)],
    [txt("Anomalous data: rows quarantined", { fontWeight: "bold" }), val(`${b.quarantinedPct}%`), status(dt(b)), val(`${a.quarantinedPct}%`), status(dt(a)), val(`under ${LIMITS.quar}%`)],
    [txt("Anomalous data: rows with a warning"), val(`${b.warningPct}%`), null, val(`${a.warningPct}%`), null, val(`under ${LIMITS.warn}%`)],
    [],
    [head("What S-Compass did"), head(""), head(""), head(""), head(""), head("")],
    [txt(`Orders kept in the safe file (sheet 2): ${r.safe.length.toLocaleString()}`, { fontWeight: "bold" })],
    [txt(`Rows corrected automatically (yellow cells): ${r.fixedCount.toLocaleString()}`)],
    [txt(`Orders moved to the action list (sheet 3): ${r.actions.length.toLocaleString()}  ·  overload ${counts.overload.toLocaleString()} · AI ${counts.ai.toLocaleString()} · data ${counts.data.toLocaleString()}`)],
    [],
    [head("How each risk was solved"), head(""), head(""), head(""), head(""), head("")],
    ...r.solved.flatMap((x) => [[txt(RISK_LABEL[x.kind], { fontWeight: "bold", backgroundColor: RISK_FILL[x.kind] })], [txt(`   ${x.text}`)]]),
    [],
    [head("Safety rules"), head(""), head(""), head(""), head(""), head("")],
    [txt("1. Nothing is invented: no pin, rider, date or time is guessed.")],
    [txt("2. Only certain fixes are applied, and each one is written in the note column of sheet 2.")],
    [txt("3. Moved orders are not cancelled: each has a reason and a next step in sheet 3.")],
    [txt(`4. Overload rule: at most ${SAFE_DAY_PARCELS} parcels per rider-day in the safe file (cash-on-delivery orders first).`)],
    [txt("5. A dispatcher reviews and approves before anything is planned or sent to riders.")],
  ];

  const safeHeader = [...TEMPLATE_COLUMNS, NOTE_COLUMN].map(head);
  const safeData: Cell[][] = [safeHeader, ...r.safe.map((row) => [
    ...row.values.map((v, i) => {
      const c = val(v);
      if (!row.fixedCols.includes(i)) return c;
      return c ? { ...c, backgroundColor: YELLOW } : txt("", { backgroundColor: YELLOW });
    }),
    row.note ? txt(row.note, { backgroundColor: row.fixedCols.length ? YELLOW : undefined }) : null,
  ])];

  // Header names here are chosen so this sheet is never mistaken for a delivery table on upload.
  const actionData: Cell[][] = [
    ["Ref", "Assigned to", "Planned day", "Risk", "Problem", "Next step", "Who"].map(head),
    ...r.actions.map((x) => [txt(x.orderRef), txt(x.rider), txt(x.day), txt(RISK_LABEL[x.risk], { backgroundColor: RISK_FILL[x.risk], fontWeight: "bold" }), txt(x.problem, { wrap: true }), txt(x.action, { wrap: true }), txt(x.owner)]),
  ];

  return [
    { sheet: "1. Summary", data: summary, columns: [{ width: 46 }, { width: 18 }, { width: 9 }, { width: 18 }, { width: 9 }, { width: 14 }] },
    { sheet: "2. Safe orders", data: safeData, columns: [...TEMPLATE_COLUMNS.map((c) => ({ width: Math.max(12, c.length + 2) })), { width: 60 }] },
    { sheet: "3. Action list", data: actionData, columns: [{ width: 14 }, { width: 12 }, { width: 12 }, { width: 17 }, { width: 46 }, { width: 50 }, { width: 18 }] },
  ];
}
