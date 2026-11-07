"use client";

import { Compass, Database, HardDrive, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { setTester } from "@/lib/demoState";
import type { Role } from "@/lib/evidence";
import { cn } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

const NAV: { href: string; label: string; role?: Role }[] = [
  { href: "/dispatcher", label: "Dispatcher", role: "dispatcher" },
  { href: "/intake", label: "Data intake", role: "dispatcher" },
  { href: "/rider", label: "Rider", role: "rider" },
  { href: "/stops", label: "Stop cards" },
  { href: "/buyer", label: "Buyer simulation", role: "buyer" },
  { href: "/replan", label: "Replanning" },
  { href: "/evidence", label: "Evidence" },
  { href: "/risk-challenge", label: "Risk Challenge", role: "dispatcher" },
  { href: "/how-it-works", label: "How it works" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, update, reset, adapter, saveStatus, loadError } = useDemo();
  const openProposals = state.proposals.filter((p) => p.status === "open" && p.previous.shiftId === state.shiftId).length;
  const pendingCorrections = state.corrections.filter((c) => c.status === "pending").length;

  // Visiting a role's main screen switches the demo role, so events are logged with the right role.
  const lastPath = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const item = NAV.find((n) => pathname?.startsWith(n.href));
    if (item?.role) update((s) => (s.role === item.role ? s : { ...s, role: item.role! }));
  }, [pathname, update]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link href="/dispatcher" className="flex items-center gap-2.5" aria-label="S-Compass home">
            <span className="grid size-9 place-items-center rounded-lg bg-brand text-white">
              <Compass className="size-5" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-[17px] font-semibold tracking-tight">S-Compass</span>
              <span className="block text-[11px] text-ink-faint">Competition prototype</span>
            </span>
          </Link>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
                adapter.mode === "local" ? "bg-warn-tint text-warn" : "bg-info-tint text-info",
              )}
              title={adapter.label}
            >
              {adapter.mode === "local" ? <HardDrive className="size-3.5" /> : <Database className="size-3.5" />}
              {adapter.mode === "local" ? "Demo Mode" : "Supabase"}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-ink-faint">
              <span className="hidden sm:inline">Demo role</span>
              <select
                aria-label="Demo role switcher (demo interaction, not a permission system)"
                title="Demo interaction, not a permission system"
                className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
                value={state.role}
                onChange={(e) => update((s) => ({ ...s, role: e.target.value as Role }))}
              >
                <option value="dispatcher">Dispatcher</option>
                <option value="rider">Rider</option>
                <option value="buyer">Buyer</option>
              </select>
            </label>
            <TesterButton />
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Reset demo">
                  <RotateCcw /> Reset demo
                </Button>
              </DialogTrigger>
              <DialogContent title="Reset the demo?" description="This restores the original fixtures and clears plans, corrections, buyer replies and the evidence log in this browser.">
                <p className="mb-4 text-sm text-ink-soft">Export the evidence log first if you need it for your test records.</p>
                <div className="flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button>Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="primary" onClick={reset}>
                      Reset demo
                    </Button>
                  </DialogClose>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <nav className="mx-auto max-w-[1440px] overflow-x-auto px-2" aria-label="Main">
          <ul className="flex min-w-max gap-1 px-2">
            {NAV.map((n) => {
              const active = pathname?.startsWith(n.href);
              const count = n.href === "/replan" ? openProposals : n.href === "/stops" ? pendingCorrections : 0;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                      active ? "border-brand font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink",
                    )}
                  >
                    {n.label}
                    {count > 0 ? <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{count}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      {loadError ? (
        <div role="alert" className="border-b border-bad/30 bg-bad-tint px-4 py-2 text-sm text-bad">
          <TriangleAlert className="mr-1 inline size-4" /> {loadError}. Started a fresh local demo instead.
        </div>
      ) : null}
      {saveStatus && !saveStatus.ok ? (
        <div role="alert" className="border-b border-bad/30 bg-bad-tint px-4 py-2 text-sm text-bad">
          <TriangleAlert className="mr-1 inline size-4" /> {saveStatus.message}
        </div>
      ) : null}

      <main className="mx-auto max-w-[1440px] px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-[1440px] px-4 pb-8 text-xs leading-5 text-ink-faint">
        S-Compass is a Business Challenge 2026 competition prototype by team BCE004 (Watt the hedge). It is not an official Shopee product. Buyer and place names are fictional.
        Positions are de-identified dataset pins. No real SMS, e-mail or payment request is ever sent.
        {saveStatus?.ok ? ` Last saved ${new Date(saveStatus.at).toLocaleTimeString()} (${saveStatus.target === "browser" ? "this browser" : "Supabase"}).` : ""}
      </footer>
    </div>
  );
}

const PERSONAS = [
  "Presenter (team member)",
  "Mock persona: new rider (week 3)",
  "Mock persona: veteran rider (2 years)",
  "Mock persona: hub dispatcher",
  "Mock persona: office buyer",
  "Mock persona: factory-shift buyer",
  "Peer tester (student)",
];

function TesterButton() {
  const { state, update } = useDemo();
  const [name, setName] = React.useState(state.tester.name);
  const [persona, setPersona] = React.useState(state.tester.persona);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Who is testing? Used in the evidence log">
          Tester: {state.tester.name || "not set"}
        </Button>
      </DialogTrigger>
      <DialogContent title="Start a test session" description="The name and persona are written on every evidence event, so test logs can be checked later.">
        <div className="space-y-3">
          <div>
            <label htmlFor="tester-name" className="mb-1 block text-sm font-medium">
              Tester name or code
            </label>
            <input id="tester-name" className="h-10 w-full rounded-lg border border-line px-3 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Peer-03" />
          </div>
          <div>
            <label htmlFor="tester-persona" className="mb-1 block text-sm font-medium">
              Persona
            </label>
            <select id="tester-persona" className="h-10 w-full rounded-lg border border-line px-3 text-sm" value={persona} onChange={(e) => setPersona(e.target.value)}>
              {PERSONAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="primary" onClick={() => update((s) => setTester(s, name.trim(), persona))}>
                Start test session
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
