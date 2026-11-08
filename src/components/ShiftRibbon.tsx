"use client";

import * as React from "react";
import { blockColor } from "@/components/bits";
import { scheduleExceptions, timelineGroups } from "@/lib/routePresentation";
import { BLOCKS, blockLabel, fmt } from "@/lib/time";
import type { Plan, PlannedStop, StopState } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ShiftRibbon({ plan, states, clockMin, onSelect, selected }: {
  plan: Plan; states: Record<string, StopState>; clockMin?: number;
  onSelect?: (id: string) => void; selected?: string | null;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [width, setWidth] = React.useState(300);
  const container = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width - 40)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const exceptions = scheduleExceptions(plan.stops);
  const select = (stop: PlannedStop) => onSelect?.(stop.stopId);
  return <div ref={container} className="space-y-5">
    {BLOCKS.map((block) => {
      const groups = timelineGroups(plan.stops.filter((s) => s.block === block.id), block.start, block.end, width);
      const ticks = [block.start];
      for (let tick = Math.ceil((block.start + 45) / 60) * 60; tick < block.end; tick += 60) ticks.push(tick);
      ticks.push(block.end);
      const opened = groups.find((g) => `${block.id}:${g.stops[0].stopId}` === expanded);
      return <section key={block.id} aria-label={blockLabel(block.id)}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <h3 className="flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-full" style={{ background: blockColor(block.id) }} />{block.label}</h3>
          <span className="text-ink-soft">{fmt(block.start)}–{fmt(block.end)}</span>
        </div>
        <div className="px-5">
          <div className="relative h-16 rounded-lg border border-line" style={{ backgroundColor: `${blockColor(block.id)}0d` }}>
            {ticks.map((tick) => <div key={tick} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${(tick - block.start) / (block.end - block.start) * 100}%` }} />)}
            {clockMin !== undefined && clockMin >= block.start && clockMin <= block.end ? <div className="absolute inset-y-0 w-0.5 bg-brand" style={{ left: `${(clockMin - block.start) / (block.end - block.start) * 100}%` }} title={`Simulated time ${fmt(clockMin)}`} /> : null}
            {groups.map((group) => {
              const key = `${block.id}:${group.stops[0].stopId}`;
              const active = group.stops.some((s) => s.stopId === selected);
              const single = group.stops[0];
              const done = group.stops.every((s) => ["delivered", "failed"].includes(states[s.stopId]?.status));
              return <button key={key} type="button" style={{ left: `${group.percent}%`, backgroundColor: done ? "#6b7590" : blockColor(block.id) }}
                className={cn("ui-select absolute top-3 min-h-9 min-w-9 -translate-x-1/2 rounded-full border-2 border-white px-2 text-xs font-semibold text-white shadow-sm hover:brightness-90", active && "ring-2 ring-brand ring-offset-2")}
                aria-label={group.stops.length > 1 ? `Show ${group.stops.length} ${block.label.toLowerCase()} stops close in time` : `Stop sequence ${single.seq}, ${single.stopId}, ETA ${fmt(single.arriveMin)}`}
                aria-expanded={group.stops.length > 1 ? expanded === key : undefined}
                aria-pressed={group.stops.length === 1 ? active : undefined}
                title={group.stops.map((s) => `#${s.seq} · ${s.stopId} · ${fmt(s.arriveMin)} · ${s.p === null ? "no estimate" : `${Math.round(s.p * 100)}% history-table estimate`}`).join("\n")}
                onClick={() => group.stops.length > 1 ? setExpanded(expanded === key ? null : key) : select(single)}>
                {group.stops.length > 1 ? `+${group.stops.length}` : `#${single.seq}`}
              </button>;
            })}
            {!groups.length ? <p className="px-3 pt-5 text-center text-xs text-ink-faint">No stops inside this window</p> : null}
          </div>
          <div className="relative mt-1 h-5 text-[10px] text-ink-soft sm:text-xs">{ticks.map((tick) => <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${(tick - block.start) / (block.end - block.start) * 100}%` }}>{fmt(tick)}</span>)}</div>
        </div>
        {opened ? <div className="ui-reveal mt-2 rounded-lg border border-line bg-canvas/70 p-3">
          <div className="mb-2 flex items-center justify-between text-sm"><b>{opened.stops.length} stops close in time</b><button type="button" className="text-info underline" onClick={() => setExpanded(null)}>Collapse</button></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{opened.stops.map((s) => <button type="button" key={s.stopId} onClick={() => select(s)} aria-pressed={selected === s.stopId} className={cn("ui-select flex min-h-11 items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 text-sm hover:border-ink-faint", selected === s.stopId && "border-brand bg-brand-tint")}><span><b>#{s.seq}</b> · {s.stopId}</span><span>{fmt(s.arriveMin)}</span></button>)}</div>
        </div> : null}
      </section>;
    })}
    {exceptions.outsideWindow.length ? <div role="status" className="rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm text-warn"><b>Outside assigned time window · {exceptions.outsideWindow.length} stops</b><p className="mt-1">These original simulated ETAs are shown here instead of being moved to the edge of the timeline.</p><div className="mt-2 flex flex-wrap gap-2">{exceptions.outsideWindow.map((s) => <button type="button" key={s.stopId} className="rounded-md border border-warn/40 bg-surface px-3 py-2 text-left" onClick={() => select(s)}>#{s.seq} · {s.stopId} · {fmt(s.arriveMin)}<span className="block text-xs">Assigned: {blockLabel(s.block)}</span></button>)}</div></div> : null}
    {exceptions.unscheduled.length ? <div role="status" className="rounded-lg border border-bad/30 bg-bad-tint p-3 text-sm text-bad"><b>Unscheduled stops · {exceptions.unscheduled.length}</b><div className="mt-2 flex flex-wrap gap-2">{exceptions.unscheduled.map((s) => <button type="button" key={s.stopId} onClick={() => select(s)} className="rounded-md border border-bad/30 bg-surface px-3 py-2">#{s.seq} · {s.stopId} — no ETA available</button>)}</div></div> : null}
    <p className="text-xs text-ink-faint">Simulated arrival times · # is the Planner sequence · +N opens all grouped stops. Select a stop to highlight it in Deliveries and Route.</p>
  </div>;
}
