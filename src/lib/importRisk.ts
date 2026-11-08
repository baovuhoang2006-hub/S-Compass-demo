// Import risk screening: after a file is checked, sort it into the three final-round
// risk categories (system overload / AI uncertainty / anomalous data) and decide whether
// it is safe to import. A blocked file is NOT imported at all (hard stop); the dispatcher
// records the incident in Evidence. These are deterministic demo heuristics, not learned
// thresholds, and they do not change the per-row validation already done in intake.ts.

import { HEAVY_DAY_PARCELS, MAX_ROWS, type ImportBatch } from "./intake";

export type RiskKind = "overload" | "ai" | "data";
export type ScreenStatus = "ok" | "blocked";

export interface RiskCase {
  kind: RiskKind;
  label: string;
  triggered: boolean;
  reason: string; // one plain sentence: why it is (not) a problem
  detail: string; // the numbers behind the reason
}

export interface ScreenResult {
  status: ScreenStatus;
  primary: RiskKind | null; // the main reason an import is blocked
  cases: RiskCase[]; // always three, in a fixed order
  okReason: string; // why the file is safe to import (when ok)
  incidentId: string; // stable id for Evidence
}

// Adjustable demo thresholds. Kept here so the UI and tests read the same numbers.
export const OVERLOAD_DAY_PARCELS = HEAVY_DAY_PARCELS * 2; // one rider-day a single shift cannot absorb
export const OVERLOAD_HEAVY_DAYS = 3; // many heavy rider-days at once strain the whole fleet
export const AI_LOWINFO_SHARE = 0.5; // half or more of the orders give the estimate little to go on
export const ANOMALY_QUAR_SHARE = 0.25; // a quarter or more of the rows had to be quarantined
export const ANOMALY_WARN_SHARE = 0.5; // half or more of the rows needed a fallback

const LABEL: Record<RiskKind, string> = {
  overload: "System overload",
  ai: "AI uncertainty",
  data: "Anomalous data",
};

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function incidentId(batch: ImportBatch) {
  const seed = `${batch.fileName}|${batch.summary.rowsRead}|${batch.summary.quarantined}|${batch.importedAt}`;
  let hash = 2166136261;
  for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `IMPORT-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function screenImport(batch: ImportBatch): ScreenResult {
  const s = batch.summary;
  const eligible = batch.shifts.flatMap((sh) => sh.stops);
  const nEligible = eligible.length;
  const maxDay = batch.shiftInfo.reduce((m, x) => Math.max(m, x.parcels), 0);
  const totalSource = s.rowsRead + s.notProcessed;

  // A — System overload: more work than one plan can safely carry.
  const overloadHit = s.notProcessed > 0 || maxDay > OVERLOAD_DAY_PARCELS || totalSource > MAX_ROWS || s.heavyDays >= OVERLOAD_HEAVY_DAYS;
  const overload: RiskCase = {
    kind: "overload",
    label: LABEL.overload,
    triggered: overloadHit,
    reason: overloadHit
      ? "Too many parcels for one plan, so the file is stopped before it can overload the schedule."
      : "Volume is within what one plan can carry.",
    detail: `Largest rider-day ${maxDay} parcels (limit ${OVERLOAD_DAY_PARCELS}); ${s.heavyDays} heavy rider-day(s) (limit ${OVERLOAD_HEAVY_DAYS}); ${totalSource.toLocaleString()} source rows${s.notProcessed ? `, ${s.notProcessed.toLocaleString()} beyond the ${MAX_ROWS.toLocaleString()}-row limit` : ""}.`,
  };

  // B — AI uncertainty: a large share of orders give the success estimate little to go on.
  const lowInfo = eligible.filter((st) => st.pin === null || st.isReattempt).length;
  const lowShare = nEligible ? lowInfo / nEligible : 0;
  const aiHit = lowShare >= AI_LOWINFO_SHARE;
  const ai: RiskCase = {
    kind: "ai",
    label: LABEL.ai,
    triggered: aiHit,
    reason: aiHit
      ? "Most orders have no map pin or are repeat attempts, so the success estimate would be unreliable."
      : "Enough orders have a pin and a first-attempt history for a usable estimate.",
    detail: `${pct(lowInfo, nEligible)}% of ${nEligible.toLocaleString()} eligible orders lack a pin or are repeat attempts (limit ${Math.round(AI_LOWINFO_SHARE * 100)}%).`,
  };

  // C — Anomalous data: too many rows had to be quarantined or fixed by a fallback.
  const quarShare = s.rowsRead ? s.quarantined / s.rowsRead : 0;
  const warnShare = s.rowsRead ? s.warning / s.rowsRead : 0;
  const dataHit = quarShare >= ANOMALY_QUAR_SHARE || warnShare >= ANOMALY_WARN_SHARE;
  const data: RiskCase = {
    kind: "data",
    label: LABEL.data,
    triggered: dataHit,
    reason: dataHit
      ? "Too much of the file is anomalous, so it is stopped instead of importing partly broken data."
      : "Only a small share of rows needed review, within the safe range.",
    detail: `${pct(s.quarantined, s.rowsRead)}% quarantined (limit ${Math.round(ANOMALY_QUAR_SHARE * 100)}%), ${pct(s.warning, s.rowsRead)}% with a warning (limit ${Math.round(ANOMALY_WARN_SHARE * 100)}%), of ${s.rowsRead.toLocaleString()} rows.`,
  };

  const cases = [overload, ai, data];
  const triggered = cases.filter((c) => c.triggered);
  const status: ScreenStatus = triggered.length > 0 ? "blocked" : "ok";
  const primary = triggered[0]?.kind ?? null;

  const okReason =
    `${(s.accepted + s.warning).toLocaleString()} of ${s.rowsRead.toLocaleString()} rows are usable and ${s.quarantined.toLocaleString()} were quarantined (under ${Math.round(ANOMALY_QUAR_SHARE * 100)}%). ` +
    `No rider-day is over ${OVERLOAD_DAY_PARCELS} parcels, and enough orders carry a pin for a usable estimate.`;

  return { status, primary, cases, okReason, incidentId: incidentId(batch) };
}
