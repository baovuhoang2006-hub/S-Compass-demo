import type { ImportBatch } from "./intake";
import type { DemoState } from "./demoState";

/** Replacing/removing an imported batch must not orphan plans or rider/buyer actions. */
export function importUseReason(state: DemoState, batch: ImportBatch): string | null {
  const shiftIds = new Set(batch.shifts.map((shift) => shift.id));
  const stopIds = new Set(batch.shifts.flatMap((shift) => shift.stops.map((stop) => stop.id)));
  const hasPlan = batch.shifts.some((shift) => state.currentPlan[shift.id] != null) ||
    Boolean(state.draftPlan && shiftIds.has(state.draftPlan.shiftId)) ||
    Boolean(state.comparison?.some((plan) => shiftIds.has(plan.shiftId))) ||
    Boolean(state.comparisonMeta && [...shiftIds].some((id) => state.comparisonMeta?.scenarioId.startsWith(`${id}:`)));
  const hasRiderOrBuyerAction = batch.shifts.some((shift) =>
    shift.stops.some((stop) => {
      const stopState = state.stopStates[shift.id]?.[stop.id];
      return stopState && (stopState.status !== "pending" || stopState.buyer.kind !== "none");
    }),
  );
  const hasReplan = state.proposals.some((proposal) => shiftIds.has(proposal.previous.shiftId));
  const hasTransfer = state.transfers.some((transfer) => shiftIds.has(transfer.shiftId));
  const hasStopMessage = state.messages.some((message) => stopIds.has(message.stopId));
  const hasStopCardCorrection = state.corrections.some((correction) => correction.locationKey.startsWith("imp-"));

  if (!hasPlan && !hasRiderOrBuyerAction && !hasReplan && !hasTransfer && !hasStopMessage && !hasStopCardCorrection) return null;
  return "This imported batch has a plan or recorded rider/buyer activity, so replacement/removal is blocked. Evidence export records events but is not a restorable plan backup. If you no longer need this session, use Reset demo to clear it before replacing or removing the batch. The active batch and plan are unchanged.";
}
