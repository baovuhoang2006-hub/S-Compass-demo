"use client";

import { Download, FileJson, NotebookPen } from "lucide-react";
import * as React from "react";
import { SourceTag, Stat } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { addTesterNote } from "@/lib/demoState";
import { EVENT_TYPES, metrics, toCsv } from "@/lib/evidence";
import { downloadText } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

export default function EvidencePage() {
  const { state, update, adapter } = useDemo();
  const [type, setType] = React.useState("all");
  const [note, setNote] = React.useState("");
  const m = metrics(state.events);
  const events = [...state.events].reverse().filter((e) => type === "all" || e.type === type);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId: state.sessionId,
      persistence: adapter.mode,
      note: "S-Compass competition prototype. Every event below was produced by a real interaction in this browser session.",
      metrics: m,
      events: state.events,
      corrections: state.corrections,
      outcomes: state.outcomes,
      proposals: state.proposals.map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        trigger: p.triggerText,
        status: p.status,
        decisionNote: p.decisionNote,
        previousRemaining: p.previousRemaining,
        proposedRemaining: p.proposedRemaining,
        commitments: p.commitments,
      })),
    };
    downloadText(`s-compass-evidence-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evidence</h1>
          <p className="max-w-3xl text-sm text-ink-soft">
            Every number here comes from interactions in this session ({state.sessionId}). Nothing is pre-filled. Set a tester name and persona in the header so test logs can be traced.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => downloadText(`s-compass-evidence-${stamp}.csv`, toCsv(state.events), "text/csv")} disabled={!state.events.length}>
            <Download /> Export CSV
          </Button>
          <Button onClick={exportJson} disabled={!state.events.length}>
            <FileJson /> Export JSON
          </Button>
        </div>
      </div>

      <Panel>
        <PanelHeader title="Session metrics" actions={<SourceTag kind="live" />} />
        <div className="grid grid-cols-2 gap-5 px-4 py-4 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Events logged" value={m.total} />
          <Stat label="Plans generated" value={m.plansGenerated} sub={m.avgPlanMs !== null ? `avg ${m.avgPlanMs.toFixed(1)} ms` : undefined} />
          <Stat label="Comparisons" value={m.comparisons} />
          <Stat label="Stop cards opened" value={m.cardsOpened} />
          <Stat label="Corrections" value={`${m.correctionsApproved}/${m.correctionsSuggested}`} sub="approved / suggested" />
          <Stat label="Buyer replies" value={`${m.buyerAnswered}/${m.buyerInvited}`} sub={`answered / invited · ${m.buyerNoResponse} silent`} />
          <Stat label="Plan changes" value={`${m.replansAccepted}/${m.replansProposed}`} sub={`accepted / proposed · ${m.replansOverridden} overridden`} />
          <Stat label="Outcomes recorded" value={m.outcomes} />
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">Testers in this log: {m.testers.join(", ") || "none set yet"}.</p>
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="min-w-0">
          <PanelHeader
            title="Interaction log"
            note={`${events.length} of ${state.events.length} events`}
            actions={
              <Select aria-label="Filter by event type" value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-56 text-xs">
                <option value="all">All event types</option>
                {Object.entries(EVENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            }
          />
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-ink-faint">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Tester / role</th>
                  <th className="px-3 py-2 font-normal">Event</th>
                  <th className="px-3 py-2 font-normal">Input</th>
                  <th className="px-3 py-2 font-normal">Output</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-line/70 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">{new Date(e.at).toLocaleTimeString()}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.tester}
                      <span className="block text-ink-faint">
                        {e.role} · {e.persona}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block text-xs text-ink-faint">{EVENT_TYPES[e.type] ?? e.type}</span>
                      {e.summary}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{e.input ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {e.output ?? "—"}
                      {e.computeMs !== undefined ? <span className="block text-ink-faint">{e.computeMs} ms</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length ? <p className="px-4 py-8 text-center text-sm text-ink-faint">No events yet. Generate a plan on the Dispatcher screen to start the log.</p> : null}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Tester note" note="Observations from a test run, saved into the log" />
          <div className="space-y-2 px-4 py-3">
            <Label htmlFor="tester-note" className="sr-only">
              Tester note
            </Label>
            <Textarea id="tester-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Peer-03 found the stop card in 2 taps; asked for a call button" />
            <Button
              variant="dark"
              className="w-full"
              disabled={!note.trim()}
              onClick={() => {
                update((s) => addTesterNote(s, note.trim()));
                setNote("");
              }}
            >
              <NotebookPen /> Save note
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
