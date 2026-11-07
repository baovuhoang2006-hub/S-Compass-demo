import { allPickupPoints, riderOfShift } from "./data";
import { predict } from "./model";
import { tableP } from "./successTable";
import { BLOCKS, SHIFT_END, SHIFT_START, blockInfo, blockLabel, blockOfTime, fmt } from "./time";
import type {
  ActiveRestriction,
  Block,
  FixtureStop,
  Plan,
  PlanMethod,
  PlannedStop,
  Point,
  Shift,
  StopCard,
  StopState,
} from "./types";

/** Simulation assumptions. None of these are in the dataset; they are shown in the UI. */
export const ASSUMPTIONS = {
  speedKmh: 18,
  detourFactor: 1.3,
  defaultServiceMin: 15,
  noLocationTravelMin: 12,
  searchMin: { verified: 0, suggested: 2, pin: 4, none: 8 },
  alternateEntranceExtraMin: 5,
};

export const ASSUMPTION_LABELS: { key: string; text: string }[] = [
  { key: "blocks", text: "Delivery blocks: morning 08:00–11:30, afternoon 11:30–17:00, evening 17:00–20:30." },
  { key: "speed", text: `Travel: straight-line distance × ${ASSUMPTIONS.detourFactor} at ${ASSUMPTIONS.speedKmh} km/h.` },
  { key: "service", text: `Service time: the order's processing-time field; if empty, the site median; otherwise ${ASSUMPTIONS.defaultServiceMin} min.` },
  {
    key: "search",
    text: `Entrance search time: ${ASSUMPTIONS.searchMin.verified} min (verified entrance), ${ASSUMPTIONS.searchMin.suggested} min (suggested), ${ASSUMPTIONS.searchMin.pin} min (map pin only), ${ASSUMPTIONS.searchMin.none} min (no location). Not measured in the dataset — to be measured in the pilot.`,
  },
  { key: "nolocation", text: `A stop with no location is costed at ${ASSUMPTIONS.noLocationTravelMin} min travel.` },
  { key: "estimate", text: "Expected successful first attempts = sum of history-table probabilities. Buyer confirmation and pickup effects are NOT estimated because the dataset has no such data." },
];

export interface PlanContext {
  shift: Shift;
  method: PlanMethod;
  cards: Record<string, StopCard>;
  stopStates: Record<string, StopState>;
  /** Plan from this time and position (live replanning). Completed stops are kept fixed. */
  startMin?: number;
  startPoint?: Point;
  previous?: Plan | null;
  sessionOutcomes?: { locationKey: string; block: Block; weekend: boolean; outcome: "delivered" | "failed" }[];
}


function dist(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function travelMin(a: Point | null, b: Point | null): { min: number; m: number } {
  if (!a || !b) return { min: ASSUMPTIONS.noLocationTravelMin, m: 0 };
  const m = dist(a, b) * ASSUMPTIONS.detourFactor;
  return { min: m / 1000 / ASSUMPTIONS.speedKmh * 60, m };
}

interface Candidate {
  stop: FixtureStop;
  card: StopCard;
  point: Point | null;
  pointSource: PlannedStop["pointSource"];
  searchMin: number;
  serviceMin: number;
  allowed: Block[];
  preferred: Block[];
  earliestMin?: number;
  latestMin?: number;
  reasons: string[];
  flags: string[];
  pByBlock: Record<Block, number | null>;
  pModelByBlock: Record<Block, number | null>;
  chosen?: Block;
  confirmed?: Block;
}

function dayType(shift: Shift) {
  return shift.isWeekend ? "weekend" : "weekday";
}

function serviceFor(stop: FixtureStop, card: StopCard) {
  return stop.serviceMinutes ?? card.serviceMinutes ?? ASSUMPTIONS.defaultServiceMin;
}

function restrictionBlocks(r: ActiveRestriction, weekend: boolean): Block[] {
  if (r.weekdaysOnly) return weekend ? [] : ["morning", "afternoon", "evening"];
  if (r.blocks) return r.blocks;
  if (r.earliestMin !== undefined) return BLOCKS.filter((b) => b.end > r.earliestMin!).map((b) => b.id);
  return ["morning", "afternoon", "evening"];
}

function locationHistory(card: StopCard) {
  let attempts = 0;
  let delivered = 0;
  for (const v of Object.values(card.windowHistory)) {
    attempts += v.attempts;
    delivered += v.delivered;
  }
  return { attempts, delivered };
}

function blockHistory(card: StopCard, block: Block) {
  const a = card.windowHistory[`${block}|weekday`] ?? { attempts: 0, delivered: 0 };
  const b = card.windowHistory[`${block}|weekend`] ?? { attempts: 0, delivered: 0 };
  return { attempts: a.attempts + b.attempts, delivered: a.delivered + b.delivered };
}

function buildCandidate(stop: FixtureStop, ctx: PlanContext): Candidate {
  const card = ctx.cards[stop.locationKey];
  const state = ctx.stopStates[stop.id];
  const weekend = ctx.shift.isWeekend;
  const method = ctx.method;
  const reasons: string[] = [];
  const flags: string[] = [];

  // ----- where the rider goes
  let point: Point | null;
  let pointSource: PlannedStop["pointSource"];
  let searchMin: number;
  const pickup = state.buyer.kind === "pickup" ? allPickupPoints.find((p) => p.id === (state.buyer as { pickupId: string }).pickupId) : undefined;
  if (pickup) {
    point = pickup.pos;
    pointSource = "pickup point";
    searchMin = 0;
    reasons.push(`Buyer chose ${pickup.name}.`);
  } else if (method === "baseline") {
    point = stop.pin;
    pointSource = stop.pin ? "map pin" : "no location";
    searchMin = stop.pin ? ASSUMPTIONS.searchMin.pin : ASSUMPTIONS.searchMin.none;
  } else if (card.entrancePoint && card.status === "verified") {
    point = card.entrancePoint;
    pointSource = "verified entrance";
    searchMin = ASSUMPTIONS.searchMin.verified;
  } else if (card.entrancePoint) {
    point = card.entrancePoint;
    pointSource = "suggested entrance";
    searchMin = ASSUMPTIONS.searchMin.suggested;
  } else if (stop.pin) {
    point = stop.pin;
    pointSource = "map pin";
    searchMin = ASSUMPTIONS.searchMin.pin;
  } else {
    point = null;
    pointSource = "no location";
    searchMin = ASSUMPTIONS.searchMin.none;
  }
  if (!pickup && method !== "baseline" && card.temporaryClosure?.useAlternate) {
    searchMin += ASSUMPTIONS.alternateEntranceExtraMin;
    reasons.push(`Main entrance unavailable: use ${card.alternateEntrance ?? "the alternate entrance"} (+${ASSUMPTIONS.alternateEntranceExtraMin} min assumed).`);
  }
  if (!stop.pin && method === "baseline") flags.push("No map pin: rider must call the buyer");
  if (!stop.pin && method !== "baseline" && pointSource !== "no location" && !pickup)
    reasons.push("Order has no map pin; using the stop card's drop-off point.");

  // ----- which blocks are allowed
  let allowed: Block[] = ["morning", "afternoon", "evening"];
  let preferred: Block[] = [...allowed];
  let earliestMin: number | undefined;
  let latestMin: number | undefined;
  let confirmed: Block | undefined;
  if (method !== "baseline") {
    if (!pickup) {
      for (const r of card.restrictions) {
        const ok = restrictionBlocks(r, weekend);
        if (r.strength === "hard") {
          allowed = allowed.filter((b) => ok.includes(b));
          if (r.latestMin !== undefined) latestMin = r.latestMin;
          if (r.earliestMin !== undefined) earliestMin = Math.max(earliestMin ?? 0, r.earliestMin);
          reasons.push(`${r.text} (${r.source.toLowerCase()}).`);
        } else {
          preferred = preferred.filter((b) => ok.includes(b));
        }
      }
    }
    if (state.buyer.kind === "confirmed" || state.buyer.kind === "changed") {
      confirmed = state.buyer.block;
      if (allowed.includes(confirmed) || allowed.length === 0) {
        allowed = [confirmed];
        reasons.push(`Buyer confirmed ${blockLabel(confirmed)}.`);
      } else {
        flags.push(`Buyer asked for ${blockLabel(confirmed)}, but the site card does not allow it — dispatcher must call the buyer`);
      }
    }
    preferred = preferred.filter((b) => allowed.includes(b));
    if (preferred.length === 0) preferred = [...allowed];
  }

  // ----- success estimates per block (history table + model)
  const pByBlock = {} as Record<Block, number | null>;
  const pModelByBlock = {} as Record<Block, number | null>;
  for (const b of BLOCKS.map((x) => x.id)) {
    pByBlock[b] = pickup ? null : tableP(stop.locationType, b, dayType(ctx.shift), stop.payment).p;
    pModelByBlock[b] = pickup
      ? null
      : predict({
          locType: stop.locationType,
          block: b,
          weekend,
          payment: stop.payment,
          parcel: stop.parcel,
          hasPin: stop.pin !== null,
          serviceMin: stop.serviceMinutes,
          isReattempt: stop.isReattempt,
          locHistory: locationHistory(card),
          locBlockHistory: blockHistory(card, b),
        });
  }

  return {
    stop,
    card,
    point,
    pointSource,
    searchMin,
    serviceMin: serviceFor(stop, card),
    allowed,
    preferred,
    earliestMin,
    latestMin,
    reasons,
    flags,
    pByBlock,
    pModelByBlock,
    confirmed,
  };
}

function scoreFor(c: Candidate, b: Block, method: PlanMethod): number {
  const p = method === "model" ? c.pModelByBlock[b] : c.pByBlock[b];
  return p ?? 0.5; // pickup points: no estimate; neutral score keeps geography-based choice
}

function chooseBlock(c: Candidate, method: PlanMethod): Block | undefined {
  const pool = c.preferred.length ? c.preferred : c.allowed;
  if (pool.length === 0) return undefined;
  let best = pool[0];
  for (const b of pool) if (scoreFor(c, b, method) > scoreFor(c, best, method) + 1e-9) best = b;
  return best;
}

/** Sequence the candidates of one block from a start point/time. Returns planned stops and the end state. */
function sequenceBlock(cands: Candidate[], block: Block, startPoint: Point, startMin: number, method: PlanMethod) {
  const info = blockInfo(block);
  let pos: Point = startPoint;
  let t = Math.max(startMin, info.start);
  const left = [...cands];
  const out: { c: Candidate; arrive: number; depart: number; travel: number; m: number }[] = [];
  while (left.length) {
    // 1) urgent deadline first; 2) nearest stop that is ready; 3) otherwise the earliest-ready stop
    let pickIdx = -1;
    const urgent = left
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.latestMin !== undefined)
      .sort((a, b) => a.c.latestMin! - b.c.latestMin!);
    if (urgent.length) {
      const u = urgent[0];
      const tt = travelMin(pos, u.c.point).min;
      if (t + tt + 30 >= u.c.latestMin! || left.length === urgent.length) pickIdx = u.i;
    }
    if (pickIdx < 0) {
      let best = Infinity;
      left.forEach((c, i) => {
        if (c.earliestMin !== undefined && c.earliestMin > t) return;
        const d = c.point ? dist(pos, c.point) : Infinity; // no-location stops go last
        if (d < best) {
          best = d;
          pickIdx = i;
        }
      });
    }
    if (pickIdx < 0) {
      // everyone left is waiting for an earliest time
      let e = Infinity;
      left.forEach((c, i) => {
        if ((c.earliestMin ?? 0) < e) {
          e = c.earliestMin ?? 0;
          pickIdx = i;
        }
      });
    }
    const c = left.splice(pickIdx, 1)[0];
    const tr = travelMin(pos, c.point);
    let arrive = t + tr.min;
    if (c.earliestMin !== undefined && arrive < c.earliestMin) arrive = c.earliestMin;
    const depart = arrive + c.searchMin + c.serviceMin;
    out.push({ c, arrive, depart, travel: tr.min, m: tr.m });
    if (c.point) pos = c.point;
    t = depart;
  }
  void method;
  return { out, endPoint: pos, endMin: t };
}

function blockLoad(cands: Candidate[], block: Block, startPoint: Point, startMin: number, method: PlanMethod) {
  const s = sequenceBlock(cands, block, startPoint, startMin, method);
  return { ...s, overflow: s.endMin - blockInfo(block).end };
}

export function makePlan(ctx: PlanContext): Plan {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const method = ctx.method;
  const startMin = ctx.startMin ?? SHIFT_START;
  const startPoint = ctx.startPoint ?? riderOfShift(ctx.shift).hub.pos;
  const warnings: string[] = [];

  // Completed stops are fixed: copy them from the previous plan in their original order.
  const fixed: PlannedStop[] = [];
  if (ctx.previous) {
    for (const ps of ctx.previous.stops) {
      const st = ctx.stopStates[ps.stopId];
      if (st && st.status !== "pending" && st.status !== "transferred") fixed.push({ ...ps, fixed: true });
    }
  }
  const pendingStops = ctx.shift.stops.filter((s) => ctx.stopStates[s.id]?.status === "pending");
  const cands = pendingStops.map((s) => buildCandidate(s, ctx));
  const planned: PlannedStop[] = [];

  if (method === "baseline") {
    // Current-app proxy: one nearest-neighbour route over raw map pins, no time-window logic.
    const withPin = cands.filter((c) => c.point);
    const noPin = cands.filter((c) => !c.point);
    let pos = startPoint;
    let t = startMin;
    const order: Candidate[] = [];
    const left = [...withPin];
    while (left.length) {
      let bi = 0;
      left.forEach((c, i) => {
        if (dist(pos, c.point!) < dist(pos, left[bi].point!)) bi = i;
      });
      const c = left.splice(bi, 1)[0];
      order.push(c);
      pos = c.point!;
    }
    order.push(...noPin);
    pos = startPoint;
    for (const c of order) {
      const tr = travelMin(pos, c.point);
      const arrive = t + tr.min;
      const depart = arrive + c.searchMin + c.serviceMin;
      const block = blockOfTime(arrive);
      const flags = [...c.flags];
      if (arrive > SHIFT_END) flags.push(`Arrives after ${fmt(SHIFT_END)} (end of shift)`);
      planned.push({
        stopId: c.stop.id,
        seq: 0,
        block,
        arriveMin: arrive,
        departMin: depart,
        travelMin: tr.min,
        serviceMin: c.serviceMin,
        searchMin: c.searchMin,
        distanceM: tr.m,
        point: c.point,
        pointSource: c.pointSource,
        p: c.pByBlock[block],
        pModel: null,
        reasons: ["Nearest next map pin (distance only). The current app does not use receiving windows or site notes."],
        flags,
        fixed: false,
      });
      if (c.point) pos = c.point;
      t = depart;
    }
  } else {
    // Rules / model: choose a block per stop, check time capacity, then sequence each block.
    const infeasible = cands.filter((c) => c.allowed.length === 0);
    for (const c of infeasible) {
      c.flags.push(
        ctx.shift.isWeekend && c.card.restrictions.some((r) => r.weekdaysOnly && r.strength === "hard")
          ? "Site closed at weekends (verified). Offer the buyer a weekday slot or a pickup point."
          : "No allowed delivery block today. Dispatcher decision needed (call buyer, pickup point or next day).",
      );
    }
    const active = cands.filter((c) => c.allowed.length > 0);
    for (const c of active) c.chosen = chooseBlock(c, method);

    // Capacity check: if a block overruns, move the stop whose move costs the least expected success.
    const ids = BLOCKS.map((b) => b.id);
    for (let guard = 0; guard < 60; guard++) {
      let pos = startPoint;
      let t = startMin;
      let movedOne = false;
      for (const b of ids) {
        if (blockInfo(b).end <= startMin) continue;
        const inBlock = active.filter((c) => c.chosen === b);
        const load = blockLoad(inBlock, b, pos, t, method);
        if (load.overflow > 0) {
          let bestMove: { c: Candidate; to: Block; loss: number } | null = null;
          for (const c of inBlock) {
            if (c.confirmed) continue; // never move a buyer-confirmed stop silently
            for (const to of c.allowed) {
              if (to === b || blockInfo(to).end <= startMin) continue;
              if (ids.indexOf(to) < ids.indexOf(b)) continue; // only push later
              const loss = scoreFor(c, b, method) - scoreFor(c, to, method);
              if (!bestMove || loss < bestMove.loss) bestMove = { c, to, loss };
            }
          }
          if (bestMove) {
            bestMove.c.reasons.push(
              `Moved from ${blockInfo(b).label.toLowerCase()} to ${blockInfo(bestMove.to).label.toLowerCase()}: the ${blockInfo(b).label.toLowerCase()} block was over its time capacity.`,
            );
            bestMove.c.chosen = bestMove.to;
            movedOne = true;
            break;
          }
        }
        pos = load.endPoint;
        t = load.endMin;
      }
      if (!movedOne) break;
    }

    // Sequence blocks in time order.
    let pos = startPoint;
    let t = startMin;
    for (const b of ids) {
      const inBlock = active.filter((c) => c.chosen === b);
      if (!inBlock.length) continue;
      const s = sequenceBlock(inBlock, b, pos, t, method);
      for (const r of s.out) {
        const c = r.c;
        const flags = [...c.flags];
        const reasons = [...c.reasons];
        const pChosen = c.pByBlock[b];
        const alt = c.allowed.filter((x) => x !== b).map((x) => c.pByBlock[x] ?? 0);
        if (method === "rules" && pChosen !== null && !c.confirmed) {
          reasons.unshift(
            `History table: ${c.card.type.replace("_", " ")} sites, ${ctx.shift.isWeekend ? "weekend" : "weekday"}, ${c.stop.payment.toUpperCase()} succeed ${(pChosen * 100).toFixed(0)}% in the ${blockInfo(b).label.toLowerCase()}${alt.length ? ` (other allowed blocks: ${alt.map((x) => `${(x * 100).toFixed(0)}%`).join(", ")})` : ""}.`,
          );
        }
        if (method === "model" && c.pModelByBlock[b] !== null && !c.confirmed) {
          reasons.unshift(`Model estimate ${(c.pModelByBlock[b]! * 100).toFixed(0)}% in the ${blockInfo(b).label.toLowerCase()} (experimental model).`);
        }
        if (r.depart > blockInfo(b).end + 1) flags.push(`Finishes after the ${blockInfo(b).label.toLowerCase()} block ends (${fmt(blockInfo(b).end)}) — capacity warning`);
        if (c.latestMin !== undefined && r.arrive > c.latestMin) flags.push(`Arrives after the site's latest time ${fmt(c.latestMin)}`);
        planned.push({
          stopId: c.stop.id,
          seq: 0,
          block: b,
          arriveMin: r.arrive,
          departMin: r.depart,
          travelMin: r.travel,
          serviceMin: c.serviceMin,
          searchMin: c.searchMin,
          distanceM: r.m,
          point: c.point,
          pointSource: c.pointSource,
          p: pChosen,
          pModel: method === "model" ? c.pModelByBlock[b] : null,
          reasons,
          flags,
          fixed: false,
        });
      }
      pos = s.endPoint;
      t = s.endMin;
    }
    for (const c of infeasible) {
      planned.push({
        stopId: c.stop.id,
        seq: 0,
        block: "evening",
        arriveMin: NaN,
        departMin: NaN,
        travelMin: 0,
        serviceMin: c.serviceMin,
        searchMin: c.searchMin,
        distanceM: 0,
        point: c.point,
        pointSource: c.pointSource,
        p: null,
        pModel: null,
        reasons: c.reasons,
        flags: c.flags,
        fixed: false,
      });
      warnings.push(`${c.stop.id}: kept in the queue but not scheduled — ${c.flags[c.flags.length - 1]}`);
    }
  }

  const stops = [...fixed, ...planned].map((s, i) => ({ ...s, seq: i + 1 }));
  const live = stops.filter((s) => !s.fixed);
  const sched = live.filter((s) => !Number.isNaN(s.arriveMin));
  const confirmedTotal = ctx.shift.stops.filter((s) => {
    const b = ctx.stopStates[s.id]?.buyer;
    return ctx.stopStates[s.id]?.status === "pending" && (b?.kind === "confirmed" || b?.kind === "changed");
  }).length;
  const confirmedKept = live.filter((s) => {
    const b = ctx.stopStates[s.stopId]?.buyer;
    return (b?.kind === "confirmed" || b?.kind === "changed") && b.block === s.block && !Number.isNaN(s.arriveMin);
  }).length;
  const estimated = live.filter((s) => s.p !== null);
  const modelEstimated = live.filter((s) => s.pModel !== null);
  const totals = {
    stops: live.length,
    expectedSuccess: estimated.reduce((a, s) => a + (s.p ?? 0), 0),
    estimatedStops: estimated.length,
    modelExpectedSuccess: method === "model" ? modelEstimated.reduce((a, s) => a + (s.pModel ?? 0), 0) : null,
    modelEstimatedStops: method === "model" ? modelEstimated.length : 0,
    distanceKm: sched.reduce((a, s) => a + s.distanceM, 0) / 1000,
    onRoadMin: sched.reduce((a, s) => a + s.travelMin + s.searchMin + s.serviceMin, 0),
    scheduledStops: sched.length,
    endMin: sched.length ? Math.max(...sched.map((s) => s.departMin)) : startMin,
    evening: sched.filter((s) => s.block === "evening").length,
    lowChance: sched.filter((s) => s.p !== null && s.p < 0.65).length,
    flagged: live.filter((s) => s.flags.length > 0).length,
    confirmedKept,
    confirmedTotal,
  };
  if (totals.endMin > SHIFT_END) warnings.push(`Plan ends at ${fmt(totals.endMin)}, after the ${fmt(SHIFT_END)} shift end. Dispatcher review needed; no stop was dropped.`);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    id: `plan-${Math.random().toString(36).slice(2, 8)}`,
    method,
    createdAt: new Date().toISOString(),
    shiftId: ctx.shift.id,
    startMin,
    stops,
    totals,
    warnings,
    computeMs: Math.round((t1 - t0) * 10) / 10,
  };
}

export const METHOD_LABEL: Record<PlanMethod, string> = {
  baseline: "Baseline (current app: nearest pin)",
  rules: "Rules-based planner",
  model: "Model-assisted planner (experimental)",
};

export const METHOD_SHORT: Record<PlanMethod, string> = {
  baseline: "Baseline",
  rules: "Rules",
  model: "Model (exp.)",
};
