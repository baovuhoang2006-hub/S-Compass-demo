"use client";

import * as React from "react";
import { blockColor } from "@/components/bits";
import { fixtures, knowledgeForRider, riderById } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { hasRoutePoint, routeLegs } from "@/lib/routePresentation";
import { BLOCKS, blockInfo, fmt } from "@/lib/time";
import { cn } from "@/lib/utils";
import { METHOD_LABEL } from "@/lib/planner";
import type { Block, Plan, Point, StopState } from "@/lib/types";

/** Bounding box of every position in one rider's zone (so the map does not jump between plans). */
const PAD = 120;
function zoneBounds(riderId: string) {
  const rider = riderById(riderId);
  const all: Point[] = [
    rider.hub.pos,
    ...rider.pickupPoints.map((p) => p.pos),
    ...knowledgeForRider(riderId).flatMap((k) => (k.entranceCandidate ? [k.entranceCandidate] : [])),
    ...fixtures.shifts.filter((s) => s.riderId === riderId).flatMap((s) => s.stops.flatMap((x) => (x.pin ? [x.pin] : []))),
  ];
  const b = {
    minX: Math.min(...all.map((p) => p[0])) - PAD,
    maxX: Math.max(...all.map((p) => p[0])) + PAD,
    minY: Math.min(...all.map((p) => p[1])) - PAD,
    maxY: Math.max(...all.map((p) => p[1])) + PAD,
  };
  // keep a readable aspect ratio (height/width between 0.5 and 0.85) by widening the short side
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  if (dy / dx > 0.85) {
    const extra = (dy / 0.85 - dx) / 2;
    b.minX -= extra;
    b.maxX += extra;
  } else if (dy / dx < 0.5) {
    const extra = (dx * 0.5 - dy) / 2;
    b.minY -= extra;
    b.maxY += extra;
  }
  return b;
}

const desktopQuery = "(min-width: 1024px)";
function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const serverDesktopSnapshot = () => false;

export function RouteMap({ riderId, plan, states, selected, onSelect, height = 480, locations = {} }: {
  riderId: string; plan: Plan | null; states: Record<string, StopState>;
  selected?: string | null; onSelect?: (stopId: string) => void; height?: number;
  locations?: Record<string, string>;
}) {
  const [filter, setFilter] = React.useState<Block | "all">("all");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const desktop = React.useSyncExternalStore(subscribeToDesktop, desktopSnapshot, serverDesktopSnapshot);
  const [whyStopId, setWhyStopId] = React.useState<string | null>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const clusterList = React.useRef<HTMLDivElement>(null);
  const id = React.useId().replace(/:/g, "");
  const { minX, maxX, minY, maxY } = zoneBounds(riderId);
  const rider = riderById(riderId);
  const W = 1000;
  const H = Math.round(W * (maxY - minY) / (maxX - minX));
  const tx = (p: Point) => [70 + ((p[0] - minX) / (maxX - minX)) * (W - 140), H - 70 - ((p[1] - minY) / (maxY - minY)) * (H - 140)] as const;
  const stops = plan?.stops ?? [];
  const filtered = stops.filter((s) => filter === "all" || s.block === filter);
  const current = filtered.find((s) => s.stopId === selected) ?? filtered[0];
  const index = current ? filtered.indexOf(current) : -1;
  const located = stops.filter(hasRoutePoint);
  const missing = stops.filter((s) => !hasRoutePoint(s));
  const lastScheduled = stops.filter((s) => Number.isFinite(s.arriveMin)).at(-1);
  const finish = lastScheduled && hasRoutePoint(lastScheduled) ? tx(lastScheduled.point!) : null;
  const hub = tx(rider.hub.pos);
  const legs = routeLegs(stops, rider.hub.pos);
  const activeLeg = legs.find((leg) => leg.stop.stopId === current?.stopId);
  const previousStop = current ? stops[stops.indexOf(current) - 1] : undefined;

  // Screen-space clustering is display-only; use an existing point as the anchor.
  const groups: { stops: typeof located; x: number; y: number }[] = [];
  for (const stop of located) {
    const [x, y] = tx(stop.point!);
    const group = groups.find((g) => Math.hypot(g.x - x, g.y - y) < 78);
    if (group) group.stops.push(stop);
    else groups.push({ stops: [stop], x, y });
  }
  const selectedVisitsShareCluster = !!previousStop && groups.some((g) => g.stops.some((s) => s.stopId === previousStop.stopId) && g.stops.some((s) => s.stopId === current?.stopId));
  const opened = groups.find((g) => g.stops[0].stopId === expanded);
  React.useEffect(() => {
    const chosen = stops.find((s) => s.stopId === selected);
    if (chosen && filter !== "all" && chosen.block !== filter) setFilter("all");
    for (const container of [list.current, clusterList.current]) {
      const button = container?.querySelector<HTMLElement>(`[data-route-stop="${CSS.escape(selected ?? "")}"], [data-cluster-stop="${CSS.escape(selected ?? "")}"]`);
      if (button && container) container.scrollTop += button.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
    }
  }, [selected, filter, plan?.id, desktop, expanded]);
  const eta = (s: typeof stops[number]) => Number.isFinite(s.arriveMin) ? fmt(s.arriveMin) : "Unscheduled";
  const firstScheduled = stops.find((stop) => Number.isFinite(stop.arriveMin));
  const diagram = (
      <figure aria-label="Route diagram" className="m-0 min-w-0 space-y-3">
        <p className="text-xs text-ink-faint sm:hidden">Swipe the diagram horizontally. Use the stop sequence below for full details.</p>
        <div className="overflow-x-auto rounded-xl">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Schematic route map" className="w-full min-w-[640px] rounded-xl border border-line bg-canvas/50 sm:min-w-0" style={{ maxHeight: height }}>
          <defs><pattern id={`grid-${id}`} width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e1e5ec" /></pattern><marker id={`arrow-${id}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="context-stroke" /></marker></defs>
          <rect width={W} height={H} fill={`url(#grid-${id})`} />
          {legs.map((leg) => {
            const a = tx(leg.from), b = tx(leg.to);
            const active = leg.stop.stopId === current?.stopId;
            const inBlock = filter === "all" || leg.stop.block === filter;
            return <line key={leg.stop.stopId} data-route-leg={leg.stop.stopId} data-emphasized={active} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={active ? "#c2381d" : "#6b7590"} strokeWidth={active ? 6 : 2} strokeOpacity={active ? 1 : filter !== "all" && inBlock ? 0.3 : 0.08} markerEnd={active ? `url(#arrow-${id})` : undefined} className="ui-select" />;
          })}
          {rider.pickupPoints.map((p) => { const [x, y] = tx(p.pos); return <g key={p.id}><rect x={x - 9} y={y - 9} width={18} height={18} rx={4} fill="#fff" stroke="#1e8e5a" strokeWidth={2} /><title>Pickup point · {p.id}</title></g>; })}
          <g><line x1={182} y1={45} x2={hub[0]} y2={hub[1]} stroke="#14213d" strokeOpacity={0.35} strokeDasharray="5 7" /><rect x={hub[0] - 10} y={hub[1] - 10} width={20} height={20} rx={3} fill="#14213d" stroke="#fff" strokeWidth={2} /><rect x={20} y={15} width={162} height={40} rx={8} fill="#14213d" /><text x={101} y={42} textAnchor="middle" fontSize={22} fontWeight={700} fill="#fff">START · HUB</text></g>
          {groups.map((g) => {
            const active = g.stops.some((s) => s.stopId === current?.stopId);
            const matching = g.stops.filter((s) => filter === "all" || s.block === filter);
            const lead = g.stops.find((s) => s.stopId === current?.stopId) ?? matching[0] ?? g.stops[0];
            const done = g.stops.every((s) => ["delivered", "failed"].includes(states[s.stopId]?.status));
            const choose = () => { setExpanded(g.stops.length > 1 ? g.stops[0].stopId : null); onSelect?.(lead.stopId); };
            return <g key={g.stops[0].stopId} role="button" tabIndex={onSelect ? 0 : undefined} aria-pressed={active} aria-label={g.stops.length > 1 ? `Open cluster of ${g.stops.length} orders, including separate visits` : `Select route stop ${lead.seq}, ${lead.stopId}`} onClick={choose} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } }} className="ui-select cursor-pointer" opacity={matching.length ? 1 : 0.3}>
              <title>{g.stops.map((s) => `#${s.seq} · ${s.stopId} · ${eta(s)}`).join("\n")}</title>
              <circle cx={g.x} cy={g.y} r={g.stops.length > 1 ? 40 : 26} fill={done ? "#6b7590" : blockColor(lead.block)} stroke={active ? "#c2381d" : "#fff"} strokeWidth={active ? 5 : 3} />
              <text x={g.x} y={g.y + 6} textAnchor="middle" fontSize={g.stops.length > 1 ? 18 : 21} fontWeight={700} fill="#fff">{g.stops.length > 1 ? `${g.stops.length} orders` : `#${lead.seq}`}</text>
            </g>;
          })}
          {finish && lastScheduled ? <g><line x1={W - 220} y1={45} x2={finish[0]} y2={finish[1]} stroke="#14213d" strokeOpacity={0.35} strokeDasharray="5 7" /><circle cx={finish[0]} cy={finish[1]} r={10} fill="none" stroke="#14213d" strokeWidth={2} /><rect x={W - 220} y={15} width={200} height={40} rx={8} fill="#fff" stroke="#14213d" strokeWidth={2} /><text x={W - 120} y={42} textAnchor="middle" fontSize={22} fontWeight={700} fill="#14213d">FINISH · #{lastScheduled.seq}</text></g> : null}
        </svg>
        </div>
        <figcaption className="sr-only">Planner route diagram. The selected leg and stop sequence provide visit identifiers and simulated times.</figcaption>
      </figure>
  );
  const selectedDetails = (
    current ? <section className="rounded-lg border border-line bg-canvas/60 p-4 text-sm" aria-label="Selected leg details" aria-live="polite">
          <h3 className="font-semibold">Selected leg · From → To</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><h4 className="text-xs font-medium text-ink-soft">From</h4><p className="mt-1 font-semibold">{previousStop ? `#${previousStop.seq} · ${previousStop.stopId}` : "START · HUB"}</p><p className="text-xs text-ink-soft">{previousStop ? `${eta(previousStop)} · ${blockInfo(previousStop.block).label}` : current.fixed || plan && current.arriveMin < plan.startMin ? "Earlier completed visit; original departure is not shown" : plan && Number.isFinite(plan.startMin) ? `Plan start ${fmt(plan.startMin)}` : "No start time available"}</p></div>
            <div><h4 className="text-xs font-medium text-ink-soft">To</h4><p className="mt-1 font-semibold">#{current.seq} · {current.stopId}</p><p className="text-xs text-ink-soft">{eta(current)} · {blockInfo(current.block).label}</p><p className="mt-1 text-xs text-ink-soft">{locations[current.stopId] ?? current.pointSource}</p></div>
          </div>
          {activeLeg ? activeLeg.from[0] === activeLeg.to[0] && activeLeg.from[1] === activeLeg.to[1] ? <p className="mt-3 text-xs text-ink-soft">Same coordinate: these are separate visits with no visible travel line between them.</p> : null : <p className="mt-3 text-xs text-warn">No leg drawn: this stop or its preceding stop has no valid location or schedule. Check the sequence list.</p>}
          {activeLeg && selectedVisitsShareCluster && (activeLeg.from[0] !== activeLeg.to[0] || activeLeg.from[1] !== activeLeg.to[1]) ? <p className="mt-3 text-xs text-ink-soft">Both visits are in the same display cluster. Their short connecting leg may be hidden at this scale; From → To shows their actual sequence and times.</p> : null}
          {previousStop && previousStop.block !== current.block ? <p className="mt-3 rounded-md bg-info-tint p-2 text-xs text-info">Time-block transition: {blockInfo(previousStop.block).label} → {blockInfo(current.block).label}. This remains one delivery route.</p> : null}
          <details key={current.stopId} open={whyStopId === current.stopId} onToggle={(event) => { const open = event.currentTarget.open; setWhyStopId((previous) => open ? current.stopId : previous === current.stopId ? null : previous); }} className="ui-disclosure mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer font-medium text-info">Why this stop/time?</summary>
            <div className="space-y-3 pt-3">
              <p className="text-xs text-ink-soft">Planner reasoning · {plan ? METHOD_LABEL[plan.method] : "No plan"}. Location instructions are available in the Stop Card from Deliveries.</p>
              <dl className="grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-ink-soft">History-table estimate · {blockInfo(current.block).label}</dt><dd className="font-semibold">{current.p === null ? "No estimate available" : `${(current.p * 100).toFixed(1)}%`}</dd></div>{current.pModel !== null ? <div><dt className="text-ink-soft">Logistic Regression prediction · Experimental</dt><dd className="font-semibold">{(current.pModel * 100).toFixed(1)}%</dd></div> : null}</dl>
              {current.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-ink-soft">{current.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="text-ink-soft">No additional reasoning was recorded by this Planner run.</p>}
              {current.flags.length ? <ul className="list-disc space-y-1 pl-5 text-bad">{current.flags.map((flag) => <li key={flag}>{flag}</li>)}</ul> : null}
              <p className="text-xs text-ink-faint">Simulated: travel {Math.round(current.travelMin)} min, entrance search {current.searchMin} min, service {current.serviceMin} min.</p>
            </div>
          </details>
        </section> : <p className="text-sm text-ink-faint">No stops in this selection.</p>
  );
  const groupedVisits = (
    opened ? <div className="ui-reveal rounded-lg border border-brand/30 bg-brand-tint/30 p-3" aria-label="Cluster visits"><div className="mb-2 flex items-center justify-between gap-2 text-sm"><b>{opened.stops.length} orders · all visits</b><button type="button" className="text-info underline" onClick={() => setExpanded(null)}>Close list</button></div><div ref={clusterList} role="region" aria-label="Cluster visit list" tabIndex={0} className="grid max-h-72 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2">{[...opened.stops].sort((a, b) => a.seq - b.seq).map((s) => <button type="button" key={s.stopId} data-cluster-stop={s.stopId} aria-pressed={s.stopId === selected} onClick={() => { setFilter("all"); onSelect?.(s.stopId); }} className={cn("ui-select rounded-md border border-line bg-surface p-2 text-left text-sm", selected === s.stopId && "border-brand")}><b>#{s.seq} · {s.stopId}</b><span className="block text-xs text-ink-soft">{blockInfo(s.block).label} · {eta(s)} · {locations[s.stopId] ?? s.pointSource}</span></button>)}</div></div> : null
  );
  const stopSequence = (
    <section className="min-w-0 overflow-hidden rounded-xl border border-line" aria-label="Route stop sequence">
        <h3 className="border-b border-line bg-canvas/50 px-4 py-3 font-semibold">Stop sequence <span className="text-sm font-normal text-ink-faint">· {filtered.length} stops</span></h3>
        <div ref={list} className="max-h-[480px] overflow-y-auto p-2"><ol className="space-y-1">{filtered.map((s) => <li key={s.stopId}><button type="button" data-route-stop={s.stopId} aria-pressed={selected === s.stopId} onClick={() => onSelect?.(s.stopId)} className={cn("ui-select flex w-full items-start gap-3 rounded-lg border border-transparent p-3 text-left text-sm hover:bg-canvas", current?.stopId === s.stopId && "border-brand/40 bg-brand-tint/50")}><span className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: blockColor(s.block) }}>#{s.seq}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap justify-between gap-x-2"><b>{s.stopId}</b><span className={Number.isFinite(s.arriveMin) ? "text-ink-soft" : "text-bad"}>{eta(s)}</span></span><span className="block break-words text-xs text-ink-soft">{locations[s.stopId] ?? s.pointSource}</span><span className="block text-xs text-ink-faint">{blockInfo(s.block).label} · {states[s.stopId]?.status ?? "pending"}{!hasRoutePoint(s) ? " · not plotted" : ` · ${s.pointSource}`}</span></span></button></li>)}</ol>{!filtered.length ? <p className="p-3 text-sm text-ink-faint">No stops in this time block.</p> : null}</div>
      </section>
  );

  return <div className="space-y-4">
    <div className="space-y-1 text-xs leading-5 text-ink-soft">
      <p className="text-sm font-medium text-ink">{firstScheduled && lastScheduled ? <>HUB → Stop #{firstScheduled.seq}{firstScheduled !== lastScheduled ? <> → … → Stop #{lastScheduled.seq}</> : null}{finish ? " (Finish)" : " · Finish not plotted"}</> : "Generate a plan to view its route."}</p>
      <p>Colored dots = delivery windows · Lines = route sequence · N orders = grouped visits</p>
      <p>Schematic using anonymized coordinates; not real road directions.</p>
      <details className="ui-disclosure">
        <summary className="w-fit cursor-pointer font-medium text-info">Route help</summary>
        <div className="max-w-3xl space-y-1 pt-2">
          <p>#N is the original Planner sequence. Open a group to see each separate visit and ETA.</p>
          <p>Time blocks belong to one continuous route. Grey lines show its sequence; the selected leg has a colored direction arrow.</p>
          <p>Nearby markers are grouped only for display. Missing locations or ETAs do not get invented or connected across.</p>
        </div>
      </details>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Route time block" className="flex flex-wrap gap-2">
        {([{ id: "all", label: "All" }, ...BLOCKS] as { id: Block | "all"; label: string }[]).map((b) => <Button key={b.id} size="sm" variant={filter === b.id ? "dark" : "outline"} aria-pressed={filter === b.id} onClick={() => { setFilter(b.id); setExpanded(null); const first = stops.find((s) => b.id === "all" || s.block === b.id); if (first) onSelect?.(first.stopId); }}>
          {b.id !== "all" ? <span className="size-2 rounded-full" style={{ background: blockColor(b.id) }} /> : null}{b.label}
        </Button>)}
      </div>
      <div className="flex items-center gap-2"><Button size="sm" disabled={index <= 0} onClick={() => onSelect?.(filtered[index - 1].stopId)}>← Previous stop</Button><Button size="sm" disabled={index < 0 || index >= filtered.length - 1} onClick={() => onSelect?.(filtered[index + 1].stopId)}>Next stop →</Button></div>
    </div>

    {desktop ? <div data-route-layout="desktop" className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
      <div data-route-column="diagram" className="min-w-0 space-y-4">{diagram}{groupedVisits}</div>
      <div data-route-column="details" className="min-w-0 space-y-4">{selectedDetails}{stopSequence}</div>
    </div> : <div data-route-layout="mobile" className="grid min-w-0 gap-4">{diagram}{selectedDetails}{groupedVisits}{stopSequence}</div>}
    {missing.length ? <p role="status" className="rounded-lg bg-warn-tint p-3 text-sm text-warn">{missing.length} stops are not plotted (missing valid location or ETA): {missing.map((s) => `#${s.seq} ${s.stopId}`).join(", ")}. All remain in the stop sequence.</p> : null}
    {!finish && stops.length ? <p className="text-sm text-warn">FINISH cannot be plotted because the last scheduled stop has no valid location, or no stop is scheduled.</p> : null}
    {stops.some((s) => !Number.isFinite(s.arriveMin)) && finish ? <p className="text-xs text-warn">FINISH marks the scheduled route only. Unscheduled orders still require dispatcher review.</p> : null}
  </div>;
}
