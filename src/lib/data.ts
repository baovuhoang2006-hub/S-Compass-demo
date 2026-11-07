import fixturesJson from "@/data/demo-fixtures.json";
import historicalJson from "@/data/historical-stats.json";
import tableJson from "@/data/success-table.json";
import modelJson from "@/data/model.json";
import evaluationJson from "@/data/evaluation.json";
import type { KnowledgeRecord, PickupPoint, Rider, Shift } from "./types";

export const fixtures = fixturesJson as unknown as {
  riders: Rider[];
  knowledge: KnowledgeRecord[];
  shifts: Shift[];
  note: string;
};

export const historical = historicalJson;
export const successTable = tableJson as {
  prior: number;
  priorStrength: number;
  trainedOn: string;
  cells: Record<string, { p: number; n: number }>;
};
export const modelSpec = modelJson as unknown as {
  kind: string;
  target: string;
  trainedOn: string;
  nTrain: number;
  holdout: string;
  nHoldout: number;
  features: string[];
  coef: Record<string, number>;
  intercept: number;
  serviceMean: number;
  serviceSd: number;
  typeRate: Record<string, number>;
  typeWindowRate: Record<string, number>;
  priorStrength: number;
};
export const evaluation = evaluationJson;

export const knowledgeByKey: Record<string, KnowledgeRecord> = Object.fromEntries(
  fixtures.knowledge.map((k) => [k.key, k]),
);

/** Fictional partner pickup points used by the Buyer Confirm simulation (demo fixtures, two per zone). */
export const allPickupPoints: PickupPoint[] = fixtures.riders.flatMap((r) => r.pickupPoints);

export function riderById(id: string): Rider {
  const r = fixtures.riders.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rider ${id}`);
  return r;
}

export function riderOfShift(shift: Shift): Rider {
  return riderById(shift.riderId);
}

export function knowledgeForRider(riderId: string): KnowledgeRecord[] {
  return fixtures.knowledge.filter((k) => k.zone === riderId);
}

/** A backup rider used only as the target of an explicit parcel transfer (demo fixture). */
export const BACKUP_RIDER = "Backup rider · Hoa (veteran, demo fixture)";

export function shiftById(id: string): Shift {
  const s = fixtures.shifts.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown shift ${id}`);
  return s;
}

// ------------------------------------------------------------------ imported data (Data intake)
// One imported batch can be active at a time. Its riders, shifts and places are added to the same
// lists the demo uses, so the planner, stop cards and replanning work on them unchanged.
import type { ImportBatch } from "./intake";

const IMPORT_KEY = "s-compass-import-v1";
let activeImport: ImportBatch | null = null;

export function activeImportBatch(): ImportBatch | null {
  return activeImport;
}

export function setImported(batch: ImportBatch | null) {
  const keep = <T,>(arr: T[], isImported: (x: T) => boolean) => {
    for (let i = arr.length - 1; i >= 0; i--) if (isImported(arr[i])) arr.splice(i, 1);
  };
  keep(fixtures.riders, (r) => r.id.startsWith("imp-"));
  keep(fixtures.shifts, (s) => s.id.startsWith("imp-"));
  keep(fixtures.knowledge, (k) => k.key.startsWith("imp-"));
  for (const key of Object.keys(knowledgeByKey)) if (key.startsWith("imp-")) delete knowledgeByKey[key];
  activeImport = batch;
  if (!batch) return;
  fixtures.riders.push(...batch.riders);
  fixtures.shifts.push(...batch.shifts);
  fixtures.knowledge.push(...batch.knowledge);
  for (const k of batch.knowledge) knowledgeByKey[k.key] = k;
}

export function isImportedShift(id: string) {
  return id.startsWith("imp-");
}

/** Imported data is kept in this browser only (never sent to the shared database). */
export function saveImportedLocal(batch: ImportBatch | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (batch) window.localStorage.setItem(IMPORT_KEY, JSON.stringify(batch));
    else window.localStorage.removeItem(IMPORT_KEY);
    return null;
  } catch {
    return "The file is too large to keep after a page reload in this browser. It works until you reload.";
  }
}

export function loadImportedLocal(): ImportBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IMPORT_KEY);
    return raw ? (JSON.parse(raw) as ImportBatch) : null;
  } catch {
    return null;
  }
}
