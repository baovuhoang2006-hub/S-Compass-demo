export type Role = "dispatcher" | "rider" | "buyer";

export interface EvidenceEvent {
  id: string;
  at: string; // ISO time (real clock)
  sessionId: string;
  tester: string;
  persona: string;
  role: Role;
  type: string;
  summary: string;
  input?: string;
  output?: string;
  computeMs?: number;
}

export const EVENT_TYPES: Record<string, string> = {
  data_imported: "Data imported",
  data_import_removed: "Imported data removed",
  plan_generated: "Plan generated",
  plans_compared: "Plans compared",
  plan_dispatched: "Plan dispatched to rider",
  stop_card_opened: "Stop card opened",
  correction_suggested: "Correction suggested",
  correction_approved: "Correction approved",
  correction_rejected: "Correction rejected",
  card_verified: "Card verified",
  card_disputed: "Card disputed",
  dispute_reported: "Dispute report submitted",
  dispute_rejected: "Dispute report rejected",
  verification_rejected: "On-site confirmation rejected",
  verification_requested: "Verification requested",
  buyer_invited: "Buyer invited",
  buyer_confirmed: "Buyer confirmed window",
  buyer_changed: "Buyer changed window",
  buyer_pickup: "Buyer chose pickup",
  buyer_no_response: "Buyer did not respond",
  issue_reported: "Issue reported",
  demo_scenario_triggered: "Simulated event initiated by demo operator",
  replan_superseded: "Pending proposal superseded",
  replan_proposed: "Replan proposed",
  replan_accepted: "Replan accepted",
  replan_overridden: "Replan overridden",
  outcome_recorded: "Outcome recorded",
  parcel_transferred: "Parcel transferred",
  test_session_started: "Test session started",
  tester_note: "Tester note",
  demo_reset: "Demo reset",
  shift_selected: "Shift selected",
};

export function metrics(events: EvidenceEvent[]) {
  const count = (t: string) => events.filter((e) => e.type === t).length;
  const plans = events.filter((e) => e.type === "plan_generated" && e.computeMs !== undefined);
  const buyerAnswered = count("buyer_confirmed") + count("buyer_changed") + count("buyer_pickup");
  const buyerInvited = count("buyer_invited");
  const proposals = count("replan_proposed");
  return {
    total: events.length,
    plansGenerated: count("plan_generated"),
    avgPlanMs: plans.length ? plans.reduce((a, e) => a + (e.computeMs ?? 0), 0) / plans.length : null,
    comparisons: count("plans_compared"),
    dispatched: count("plan_dispatched"),
    cardsOpened: count("stop_card_opened"),
    correctionsSuggested: count("correction_suggested"),
    correctionsApproved: count("correction_approved"),
    verified: count("card_verified") + count("correction_approved"),
    buyerInvited,
    buyerAnswered,
    buyerNoResponse: count("buyer_no_response"),
    replansProposed: proposals,
    replansAccepted: count("replan_accepted"),
    replansOverridden: count("replan_overridden"),
    outcomes: count("outcome_recorded"),
    testers: Array.from(new Set(events.map((e) => e.tester).filter(Boolean))),
  };
}

function csvCell(v: unknown) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(events: EvidenceEvent[]): string {
  const cols: (keyof EvidenceEvent)[] = ["at", "sessionId", "tester", "persona", "role", "type", "summary", "input", "output", "computeMs"];
  return [cols.join(","), ...events.map((e) => cols.map((c) => csvCell(e[c])).join(","))].join("\n");
}
