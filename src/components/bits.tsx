"use client";

import { BadgeCheck, CircleHelp, CircleSlash, Lightbulb } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { blockInfo, fmt } from "@/lib/time";
import type { Block, CardStatus, LocationType, PlanMethod } from "@/lib/types";
import { cn, pct } from "@/lib/utils";

export const TYPE_LABEL: Record<LocationType, string> = {
  school: "School",
  office: "Office",
  industrial: "Industrial",
  gated_facility: "Gated site",
};

export function CardStatusBadge({ status }: { status: CardStatus }) {
  if (status === "verified")
    return (
      <Badge tone="ok">
        <BadgeCheck /> Verified
      </Badge>
    );
  if (status === "suggested")
    return (
      <Badge tone="warn">
        <Lightbulb /> Suggested
      </Badge>
    );
  if (status === "disputed")
    return (
      <Badge tone="bad">
        <CircleSlash /> Disputed
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <CircleHelp /> Unverified
    </Badge>
  );
}

const BLOCK_DOT: Record<Block, string> = {
  morning: "bg-morning",
  afternoon: "bg-afternoon",
  evening: "bg-evening",
};

export function BlockTag({ block, eta, className }: { block: Block; eta?: number; className?: string }) {
  const info = blockInfo(block);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span className={cn("size-2.5 rounded-full", BLOCK_DOT[block])} aria-hidden />
      <span>
        {info.label}
        {eta !== undefined ? Number.isFinite(eta) ? <span className="text-ink-faint"> · ETA {fmt(eta)}</span> : <span className="text-warn"> · Unscheduled</span> : null}
      </span>
    </span>
  );
}

export function blockColor(block: Block) {
  return block === "morning" ? "#356daf" : block === "afternoon" ? "#a66300" : "#4b3f8f";
}

export function ChanceText({ p }: { p: number | null }) {
  if (p === null) return <span className="text-ink-faint">not estimated</span>;
  const tone = p >= 0.8 ? "text-ok" : p >= 0.65 ? "text-warn" : "text-bad";
  return <span className={cn("font-medium", tone)}>{pct(p)}</span>;
}

export function MethodBadge({ method }: { method: PlanMethod }) {
  if (method === "baseline") return <Badge tone="neutral">Baseline</Badge>;
  if (method === "rules") return <Badge tone="info">Rules-based</Badge>;
  return <Badge tone="warn">Model-assisted (experimental)</Badge>;
}

/** Small source label so every number says where it comes from. */
export function SourceTag({ kind }: { kind: "dataset" | "simulated" | "live" | "assumption" | "fixture" }) {
  const map = {
    dataset: { t: "Dataset", c: "bg-info-tint text-info" },
    simulated: { t: "Simulated", c: "bg-warn-tint text-warn" },
    live: { t: "Live demo", c: "bg-ok-tint text-ok" },
    assumption: { t: "Assumption", c: "bg-canvas text-ink-soft ring-1 ring-line" },
    fixture: { t: "Demo fixture", c: "bg-canvas text-ink-soft ring-1 ring-line" },
  }[kind];
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", map.c)}>{map.t}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-xl font-semibold leading-7">{value}</div>
      {sub ? <div className="text-xs text-ink-faint">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-ink-faint">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
