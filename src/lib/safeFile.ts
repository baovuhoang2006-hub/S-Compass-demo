// Safe file: turn a risky delivery file into (1) a file that passes all three import checks and
// (2) an action list of the orders that were moved out, each with a reason and a next step.
// Rules: the original file is never changed; nothing is invented (no fake pins, riders or dates);
// only certain fixes are applied; every change is written down; a dispatcher still approves the import.
// Pure functions only, so the result is unit-tested against the app's own screening.

import {
  findHeader, MAX_ROWS, normHeader, parseDate, parseTable, TEMPLATE_COLUMNS, type ImportBatch,
} from "./intake";
import { AI_LOWINFO_SHARE, ANOMALY_QUAR_SHARE, ANOMALY_WARN_SHARE, OVERLOAD_DAY_PARCELS, OVERLOAD_HEAVY_DAYS, screenImport, type RiskKind } from "./importRisk";
import { HEAVY_DAY_PARCELS } from "./intake";

/** Parcels kept per rider-day in the safe file: at most the heavy-day threshold, so no rider-day is heavy. */
export const SAFE_DAY_PARCELS = HEAVY_DAY_PARCELS;
export const NOTE_COLUMN = "s_compass_note";
const HCMC = { latMin: 10.3, latMax: 11.2, lonMin: 106.3, lonMax: 107.1 };

export interface ActionRow {
  orderRef: string;
  rider: string;
  day: string;
  risk: RiskKind;
  problem: string;
  action: string;
  owner: "Dispatcher" | "Dispatcher + buyer";
}

export interface SafeRow {
  values: (string | number | null)[]; // TEMPLATE_COLUMNS order
  note: string;
  fixedCols: number[]; // template column indexes changed by a certain fix
}

export interface Metrics {
  maxDay: number;
  heavyDays: number;
  lowInfoPct: number;
  quarantinedPct: number;
  warningPct: number;
  rows: number;
  blocked: boolean;
  triggered: RiskKind[];
}

export type SafeFileResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      sourceName: string;
      safeName: string;
      before: Metrics;
      after: Metrics;
      safe: SafeRow[];
      actions: ActionRow[];
      fixedCount: number;
      solved: { kind: RiskKind; text: string }[];
    };

const s = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim());
const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = s(v).replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const inBox = (la: number, lo: number) => la >= HCMC.latMin && la <= HCMC.latMax && lo >= HCMC.lonMin && lo <= HCMC.lonMax;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function metricsOf(batch: ImportBatch): Metrics {
  const sm = batch.summary;
  const stops = batch.shifts.flatMap((x) => x.stops);
  const low = stops.filter((x) => x.pin === null || x.isReattempt).length;
  const sc = screenImport(batch);
  return {
    maxDay: batch.shiftInfo.reduce((m, x) => Math.max(m, x.parcels), 0),
    heavyDays: sm.heavyDays,
    lowInfoPct: pct(low, stops.length),
    quarantinedPct: pct(sm.quarantined, sm.rowsRead),
    warningPct: pct(sm.warning, sm.rowsRead),
    rows: sm.rowsRead + sm.notProcessed,
    blocked: sc.status === "blocked",
    triggered: sc.cases.filter((c) => c.triggered).map((c) => c.kind),
  };
}

/** Rows of the safe sheet (header + data), exactly as the app will read them back. */
export function safeTable(safe: SafeRow[]): (string | number | null)[][] {
  return [[...TEMPLATE_COLUMNS, NOTE_COLUMN], ...safe.map((r) => [...r.values, r.note])];
}

const COL = Object.fromEntries(TEMPLATE_COLUMNS.map((c, i) => [c, i])) as Record<string, number>;

export function buildSafeFile(rows: unknown[][], fileName: string): SafeFileResult {
  const res = parseTable(rows, fileName, null);
  if (!res.ok) return { ok: false, reason: `The file structure cannot be repaired automatically: ${res.error}` };
  const batch = res.batch;
  const before = metricsOf(batch);
  const sc = screenImport(batch);
  const hit = new Set(sc.cases.filter((c) => c.triggered).map((c) => c.kind));

  // Same row numbering as parseTable.
  const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => s(c) !== ""));
  const { index, map } = findHeader(nonEmpty);
  const body = nonEmpty.slice(index + 1);
  const cell = (r: unknown[], f: string) => {
    const i = (map as Record<string, number | undefined>)[f];
    return i === undefined ? undefined : r[i];
  };
  const issuesByRow = new Map(batch.rows.map((r) => [r.row, r]));
  // Normalised values from the importer, keyed by order + date (quarantined copies never reach a stop).
  const stopByKey = new Map<string, { type: string; payment: string; parcel: string; reattempt: boolean; service: number | null }>();
  for (const sh of batch.shifts) for (const st of sh.stops) {
    const order = st.buyer.replace(/^Buyer of /, "");
    stopByKey.set(`${order}|${sh.date}`, { type: st.locationType, payment: st.payment, parcel: st.parcel, reattempt: st.isReattempt, service: st.serviceMinutes });
  }

  const actions: ActionRow[] = [];
  type Cand = SafeRow & { order: string; rider: string; day: string; lowInfo: boolean; cod: boolean; seq: number };
  let cands: Cand[] = [];
  let fixedCount = 0;

  body.forEach((r, k) => {
    const rowNo = index + 2 + k;
    const order = s(cell(r, "order_id")) || `row-${rowNo}`;
    const rider = s(cell(r, "rider_id")) || "(none)";
    const day = parseDate(cell(r, "date")) ?? s(cell(r, "date"));
    if (k >= MAX_ROWS) {
      actions.push({ orderRef: order, rider, day, risk: "overload", problem: `Beyond the ${MAX_ROWS.toLocaleString()}-row batch limit`, action: "Import in the next batch", owner: "Dispatcher" });
      return;
    }
    const info = issuesByRow.get(rowNo);
    if (info?.status === "quarantined") {
      actions.push({ orderRef: order, rider, day, risk: "data", problem: info.issues.join("; "), action: "Correct the value in the source system, then import again", owner: "Dispatcher" });
      return;
    }
    const norm = stopByKey.get(`${order}|${day}`);
    if (!norm) {
      actions.push({ orderRef: order, rider, day, risk: "data", problem: "Row could not be matched to a checked order", action: "Review the row manually", owner: "Dispatcher" });
      return;
    }
    const notes: string[] = [];
    const fixed: number[] = [];
    let la = num(cell(r, "lat"));
    let lo = num(cell(r, "lon"));
    if (la !== null && lo !== null && !inBox(la, lo)) {
      if (inBox(lo, la)) { [la, lo] = [lo, la]; notes.push("Fixed: latitude/longitude were swapped"); fixed.push(COL.address_latitude, COL.address_longitude); }
      else { notes.push("Pin outside Ho Chi Minh City removed (not guessed)"); la = lo = null; fixed.push(COL.address_latitude, COL.address_longitude); }
    } else if ((la === null) !== (lo === null)) { notes.push("Half a map pin removed (not guessed)"); la = lo = null; fixed.push(COL.address_latitude, COL.address_longitude); }
    const rawService = s(cell(r, "service_min"));
    if (rawService && norm.service === null) { notes.push(`Fixed: impossible handover time "${rawService}" cleared, planner default used`); fixed.push(COL.buyer_address_processing_time_min); }
    const rawPay = s(cell(r, "payment"));
    if (!rawPay || normHeader(rawPay) !== norm.payment) { if (map.payment !== undefined) { notes.push(rawPay ? `Fixed: payment "${rawPay}" written as ${norm.payment}` : "Fixed: empty payment written as cod (safer)"); fixed.push(COL.payment_type); } }
    const rawType = s(cell(r, "location_type"));
    if (normHeader(rawType) !== norm.type) { notes.push(`Fixed: place type "${rawType}" written as ${norm.type}`); fixed.push(COL.location_type); }
    const rawParcel = s(cell(r, "parcel"));
    if (rawParcel && normHeader(rawParcel) !== norm.parcel) { notes.push(`Fixed: parcel "${rawParcel}" written as ${norm.parcel}`); fixed.push(COL.parcel_type); }
    if (fixed.length) fixedCount += 1;
    const place = s(cell(r, "location_id")) || s(cell(r, "location_name")) || "";
    const values: (string | number | null)[] = [order, rider, day, place, norm.type, norm.payment, norm.parcel, la, lo, norm.service, norm.reattempt ? 2 : 1];
    cands.push({ values, note: notes.join("; "), fixedCols: [...new Set(fixed)], order, rider, day, lowInfo: la === null || norm.reattempt, cod: norm.payment === "cod", seq: k });
  });

  // B — AI uncertainty: move low-information orders to the action list (they are not cancelled).
  const moveLowInfo = () => {
    const keep: Cand[] = [];
    for (const c of cands) {
      if (!c.lowInfo) { keep.push(c); continue; }
      const noPin = c.values[COL.address_latitude] === null;
      actions.push({
        orderRef: c.order, rider: c.rider, day: c.day, risk: "ai",
        problem: noPin && c.values[COL.attempt_no] === 2 ? "Repeat attempt and no map pin" : noPin ? "No usable map pin" : "Repeat attempt (failed before)",
        action: noPin ? "Call the buyer to confirm the address, or offer a pickup point" : "Send Buyer Confirm to choose a time, or offer a pickup point",
        owner: "Dispatcher + buyer",
      });
    }
    cands = keep;
  };
  if (hit.has("ai")) moveLowInfo();

  // A — System overload: keep at most SAFE_DAY_PARCELS per rider-day (COD first, then file order).
  const capDays = (cap: number) => {
    const groups = new Map<string, Cand[]>();
    for (const c of cands) groups.set(`${c.rider}|${c.day}`, [...(groups.get(`${c.rider}|${c.day}`) ?? []), c]);
    const keep: Cand[] = [];
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => Number(b.cod) - Number(a.cod) || a.seq - b.seq);
      sorted.forEach((c, i) => {
        if (i < cap) { keep.push({ ...c, note: [c.note, `Kept: ${Math.min(list.length, cap)} of ${list.length} for this rider-day`].filter(Boolean).join("; ") }); return; }
        actions.push({ orderRef: c.order, rider: c.rider, day: c.day, risk: "overload", problem: `Rider-day has ${list.length} parcels; safe load is ${cap}`, action: "Assign to a backup rider, an extra shift or the next day", owner: "Dispatcher" });
      });
    }
    cands = keep.sort((a, b) => a.seq - b.seq);
  };
  if (hit.has("overload")) capDays(SAFE_DAY_PARCELS);

  // Re-check with the app's own screening; tighten until the safe file passes (max 3 rounds).
  let after: Metrics | null = null;
  for (let round = 0; round < 3; round++) {
    const check = parseTable(safeTable(cands), "safe-check.csv", null);
    if (!check.ok) return { ok: false, reason: `The safe file could not be built: ${check.error}` };
    after = metricsOf(check.batch);
    if (!after.blocked) break;
    if (after.triggered.includes("ai") || after.triggered.includes("data")) moveLowInfo();
    if (after.triggered.includes("overload")) capDays(Math.floor(SAFE_DAY_PARCELS / 2));
  }
  if (!after || after.blocked || cands.length === 0) return { ok: false, reason: "No safe subset of this file could be found automatically. Use the action list and the dispatcher review." };

  const count = (k: RiskKind) => actions.filter((a) => a.risk === k).length;
  const solved: { kind: RiskKind; text: string }[] = [];
  if (before.triggered.includes("overload") || count("overload"))
    solved.push({ kind: "overload", text: `Split the work: each rider-day keeps at most ${SAFE_DAY_PARCELS} parcels (COD first); ${count("overload").toLocaleString()} orders move to the action list for a backup rider, extra shift, next day or next batch.` });
  if (before.triggered.includes("ai") || count("ai"))
    solved.push({ kind: "ai", text: `Separate low-information orders: ${count("ai").toLocaleString()} repeat or no-pin orders move to Buyer Confirm or a call list. They are not cancelled and no pin is guessed.` });
  if (before.triggered.includes("data") || count("data") || fixedCount)
    solved.push({ kind: "data", text: `Fix what is certain, separate what is not: ${fixedCount.toLocaleString()} rows corrected (marked yellow), ${count("data").toLocaleString()} broken rows moved out with their reason.` });

  const base = fileName.replace(/\.(csv|txt|xlsx)$/i, "");
  return { ok: true, sourceName: fileName, safeName: `${base}_SAFE.xlsx`, before, after, safe: cands.map(({ values, note, fixedCols }) => ({ values, note, fixedCols })), actions, fixedCount, solved };
}

export const LIMITS = { day: OVERLOAD_DAY_PARCELS, heavy: OVERLOAD_HEAVY_DAYS, ai: Math.round(AI_LOWINFO_SHARE * 100), quar: Math.round(ANOMALY_QUAR_SHARE * 100), warn: Math.round(ANOMALY_WARN_SHARE * 100) };
