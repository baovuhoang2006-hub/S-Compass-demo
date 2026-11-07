"use client";

import { BLOCKS, fmt } from "@/lib/time";
import type { Plan, StopState } from "@/lib/types";
import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * The shift as a time ribbon: each stop sits at its simulated arrival time, coloured by
 * its history-table chance of success. This is where the window choice becomes visible.
 */
export function ShiftRibbon({
  plan,
  states,
  clockMin,
  onSelect,
  selected,
}: {
  plan: Plan;
  states: Record<string, StopState>;
  clockMin?: number;
  onSelect?: (id: string) => void;
  selected?: string | null;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div>
      <div className="space-y-3">
        {BLOCKS.map((b) => {
          const label = b.id === "morning" ? "Morning" : b.id === "afternoon" ? "Afternoon" : "Evening";
          const span = b.end - b.start;
          const x = (m: number) => Math.max(0, Math.min(100, ((m - b.start) / span) * 100));
          const stops = plan.stops.filter((s) => s.block === b.id && Number.isFinite(s.arriveMin)).sort((a, b) => a.arriveMin - b.arriveMin);
          const clusters: { stops: typeof stops; x: number }[] = [];
          for (const s of stops) {
            const at = x(s.arriveMin);
            const tail = clusters[clusters.length - 1];
            if (tail && at - tail.x < 5) {
              tail.stops.push(s);
              tail.x = tail.stops.reduce((sum, item) => sum + x(item.arriveMin), 0) / tail.stops.length;
            } else clusters.push({ stops: [s], x: at });
          }
          const tone = b.id === "morning" ? "bg-morning/[0.08]" : b.id === "afternoon" ? "bg-afternoon/[0.09]" : "bg-evening/[0.09]";
          return <section key={b.id} aria-label={`${label} ${fmt(b.start)}–${fmt(b.end)}`}>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-soft"><span>{label}</span><span>{fmt(b.start)}–{fmt(b.end)}</span></div>
            <div className={cn("relative h-12 rounded-md border border-line", tone)}>
              {Array.from({ length: 5 }, (_, i) => {
                const tick = b.start + span * i / 4;
                return <div key={i} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${i * 25}%` }}><span className="absolute bottom-0.5 left-1 text-[9px] text-ink-faint">{fmt(tick)}</span></div>;
              })}
              {clockMin !== undefined && clockMin >= b.start && clockMin <= b.end ? <div className="absolute inset-y-0 z-[1] w-0.5 bg-brand" style={{ left: `${x(clockMin)}%` }} title={`Simulated time ${fmt(clockMin)}`} /> : null}
              {clusters.map(({ stops: group, x: at }) => {
                const key = `${b.id}:${group[0].stopId}`;
                const active = group.some((s) => s.stopId === selected);
                const stopButton = (s: typeof group[number]) => {
                  const st = states[s.stopId]?.status;
                  const done = st === "delivered" || st === "failed";
                  const color = s.p === null ? "bg-info" : s.p >= 0.8 ? "bg-ok" : s.p >= 0.65 ? "bg-warn" : "bg-bad";
                  return <button key={s.stopId} type="button" onClick={() => onSelect?.(s.stopId)} className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white", done ? "bg-ink-faint" : color, selected === s.stopId && "ring-2 ring-brand")} aria-label={`Stop sequence ${s.seq}, ${s.stopId}, ETA ${fmt(s.arriveMin)}`} title={`${s.stopId} · ${fmt(s.arriveMin)}`}>#{s.seq}</button>;
                };
                return <div key={key} className="absolute top-1 z-[2] -translate-x-1/2" style={{ left: `${at}%` }}>
                  {group.length === 1 ? stopButton(group[0]) : <button type="button" onClick={() => setExpanded(expanded === key ? null : key)} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink shadow-sm" aria-expanded={expanded === key} aria-label={`Show ${group.length} stops close in time`}>+{group.length}</button>}
                  {group.length > 1 && expanded === key ? <div className="absolute left-1/2 top-7 z-10 min-w-40 -translate-x-1/2 space-y-1 rounded-md border border-line bg-surface p-2 shadow-lg">{group.map((s) => <div key={s.stopId} className="flex items-center justify-between gap-2 text-xs"><span>{stopButton(s)}</span><span>{s.stopId} · {fmt(s.arriveMin)}</span></div>)}</div> : null}
                  {group.length === 1 ? <span className="sr-only">{at.toFixed(1)}%</span> : null}
                </div>;
              })}
            </div>
          </section>;
        })}
      </div>
      {plan.stops.some((s) => !Number.isFinite(s.arriveMin)) ? <div className="mt-2 rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-xs text-warn"><b>Unscheduled stops ({plan.stops.filter((s) => !Number.isFinite(s.arriveMin)).length})</b><ul className="mt-1 list-inside list-disc">{plan.stops.filter((s) => !Number.isFinite(s.arriveMin)).map((s) => <li key={s.stopId}>#{s.seq} · {s.stopId} — no ETA available</li>)}</ul></div> : null}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2 rounded-sm bg-ok" /> ≥80% chance
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2 rounded-sm bg-warn" /> 65–79%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2 rounded-sm bg-bad" /> &lt;65%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2 rounded-sm bg-info" /> pickup (not estimated)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2 rounded-sm bg-ink-faint/40" /> done
        </span>
        <span>Chance = history-table estimate (simulated)</span>
      </div>
    </div>
  );
}
