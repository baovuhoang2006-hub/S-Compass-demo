import { describe, expect, it } from "vitest";
import type { PlannedStop } from "../types";
import { hasRoutePoint, routeLegs, scheduleExceptions, timelineGroups } from "../routePresentation";

const stop = (stopId: string, arriveMin: number, extra: Partial<PlannedStop> = {}): PlannedStop => ({
  stopId, arriveMin, seq: 1, block: "morning", departMin: arriveMin + 5,
  travelMin: 1, serviceMin: 5, searchMin: 0, distanceM: 0, point: [10, 20],
  pointSource: "map pin", p: 0.8, pModel: null, reasons: [], flags: [], fixed: false, ...extra,
});

describe("route and schedule presentation safety", () => {
  it("draws only adjacent known legs and never bridges an unlocated order", () => {
    const stops = [stop("A", 480), stop("B", 490, { point: null }), stop("C", 500), stop("D", 510)];
    expect(routeLegs(stops, [0, 0]).map((l) => l.stop.stopId)).toEqual(["A", "D"]);
    expect(routeLegs(stops, [0, 0])[1].from).toBe(stops[2].point);
    expect(stops.map((s) => s.stopId)).toEqual(["A", "B", "C", "D"]);
  });
  it("does not plot invalid coordinates or missing and infinite ETAs", () => {
    for (const s of [stop("A", NaN), stop("B", Infinity), stop("C", 500, { point: [NaN, 20] })]) {
      expect(hasRoutePoint(s)).toBe(false);
      expect(routeLegs([s], [0, 0])).toEqual([]);
    }
  });
  it("separates out-of-window and unscheduled stops without clamping ETAs", () => {
    const stops = [stop("before", 479), stop("start", 480), stop("end", 690), stop("late", 691), stop("missing", NaN)];
    const exceptions = scheduleExceptions(stops);
    expect(exceptions.outsideWindow.map((s) => s.stopId)).toEqual(["before", "late"]);
    expect(exceptions.unscheduled.map((s) => s.stopId)).toEqual(["missing"]);
    const shown = timelineGroups(stops, 480, 690, 1000).flatMap((g) => g.stops);
    expect(shown.map((s) => s.stopId)).toEqual(["start", "end"]);
    expect(shown.length + exceptions.outsideWindow.length + exceptions.unscheduled.length).toBe(stops.length);
    expect(stops[3].arriveMin).toBe(691);
  });
  it("retains repeated visits and exact ETAs when markers are grouped on mobile", () => {
    const stops = [stop("first", 500, { seq: 1 }), stop("second", 502, { seq: 2 }), stop("later", 520, { seq: 3 })];
    const mobile = timelineGroups(stops, 480, 690, 300);
    const desktop = timelineGroups(stops, 480, 690, 1200);
    expect(mobile.length).toBeLessThan(desktop.length);
    expect(mobile.flatMap((g) => g.stops)).toEqual(stops);
    expect(stops.map((s) => s.arriveMin)).toEqual([500, 502, 520]);
    expect(routeLegs(stops, [0, 0])).toHaveLength(3);
  });
});
