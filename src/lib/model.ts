import { modelSpec } from "./data";
import type { Block, LocationType, Parcel, Payment } from "./types";

/**
 * Logistic-regression success model, trained in scripts/train_eval.py.
 * Target: was the attempt delivered on that day? Features mirror scripts/features.py exactly.
 * Holdout result: it does NOT beat the simpler history table (see /how-it-works),
 * so the model-assisted planner is labelled experimental.
 */
const LOC_TYPES: LocationType[] = ["school", "office", "industrial", "gated_facility"];
const WINDOWS: Block[] = ["morning", "afternoon", "evening"];
const PARCELS: Parcel[] = ["standard", "bulky", "fragile", "documents"];

export interface ModelInput {
  locType: LocationType;
  block: Block;
  weekend: boolean;
  payment: Payment;
  parcel: Parcel;
  hasPin: boolean;
  serviceMin: number | null;
  isReattempt: boolean;
  locHistory: { delivered: number; attempts: number };
  locBlockHistory: { delivered: number; attempts: number };
}

function logit(p: number) {
  const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  return Math.log(q / (1 - q));
}

export function smoothedLogitGap(successes: number, attempts: number, prior: number, strength = modelSpec.priorStrength) {
  const p = (successes + strength * prior) / (attempts + strength);
  return logit(p) - logit(prior);
}

export function featureVector(x: ModelInput): number[] {
  const f: Record<string, number> = Object.fromEntries(modelSpec.features.map((n) => [n, 0]));
  if (x.locType !== LOC_TYPES[0]) f[`type_${x.locType}`] = 1;
  if (x.block !== WINDOWS[0]) f[`win_${x.block}`] = 1;
  if (x.locType !== LOC_TYPES[0] && x.block !== WINDOWS[0]) f[`type_${x.locType}_x_win_${x.block}`] = 1;
  if (x.weekend) {
    f.weekend = 1;
    if (x.locType !== LOC_TYPES[0]) f[`weekend_x_type_${x.locType}`] = 1;
    if (x.block === "evening") f.weekend_x_win_evening = 1;
  }
  if (x.payment === "cod") {
    f.cod = 1;
    if (x.block === "evening") f.cod_x_win_evening = 1;
  }
  if (x.parcel !== PARCELS[0]) f[`parcel_${x.parcel}`] = 1;
  f.missing_pin = x.hasPin ? 0 : 1;
  if (x.serviceMin === null) f.service_min_missing = 1;
  else f.service_min_z = (x.serviceMin - modelSpec.serviceMean) / modelSpec.serviceSd;
  f.retry_attempt = x.isReattempt ? 1 : 0;
  f.loc_history = smoothedLogitGap(x.locHistory.delivered, x.locHistory.attempts, modelSpec.typeRate[x.locType]);
  f.loc_window_history = smoothedLogitGap(
    x.locBlockHistory.delivered,
    x.locBlockHistory.attempts,
    modelSpec.typeWindowRate[`${x.locType}|${x.block}`],
  );
  return modelSpec.features.map((n) => f[n]);
}

export function predictFromVector(v: number[]): number {
  let z = modelSpec.intercept;
  modelSpec.features.forEach((n, i) => {
    z += (modelSpec.coef[n] ?? 0) * v[i];
  });
  return 1 / (1 + Math.exp(-z));
}

export function predict(x: ModelInput): number {
  return predictFromVector(featureVector(x));
}

export type ModelFault = "none" | "nan" | "infinity" | "above_one" | "missing_feature";

/** Faults are accepted only by the Risk Challenge caller; normal planning passes no fault. */
export function checkedPredict(x: ModelInput, fault: ModelFault = "none"): { p: number | null; reason: string | null } {
  if (fault === "missing_feature") x = { ...x, locHistory: undefined as unknown as ModelInput["locHistory"] };
  if (!LOC_TYPES.includes(x.locType) || !WINDOWS.includes(x.block) || !PARCELS.includes(x.parcel) ||
      !["cod", "prepaid"].includes(x.payment) ||
      typeof x.weekend !== "boolean" || typeof x.hasPin !== "boolean" || typeof x.isReattempt !== "boolean" ||
      (x.serviceMin !== null && (!Number.isFinite(x.serviceMin) || x.serviceMin < 0)) ||
      !x.locHistory || !x.locBlockHistory ||
      ![x.locHistory.attempts, x.locHistory.delivered, x.locBlockHistory.attempts, x.locBlockHistory.delivered].every(Number.isFinite)) {
    return { p: null, reason: "Missing or invalid required model feature" };
  }
  const vector = featureVector(x);
  if (!vector.every(Number.isFinite)) return { p: null, reason: "Non-finite model feature" };
  const p = fault === "nan" ? NaN : fault === "infinity" ? Infinity : fault === "above_one" ? 1.25 : predictFromVector(vector);
  if (!Number.isFinite(p) || p < 0 || p > 1) return { p: null, reason: "Prediction is not a finite probability in [0, 1]" };
  return { p, reason: null };
}
