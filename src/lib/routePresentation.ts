import type { PlannedStop, Point } from "./types";
import { BLOCKS } from "./time";

/** Presentation only: never infer a position or bridge a missing leg. */
export function hasRoutePoint(stop: PlannedStop): boolean {
  return Number.isFinite(stop.arriveMin) && !!stop.point && stop.point.every(Number.isFinite);
}

export function routeLegs(stops: PlannedStop[], hub: Point) {
  return stops.flatMap((stop, index) => {
    if (!hasRoutePoint(stop)) return [];
    const previous = stops[index - 1];
    if (previous && !hasRoutePoint(previous)) return [];
    return [{ stop, from: previous?.point ?? hub, to: stop.point! }];
  });
}

export function scheduleExceptions(stops: PlannedStop[]) {
  return {
    unscheduled: stops.filter((s) => !Number.isFinite(s.arriveMin)),
    outsideWindow: stops.filter((s) => {
      const block = BLOCKS.find((b) => b.id === s.block)!;
      return Number.isFinite(s.arriveMin) && (s.arriveMin < block.start || s.arriveMin > block.end);
    }),
  };
}

/** Group only for display, keeping every order and its original ETA. */
export function timelineGroups(stops: PlannedStop[], start: number, end: number, width: number) {
  const groups: { stops: PlannedStop[]; percent: number }[] = [];
  for (const stop of [...stops].sort((a, b) => a.arriveMin - b.arriveMin)) {
    if (!Number.isFinite(stop.arriveMin) || stop.arriveMin < start || stop.arriveMin > end) continue;
    const percent = (stop.arriveMin - start) / (end - start) * 100;
    const previous = groups.at(-1);
    if (previous && (percent - previous.percent) / 100 * width < 44) {
      previous.stops.push(stop);
      previous.percent = previous.stops.reduce((sum, s) => sum + (s.arriveMin - start) / (end - start) * 100, 0) / previous.stops.length;
    } else groups.push({ stops: [stop], percent });
  }
  return groups;
}
