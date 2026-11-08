import { knowledgeByKey } from "./data";
import { parseHHMM } from "./time";
import type { ActiveRestriction, Block, CardStatus, KnowledgeRecord, StopCard, WindowRestriction } from "./types";

export type CorrectionField = "entrance" | "handover" | "access" | "receiving_window";

export interface Correction {
  id: string;
  locationKey: string;
  field: CorrectionField | "confirmation" | "dispute";
  /** Approved instructions when submitted; detects stale/conflicting reviews. */
  snapshot?: string;
  previousValue?: string;
  provenance?: string;
  text: string;
  restrictionCode?: WindowRestriction["code"];
  proposedBy: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface CardOverlay {
  status?: CardStatus;
  /** A field correction alone does not verify unrelated dataset window rules. */
  datasetRulesVerified?: boolean;
  entrance?: string;
  handover?: string;
  extraAccess?: string[];
  extraWindows?: { text: string; restriction?: WindowRestriction }[];
  lastVerified?: string;
  verifiedBy?: string;
  source?: string;
  verificationRequested?: boolean;
  disputeReason?: string;
  temporaryClosure?: { text: string; untilMin: number | null; useAlternate: boolean } | null;
}

export interface OutcomeRecord {
  stopId: string;
  locationKey: string;
  block: Block;
  weekend: boolean;
  outcome: "delivered" | "failed";
  reason?: string;
  atMin: number;
  at: string;
}

/** Ready-made window restrictions offered in the correction form. */
export const RESTRICTION_PRESETS: { code: WindowRestriction["code"]; text: string; restriction: WindowRestriction }[] = [
  {
    code: "office_hours",
    text: "Receives in office hours only",
    restriction: { code: "office_hours", text: "Receives in office hours only", count: 0, blocks: ["morning", "afternoon"] },
  },
  {
    code: "lunch_only",
    text: "Receives only 11:30–13:00 (lunch shift)",
    restriction: { code: "lunch_only", text: "Receives only 11:30–13:00 (lunch shift)", count: 0, blocks: ["afternoon"], latest: "13:00" },
  },
  {
    code: "after_17",
    text: "Receives after 17:00 (end of work shift)",
    restriction: { code: "after_17", text: "Receives after 17:00 (end of work shift)", count: 0, blocks: ["evening"] },
  },
  {
    code: "no_evening",
    text: "Recipient cannot come out in the evening",
    restriction: { code: "no_evening", text: "Recipient cannot come out in the evening", count: 0, blocks: ["morning", "afternoon"] },
  },
  {
    code: "closed_weekend",
    text: "Closed at weekends",
    restriction: { code: "closed_weekend", text: "Closed at weekends", count: 0, weekdaysOnly: true },
  },
];

function toActive(r: WindowRestriction, strength: "hard" | "soft", source: string): ActiveRestriction | null {
  if (r.info) return null;
  return {
    code: r.code,
    text: r.text,
    strength,
    blocks: r.blocks,
    latestMin: r.latest ? parseHHMM(r.latest) : undefined,
    weekdaysOnly: r.weekdaysOnly,
    source,
  };
}

export function defaultStatus(rec: KnowledgeRecord): CardStatus {
  return rec.entranceNotes.length || rec.handoverNotes.length ? "suggested" : "unverified";
}

export function buildCard(
  key: string,
  overlay: CardOverlay | undefined,
  outcomes: OutcomeRecord[],
): StopCard {
  const rec = knowledgeByKey[key];
  if (!rec) throw new Error(`Unknown location ${key}`);
  const o = overlay ?? {};
  const status: CardStatus = o.status ?? defaultStatus(rec);
  const verified = status === "verified";
  const datasetRulesVerified = verified && o.datasetRulesVerified !== false;

  const datasetSource = `Dataset notes from ${rec.visits} visits (1–30 Sep 2026)`;
  const restrictions: ActiveRestriction[] = [];
  const seen = new Set<string>();
  for (const r of rec.windowRestrictions) {
    if (seen.has(r.code) || o.extraWindows?.some((w) => w.restriction?.code === r.code)) continue;
    seen.add(r.code);
    const a = toActive(r, datasetRulesVerified ? "hard" : "soft", datasetRulesVerified ? "Verified card" : `Suggested from ${r.count} dataset notes`);
    if (a) restrictions.push(a);
  }
  for (const w of o.extraWindows ?? []) {
    if (!w.restriction || seen.has(w.restriction.code)) continue;
    seen.add(w.restriction.code);
    const a = toActive(w.restriction, "hard", "Approved rider correction");
    if (a) restrictions.push(a);
  }
  if (o.temporaryClosure && !o.temporaryClosure.useAlternate) {
    restrictions.push({
      code: "temporary_closure",
      text: o.temporaryClosure.text,
      strength: "hard",
      earliestMin: o.temporaryClosure.untilMin ?? undefined,
      blocks: o.temporaryClosure.untilMin === null ? [] : undefined,
      source: "Live report during this shift",
    });
  }

  const history: StopCard["windowHistory"] = {};
  for (const [k, v] of Object.entries(rec.windowHistory)) history[k] = { ...v };
  for (const oc of outcomes.filter((x) => x.locationKey === key)) {
    const k = `${oc.block}|${oc.weekend ? "weekend" : "weekday"}`;
    history[k] = history[k] ?? { attempts: 0, delivered: 0 };
    history[k].attempts += 1;
    if (oc.outcome === "delivered") history[k].delivered += 1;
  }

  const entranceDefault = rec.entranceNotes[0]?.text ?? "Not recorded — confirm at site";
  const alternate = rec.entranceNotes.length > 1 ? rec.entranceNotes[1].text : null;

  let entranceSource: string;
  if (rec.entranceCandidate)
    entranceSource = `Suggested drop-off point: centre of successful dataset pins, not an independently verified entrance. Pins for this site spread about ${rec.pinSpreadMeters ?? "?"} m, so a pin is not a verified entrance.`;
  else entranceSource = "No usable pin in the dataset";

  return {
    key,
    name: rec.name,
    type: rec.type,
    status,
    entrance: o.entrance ?? entranceDefault,
    entrancePoint: rec.entranceCandidate,
    entranceSource,
    alternateEntrance: alternate,
    handover: o.handover ?? rec.handoverNotes[0]?.text ?? "Not recorded — confirm at site",
    access: [...rec.accessNotes.map((n) => n.text), ...(o.extraAccess ?? [])],
    receivingWindows: Array.from(new Set([...rec.windowNotes.map((n) => n.text), ...(o.extraWindows ?? []).map((w) => w.text)])),
    restrictions,
    serviceMinutes: rec.serviceMinutesMedian,
    source: o.source ?? datasetSource,
    lastVerified: o.lastVerified ?? null,
    verifiedBy: o.verifiedBy ?? null,
    pinSpreadMeters: rec.pinSpreadMeters,
    pastIssues: rec.pastIssues,
    windowHistory: history,
    visits: rec.visits,
    temporaryClosure: o.temporaryClosure ?? null,
  };
}

/** Apply an approved correction to a card overlay. */
export function applyCorrection(overlay: CardOverlay | undefined, c: Correction, date: string, approver: string): CardOverlay {
  const o: CardOverlay = { ...(overlay ?? {}) };
  if (c.field === "entrance") o.entrance = c.text;
  if (c.field === "handover") o.handover = c.text;
  if (c.field === "access") o.extraAccess = [...(o.extraAccess ?? []), c.text];
  if (c.field === "receiving_window") {
    const preset = RESTRICTION_PRESETS.find((p) => p.code === c.restrictionCode);
    o.extraWindows = [...(o.extraWindows ?? []), { text: c.text, restriction: preset?.restriction }];
  }
  o.datasetRulesVerified = overlay?.status === "verified" && overlay?.datasetRulesVerified !== false;
  o.status = "verified";
  o.lastVerified = date;
  o.verifiedBy = approver;
  o.source = `Browser demo correction by ${c.proposedBy}, approved by ${approver}; not a real field inspection`;
  o.disputeReason = undefined;
  return o;
}

/** Only operational knowledge: history/outcomes do not make a review stale. */
export function knowledgeSnapshot(card: StopCard): string {
  return JSON.stringify([card.status, card.entrance, card.handover, card.access, card.receivingWindows, card.restrictions]);
}

export function reviewValue(card: StopCard, field: Correction["field"]): string {
  if (field === "entrance") return card.entrance;
  if (field === "handover") return card.handover;
  if (field === "access") return card.access.join("; ") || "Not recorded";
  if (field === "receiving_window") return card.receivingWindows.join("; ") || "Not recorded";
  return `${card.status} · ${card.entrance} · ${card.handover}`;
}

export function reviewLabel(field: Correction["field"]): string {
  return field === "confirmation" ? "On-site confirmation" : field === "dispute" ? "Dispute report" : `Correction: ${field.replaceAll("_", " ")}`;
}

export function conflictingReviews(request: Correction, requests: Correction[]): boolean {
  return request.field !== "confirmation" && request.field !== "dispute" && requests.some((other) =>
    other.id !== request.id && other.status === "pending" && other.locationKey === request.locationKey && other.field === request.field && other.text !== request.text);
}
