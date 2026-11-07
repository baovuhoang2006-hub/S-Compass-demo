import type { Plan } from "./types";

/** A partial route cannot produce a comparable per-parcel time for all pending parcels. */
export function onRoadMinutesPerParcel(plan: Plan): number | null {
  const { stops, scheduledStops, onRoadMin } = plan.totals;
  return stops > 0 && scheduledStops === stops ? onRoadMin / stops : null;
}
