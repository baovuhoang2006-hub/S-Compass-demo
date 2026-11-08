"use client";

import * as React from "react";
import { fixtures, loadImportedLocal, saveImportedLocal, setImported, shiftById } from "@/lib/data";
import { cardsFor, ensureShiftState, initialState, log, restoreKnowledgeReviews, type DemoState } from "@/lib/demoState";
import { getAdapter, type PersistenceAdapter, type SaveResult } from "@/lib/persistence";
import type { Plan, Shift, StopCard } from "@/lib/types";

interface DemoContextValue {
  state: DemoState;
  update: (fn: (s: DemoState) => DemoState) => void;
  reset: () => void;
  shift: Shift;
  cards: Record<string, StopCard>;
  plan: Plan | null;
  adapter: PersistenceAdapter;
  saveStatus: SaveResult | null;
  loadError: string | null;
}

const DemoContext = React.createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const adapter = React.useMemo(() => getAdapter(), []);
  const [state, setState] = React.useState<DemoState | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<SaveResult | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const dirty = React.useRef(false);

  React.useEffect(() => {
    let alive = true;
    adapter
      .load()
      .then((s) => {
        if (!alive) return;
        const imported = loadImportedLocal();
        if (imported) setImported(imported);
        let next = s ?? initialState();
        if (!fixtures.shifts.some((x) => x.id === next.shiftId)) next = { ...next, shiftId: fixtures.shifts.find((x) => !x.id.startsWith("imp-"))?.id ?? fixtures.shifts[0].id };
        setState(restoreKnowledgeReviews(ensureShiftState(next, next.shiftId)));
      })
      .catch((e: Error) => {
        if (!alive) return;
        setLoadError(e.message);
        setState(initialState());
      });
    return () => {
      alive = false;
    };
  }, [adapter]);

  React.useEffect(() => {
    if (!state || !dirty.current) return;
    const t = window.setTimeout(() => {
      adapter.save(state).then(setSaveStatus);
    }, 350);
    return () => window.clearTimeout(t);
  }, [state, adapter]);

  const update = React.useCallback((fn: (s: DemoState) => DemoState) => {
    dirty.current = true;
    setState((s) => (s ? fn(s) : s));
  }, []);

  const reset = React.useCallback(() => {
    dirty.current = true;
    setImported(null);
    saveImportedLocal(null);
    adapter.clear().finally(() => {
      setState(log(initialState(), { type: "demo_reset", summary: "Demo reset to the original fixtures" }));
    });
  }, [adapter]);

  const value = React.useMemo<DemoContextValue | null>(() => {
    if (!state) return null;
    return {
      state,
      update,
      reset,
      shift: shiftById(state.shiftId),
      cards: cardsFor(state),
      plan: state.currentPlan[state.shiftId],
      adapter,
      saveStatus,
      loadError,
    };
  }, [state, update, reset, adapter, saveStatus, loadError]);

  if (!value) {
    return <div className="p-8 text-sm text-ink-faint">Loading demo data…</div>;
  }
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = React.useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
  return ctx;
}
