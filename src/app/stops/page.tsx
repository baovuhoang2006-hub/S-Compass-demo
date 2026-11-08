"use client";

import * as React from "react";
import { CardStatusBadge, TYPE_LABEL } from "@/components/bits";
import { KnowledgeReviewQueue } from "@/components/KnowledgeReviewQueue";
import { StopCardDialog } from "@/components/StopCardDialog";
import { Input, Label } from "@/components/ui/field";
import { knowledgeForRider, riderOfShift } from "@/lib/data";
import type { CardStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

const ORDER: CardStatus[] = ["disputed", "unverified", "suggested", "verified"];

export default function StopsPage() {
  const { state, cards, shift } = useDemo();
  const [open, setOpen] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<CardStatus | "all">("all");
  const [search, setSearch] = React.useState("");
  const rider = riderOfShift(shift);
  const zoneCards = knowledgeForRider(rider.id).map((k) => cards[k.key]);
  const list = zoneCards.filter((c) => (filter === "all" || c.status === filter) && c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  React.useEffect(() => { setOpen(null); setSearch(""); setFilter("all"); }, [rider.id]);

  return <div className="space-y-4">
    <div>
      <h1 className="text-xl font-semibold">Site Knowledge</h1>
      <p className="text-sm text-ink-soft">Review delivery-site knowledge, verify rider feedback, and manage instructions for future plans.</p>
      <p className="mt-1 text-sm font-medium">{rider.label} · {rider.zoneLabel} · {zoneCards.length} sites · {shift.weekday} {shift.date}</p>
      <details className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm"><summary className="cursor-pointer font-medium">How verification works</summary><div className="mt-2 space-y-2 text-ink-soft">
        <p>Rider → pending report → Dispatcher review → site knowledge for future plans. Change the rider on Dispatcher to select another zone.</p>
        <p>Dataset notes start as Suggested or Unverified. A dataset pin is not a verified entrance. Seeded Verified cards are labelled demo fixtures, not real field inspections.</p>
        <p>Unreviewed reports never replace official instructions or create hard rules. Pending disputes require dispatcher advice. An accepted dispute flags the card for resolution; use a new observation to verify it again.</p>
        <p>Approved updates do not change dispatched routes, completed stops or buyer-confirmed windows. Generate and review a new plan explicitly. Demo role selection is not production authentication; reports stay in this browser. No automatic model retraining.</p>
      </div></details>
    </div>
    <a href="#knowledge-review" className="inline-block text-sm font-medium text-info underline">Review requests ({state.corrections.filter((c) => c.status === "pending" && zoneCards.some((site) => site.key === c.locationKey)).length})</a>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <div className="max-w-md"><Label htmlFor="site-search">Search sites in this zone</Label><Input id="site-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site name" /></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {(["all", ...ORDER] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-md border px-3 py-1 text-sm", filter === f ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-soft")}>
            {f === "all" ? `All (${zoneCards.length})` : `${f[0].toUpperCase()}${f.slice(1)} (${zoneCards.filter((c) => c.status === f).length})`}
          </button>)}
        </div>
        <ul aria-label="Site cards" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((c) => {
          const orders = shift.stops.filter((s) => s.locationKey === c.key).length;
          const dispute = state.corrections.some((r) => r.locationKey === c.key && r.field === "dispute" && r.status === "pending");
          // Safety first: live closure, then hard rule, then access instruction, then a soft rule.
          const restriction = c.temporaryClosure?.text ?? c.restrictions.find((r) => r.strength === "hard")?.text ?? c.access[0] ?? c.restrictions[0]?.text;
          return <li key={c.key}><button data-site-card={c.key} onClick={() => setOpen(c.key)} className="h-full w-full min-w-0 space-y-2 rounded-xl border border-line bg-surface p-4 text-left hover:border-ink-faint focus-visible:outline-2 focus-visible:outline-info">
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words font-semibold leading-5">{c.name}</span><CardStatusBadge status={c.status} /></div>
            <p className="text-xs text-ink-soft">{TYPE_LABEL[c.type]} · {orders} {orders === 1 ? "order" : "orders"} this shift</p>
            <p className="line-clamp-2 break-words text-sm"><span className="text-ink-faint">Entrance: </span>{c.entrance}</p>
            <p className="line-clamp-2 break-words text-sm"><span className="text-ink-faint">Handover: </span>{c.handover}</p>
            {restriction ? <p className="line-clamp-2 break-words text-xs text-warn">{restriction}</p> : null}
            {dispute ? <p className="text-xs font-medium text-bad">Dispute awaiting review · consult Dispatcher</p> : null}
          </button></li>;
        })}</ul>
        {!list.length ? <p role="status" className="rounded-lg border border-line p-5 text-sm text-ink-soft">No sites match this search and filter in the selected zone.</p> : null}
      </div>
      <aside id="knowledge-review" className="min-w-0 scroll-mt-40"><KnowledgeReviewQueue siteKeys={zoneCards.map((c) => c.key)} onOpen={setOpen} /></aside>
    </div>
    <StopCardDialog cardKey={open} open={!!open} onOpenChange={(o) => !o && setOpen(null)} from="site knowledge" />
  </div>;
}
