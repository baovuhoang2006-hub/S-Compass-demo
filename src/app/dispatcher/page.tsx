"use client";

import { ArrowLeftRight, BarChart3, Info, Send, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BlockTag, CardStatusBadge, ChanceText, EmptyState, MethodBadge, SourceTag, Stat, TYPE_LABEL } from "@/components/bits";
import { RouteMap } from "@/components/RouteMap";
import { ShiftRibbon } from "@/components/ShiftRibbon";
import { InlineStopCardReview, StopCardDialog } from "@/components/StopCardDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { BACKUP_RIDER, fixtures, historical, riderOfShift } from "@/lib/data";
import { comparePlans, dispatchPlan, generatePlan, selectRider, selectShift, transferParcel } from "@/lib/demoState";
import { metrics } from "@/lib/evidence";
import { onRoadMinutesPerParcel } from "@/lib/kpi";
import { METHOD_LABEL } from "@/lib/planner";
import { fmt } from "@/lib/time";
import type { Plan, PlannedStop } from "@/lib/types";
import { cn, pct } from "@/lib/utils";
import { useDemo } from "@/state/DemoProvider";

type Filter = "all" | "pending" | "risk" | "done";

export default function DispatcherPage() {
  const { state, update, shift, cards, plan } = useDemo();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [cardOpen, setCardOpen] = React.useState<{ key: string; stopId: string } | null>(null);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [transferStop, setTransferStop] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [openCardRow, setOpenCardRow] = React.useState<string | null>(null);
  const [showDetails, setShowDetails] = React.useState(false);

  const rider = riderOfShift(shift);
  const draft = state.draftPlan && state.draftPlan.shiftId === shift.id ? state.draftPlan : null;
  const shown: Plan | null = draft ?? plan;
  const states = state.stopStates[shift.id];
  const stopById = Object.fromEntries(shift.stops.map((s) => [s.id, s]));

  const rows: (PlannedStop | null)[] = shown ? shown.stops : shift.stops.map(() => null);
  const isRisk = (ps: PlannedStop) => states[ps.stopId]?.status === "pending" && (ps.flags.length > 0 || (ps.p !== null && ps.p < 0.65));
  const pendingCount = shift.stops.filter((s) => states[s.id].status === "pending").length;
  const riskCount = shown ? shown.stops.filter(isRisk).length : 0;
  const doneCount = shift.stops.filter((s) => ["delivered", "failed"].includes(states[s.id].status)).length;
  const transferred = state.transfers.filter((t) => t.shiftId === shift.id);
  const m = metrics(state.events);
  const pendingCorrections = state.corrections.filter((c) => c.status === "pending");
  const openProposal = state.proposals.find((p) => p.status === "open" && p.previous.shiftId === shift.id);
  const staleBuyerStops = draft ? draft.stops.filter((ps) => {
    const buyer = states[ps.stopId]?.buyer;
    return (buyer?.kind === "confirmed" || buyer?.kind === "changed") && buyer.block !== ps.block;
  }) : [];
  const dispatchBlockReason = openProposal
    ? "Có đề xuất điều phối đang chờ duyệt. Hãy xử lý trong Replanning trước khi Dispatch."
    : staleBuyerStops.length
      ? `Bản nháp chưa theo khung giờ buyer đã xác nhận cho ${staleBuyerStops.map((s) => s.stopId).join(", ")}. Hãy tạo lại kế hoạch.`
      : null;
  const openComparison = () => {
    update((s) => comparePlans(s));
    setCompareOpen(true);
  };

  const shownRows = shown
    ? shown.stops.filter((ps) => {
        const st = states[ps.stopId]?.status;
        if (filter === "pending") return st === "pending";
        if (filter === "done") return st === "delivered" || st === "failed";
        if (filter === "risk") return isRisk(ps);
        return true;
      })
    : [];

  return (
    <div className="space-y-5">
      {/* Shift and planning controls */}
      <Panel>
        <div className="flex flex-wrap items-end gap-4 px-4 py-4">
          <div>
            <label htmlFor="rider" className="text-xs text-ink-faint">
              Tài xế
            </label>
            <select
              id="rider"
              className="mt-1 block h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
              value={rider.id}
              onChange={(e) => update((s) => selectRider(s, e.target.value))}
            >
              {fixtures.riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.zoneLabel} ({r.locations} sites)
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-ink-faint">Demo persona: new rider. Tenure is not in the dataset.</div>
          </div>
          <div>
            <label htmlFor="shift" className="text-xs text-ink-faint">
              Ca giao mẫu
            </label>
            <select
              id="shift"
              className="mt-1 block h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
              value={shift.id}
              onChange={(e) => update((s) => selectShift(s, e.target.value))}
            >
              {rider.shiftIds.map((id) => {
                const s = fixtures.shifts.find((x) => x.id === id)!;
                return (
                  <option key={s.id} value={s.id}>
                    {s.weekday} {s.date} · {s.stops.length} parcels
                  </option>
                );
              })}
            </select>
            <div className="mt-1 text-xs text-ink-faint">A real rider-day from the dataset, de-identified</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => update((s) => generatePlan(s, "rules"))}>
              <Sparkles /> Tạo kế hoạch đề xuất
            </Button>
            <Button onClick={openComparison}>
              <BarChart3 /> So sánh phương án
            </Button>
            {draft ? (
                <Button variant="dark" disabled={!!dispatchBlockReason} title={dispatchBlockReason ?? "Gửi bản nháp cho rider"} onClick={() => update((s) => dispatchPlan(s, draft))}>
                <Send /> Dispatch cho rider
              </Button>
            ) : null}
          </div>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
          Rules-based là phương pháp vận hành có bằng chứng hỗ trợ tốt nhất hiện có; Model vẫn là thử nghiệm. Đây là kế hoạch mô phỏng, chưa có kết quả giao thực tế để gọi phương pháp nào là chính xác nhất. <Link href="/how-it-works" className="text-info underline underline-offset-2">Xem cách hoạt động</Link>
        </p>
      </Panel>

      {dispatchBlockReason ? <div role="alert" className="rounded-lg border border-warn/50 bg-warn-tint px-4 py-3 text-sm text-warn"><b>Dispatch đang tạm khóa:</b> {dispatchBlockReason}{openProposal ? <Link className="ml-2 underline" href="/replan">Mở Replanning</Link> : null}</div> : null}

      {/* Main view keeps operational decisions prominent; reference and session detail stay available below. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
                <PanelHeader
            title={shown ? (draft ? "Bản nháp kế hoạch" : "Kế hoạch đã dispatch") : "Chưa tạo kế hoạch"}
            note={shown ? `${METHOD_LABEL[shown.method]} · Ước tính mô phỏng` : "Tạo kế hoạch đề xuất để xem lịch giao"}
            actions={<SourceTag kind="simulated" />}
          />
          {shown ? (
            <div className="grid grid-cols-2 gap-4 px-4 py-3">
              <Stat label="Đơn đã xếp lịch" value={`${shown.totals.scheduledStops} / ${shown.totals.stops}`} sub="đã xếp / tổng đơn trong kế hoạch" />
              <Stat label="Giao lần đầu thành công dự kiến" value={`${shown.totals.expectedSuccess.toFixed(1)} / ${shown.totals.estimatedStops}`} sub="Ước tính từ lịch sử · cùng mẫu số so sánh" />
              <Stat label="Giờ kết thúc dự kiến" value={fmt(shown.totals.endMin)} sub="Ước tính mô phỏng" />
              <Stat label="Cần chú ý / quyết định chờ" value={`${shown.totals.flagged} / ${pendingCorrections.length + (openProposal ? 1 : 0)}`} sub={`${pendingCount} đơn đang chờ giao`} />
              {shown.totals.scheduledStops !== shown.totals.stops ? <p className="col-span-2 text-xs text-warn">Chưa xếp lịch {shown.totals.stops - shown.totals.scheduledStops}/{shown.totals.stops} đơn. Chỉ số thời gian mỗi đơn không thể so sánh đầy đủ.</p> : null}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-faint">Chưa có bản nháp hoặc bản đã dispatch.</p>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">Nguồn: lịch sử giao đã ẩn danh · Phương pháp: {shown ? METHOD_LABEL[shown.method] : "chưa chạy"}. <button className="text-info underline" onClick={openComparison}>So sánh phương án</button></p>
        </Panel>
        <Panel>
          <PanelHeader title="Tiến độ giao" note="Hoạt động trong phiên demo" actions={<SourceTag kind="live" />} />
          <div className="px-4 py-3"><Stat label="Stop hoàn tất" value={`${doneCount} / ${shift.stops.length}`} sub={`${shift.stops.filter((s) => states[s.id].status === "delivered").length} thành công · ${shift.stops.filter((s) => states[s.id].status === "failed").length} thất bại`} /></div>
          <details className="border-t border-line px-4 py-3"><summary className="cursor-pointer font-medium">Hoạt động demo · {m.buyerAnswered} phản hồi · {pendingCorrections.length + (openProposal ? 1 : 0)} quyết định chờ</summary><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Stat label="Buyer replies" value={m.buyerAnswered} sub={`${m.buyerNoResponse} no response`} /><Stat label="Corrections" value={`${m.correctionsApproved} approved`} sub={`${pendingCorrections.length} waiting`} /><Stat label="Plan changes" value={`${m.replansAccepted} accepted`} sub={`${m.replansOverridden} overridden`} /></div></details>
        </Panel>
      </div>

      <Panel className="px-4 py-3"><details><summary className="cursor-pointer font-medium">Dữ liệu lịch sử cố định · {historical.orders.toLocaleString()} đơn ({historical.period.from}–{historical.period.to})</summary><div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="First-attempt success" value={pct(historical.kpis.firstAttemptSuccess, 1)} sub={`Case target ${pct(historical.caseTargets.firstAttemptSuccess)}`} /><Stat label="Re-delivery rate" value={pct(historical.kpis.redeliveryRate, 1)} sub={`Case target ${pct(historical.caseTargets.redeliveryRate, 1)}`} /><Stat label="Evening vs morning" value={`${pct(historical.byWindow.find((w) => w.attempt_time === "evening")!.success)} vs ${pct(historical.byWindow.find((w) => w.attempt_time === "morning")!.success)}`} sub="tỷ lệ giao lần đầu" /><Stat label="Kết quả thực tế của ca này" value={shift.actualDatasetOutcome.attempts ? `${shift.actualDatasetOutcome.delivered} / ${shift.actualDatasetOutcome.attempts}` : "Chưa có kết quả thực tế"} sub={shift.actualDatasetOutcome.attempts ? "lượt giao thực tế trong dữ liệu" : "Ca nhập từ file không có outcome"} /></div></details></Panel>
      <div className="flex justify-end"><Button variant="outline" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>{showDetails ? "Ẩn chi tiết" : "Xem chi tiết"}</Button></div>
      {showDetails ? <Panel className="px-4 py-3"><div className="mb-3 text-sm font-semibold">Chỉ số và giải thích bổ sung</div><div className="grid gap-3 sm:grid-cols-3"><Stat label="Bắt đầu bằng Rules-based" value="Chỉ tạo bản nháp" sub="Không dispatch tự động" /><Stat label="Dữ liệu so sánh" value="Cùng ca, cùng đơn" sub="Xem mẫu số chi tiết trong bảng so sánh" /><Stat label="Model" value="Thử nghiệm" sub="Dự đoán Logistic Regression hiển thị riêng" /></div><p className="mt-3 text-xs text-ink-faint">{state.method === "baseline" ? "Baseline: sắp theo điểm gần nhất, không xét ghi chú/khung giờ." : state.method === "model" ? "Model dùng logistic regression cùng các ràng buộc; kết quả thử nghiệm không chứng minh AI tốt hơn." : "Rules-based: dùng lịch sử theo khung giờ, quy tắc địa điểm đã xác minh, buyer confirmation và giới hạn năng lực ca."} <Link href="/how-it-works" className="text-info underline">Mở giải thích đầy đủ</Link></p></Panel> : null}

      {openProposal || pendingCorrections.length ? (
        <div className="flex flex-wrap gap-3">
          {openProposal ? (
            <Link href="/replan" className="flex items-center gap-2 rounded-lg border border-brand/40 bg-brand-tint px-3 py-2 text-sm text-brand-ink">
              <TriangleAlert className="size-4" /> Plan change waiting: {openProposal.triggerText}
            </Link>
          ) : null}
          {pendingCorrections.length ? (
            <Link href="/stops" className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn-tint px-3 py-2 text-sm text-warn">
              <Info className="size-4" /> {pendingCorrections.length} stop-card correction(s) waiting for review
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel className="min-w-0">
                <PanelHeader
            title="Đơn giao hàng"
            note={
              shown
                ? `${shown.stops.length} assigned · ${pendingCount} pending · ${riskCount} at risk${transferred.length ? ` · ${transferred.length} moved to the backup rider` : ""}`
                : `${shift.stops.length} parcels loaded, in the order they were received`
            }
            actions={
              shown ? (
                <div className="flex items-center gap-2">
                  <MethodBadge method={shown.method} />
                  {draft ? <Badge tone="brand">Draft, not dispatched</Badge> : <Badge tone="ok">Dispatched</Badge>}
                </div>
              ) : null
            }
          />
          {shown ? (
            <>
              <div className="flex gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Filter deliveries">
                {(["all", "pending", "risk", "done"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-canvas font-medium text-ink" : "text-ink-soft hover:text-ink")}
                  >
                    {f === "all" ? "Tất cả" : f === "pending" ? "Đang giao" : f === "risk" ? `Cần chú ý (${riskCount})` : "Hoàn tất"}
                  </button>
                ))}
              </div>
              <div className="max-h-[760px] overflow-auto">
                <p className="px-3 py-1 text-xs text-ink-faint sm:hidden">Vuốt ngang bảng để xem đủ thông tin từng đơn.</p>
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-surface text-left text-xs text-ink-faint">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 font-normal">#</th>
                      <th className="px-3 py-2 font-normal">Parcel</th>
                      <th className="px-3 py-2 font-normal">Location</th>
                      <th className="px-3 py-2 font-normal">Payment</th>
                      <th className="px-3 py-2 font-normal">Block and ETA</th>
                      <th className="px-3 py-2 font-normal">Chance</th>
                      <th className="px-3 py-2 font-normal">Knowledge</th>
                      <th className="px-3 py-2 font-normal">Status</th>
                      <th className="px-3 py-2 font-normal">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((ps) => {
                      const st = stopById[ps.stopId];
                      const card = cards[st.locationKey];
                      const ss = states[ps.stopId];
                      const buyer = ss.buyer;
                      return (
                        <React.Fragment key={ps.stopId}>
                        <tr
                          key={ps.stopId}
                          className={cn("border-b border-line/70 align-top hover:bg-canvas/60", selected === ps.stopId && "bg-brand-tint/50")}
                          onClick={() => setSelected(ps.stopId)}
                        >
                          <td className="px-3 py-2.5 text-ink-faint">{ps.seq}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{ps.stopId}</div>
                            <div className="text-xs text-ink-faint">{st.buyer}</div>
                            {st.isReattempt ? <div className="text-xs text-warn">Re-attempt</div> : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              className="text-left font-medium text-info underline-offset-2 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenCardRow(openCardRow === ps.stopId ? null : ps.stopId);
                              }}
                            >
                              {card.name} · {openCardRow === ps.stopId ? "Ẩn Stop Card" : "Xem/Duyệt Stop Card"}
                            </button>
                            <div className="text-xs text-ink-faint">
                              {TYPE_LABEL[st.locationType]} · {st.parcel}
                              {!st.pin ? " · no map pin" : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">{st.payment === "cod" ? <Badge tone="warn">COD</Badge> : <span className="text-ink-soft">Prepaid</span>}</td>
                          <td className="px-3 py-2.5">
                            {Number.isNaN(ps.arriveMin) ? <span className="text-bad">Not scheduled</span> : <BlockTag block={ps.block} eta={ps.arriveMin} />}
                            {buyer.kind === "confirmed" || buyer.kind === "changed" ? <div className="text-xs text-ok">Buyer confirmed</div> : null}
                            {buyer.kind === "pickup" ? <div className="text-xs text-info">Pickup point</div> : null}
                            {buyer.kind === "invited" ? <div className="text-xs text-warn">Waiting for buyer</div> : null}
                            {buyer.kind === "no_response" ? <div className="text-xs text-ink-faint">No buyer reply</div> : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <ChanceText p={ps.p} />
                          </td>
                          <td className="px-3 py-2.5">
                            <CardStatusBadge status={card.status} />
                          </td>
                          <td className="px-3 py-2.5">
                            {ss.status === "pending" ? (
                              ps.flags.length ? (
                                <span className="text-xs text-bad" title={ps.flags.join("\n")}>
                                  {ps.flags[0]}
                                </span>
                              ) : (
                                <span className="text-xs text-ink-soft">Pending</span>
                              )
                            ) : (
                              <Badge tone={ss.status === "delivered" ? "ok" : "bad"}>{ss.status}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button size="sm" variant={openCardRow === ps.stopId ? "primary" : "outline"} onClick={(e) => { e.stopPropagation(); setOpenCardRow(openCardRow === ps.stopId ? null : ps.stopId); }}>
                              {openCardRow === ps.stopId ? "Đóng card" : "Xem/Duyệt Stop Card"}
                            </Button>
                            {ss.status === "pending" && !draft && plan ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTransferStop(ps.stopId);
                                }}
                                title="Move this parcel to the backup rider (explicit dispatcher action)"
                              >
                                <ArrowLeftRight /> Move
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                        {openCardRow === ps.stopId ? <tr><td colSpan={9} className="p-0"><InlineStopCardReview cardKey={st.locationKey} stopId={ps.stopId} /></td></tr> : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {shownRows.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">No deliveries match this filter.</p> : null}
              </div>
              {shown.warnings.length ? (
                <ul className="space-y-1 border-t border-line px-4 py-3 text-sm text-bad">
                  {shown.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No plan for this shift yet"
                action={
                  <Button variant="primary" onClick={() => update((s) => generatePlan(s, "rules"))}>
                    <Sparkles /> Tạo kế hoạch đề xuất
                  </Button>
                }
              >
                {shift.stops.length} parcels are loaded for {rider.label}. Generate a plan, compare the three methods, then dispatch one to the rider.
              </EmptyState>
              <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
                {shift.stops.map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-canvas">
                    <button className="text-left" onClick={() => setCardOpen({ key: s.locationKey, stopId: s.id })}>
                      <span className="font-medium">{s.id}</span> <span className="text-ink-soft">{cards[s.locationKey].name}</span>
                    </button>
                    <span className="text-xs text-ink-faint">
                      {TYPE_LABEL[s.locationType]} · {s.payment.toUpperCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Lịch trình ca giao" note="Mỗi dấu là một stop theo giờ đến mô phỏng" actions={<SourceTag kind="simulated" />} />
            <div className="px-4 py-3">
              {shown ? (
                <ShiftRibbon plan={shown} states={states} clockMin={plan ? state.clockMin[shift.id] : undefined} onSelect={setSelected} selected={selected} />
              ) : (
                <p className="text-sm text-ink-faint">Hiện sau khi tạo kế hoạch.</p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Sơ đồ tuyến" note="Chọn một điểm để làm nổi bật đơn tương ứng" />
            <div className="px-4 py-3">
              <RouteMap riderId={rider.id} plan={shown} states={states} selected={selected} onSelect={setSelected} />
            </div>
          </Panel>
          {selected && shown ? <SelectedStop ps={shown.stops.find((x) => x.stopId === selected)} onOpen={() => setCardOpen({ key: stopById[selected].locationKey, stopId: selected })} /> : null}
          {transferred.length ? (
            <Panel>
              <PanelHeader title={BACKUP_RIDER} note="Parcels moved here by the dispatcher" />
              <ul className="space-y-1 px-4 py-3 text-sm">
                {transferred.map((t) => (
                  <li key={t.stopId}>
                    <span className="font-medium">{t.stopId}</span> — {t.note} <span className="text-xs text-ink-faint">({new Date(t.at).toLocaleTimeString()})</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>

      <StopCardDialog cardKey={cardOpen?.key ?? null} stopId={cardOpen?.stopId} open={!!cardOpen} onOpenChange={(o) => !o && setCardOpen(null)} from="dispatcher list" />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} />
      <TransferDialog stopId={transferStop} riderName={rider.label} onClose={() => setTransferStop(null)} onConfirm={(note) => transferStop && update((s) => transferParcel(s, transferStop, note))} />
    </div>
  );
}

function SelectedStop({ ps, onOpen }: { ps?: PlannedStop; onOpen: () => void }) {
  if (!ps) return null;
  return (
    <Panel>
      <PanelHeader title={`Why ${ps.stopId} is planned here`} actions={<Button size="sm" onClick={onOpen}>Open stop card</Button>} />
      <div className="space-y-2 px-4 py-3 text-sm">
        <p>
          <BlockTag block={ps.block} eta={ps.arriveMin} /> · going to the <span className="font-medium">{ps.pointSource}</span>
        </p>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          {ps.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {ps.flags.length ? (
          <ul className="space-y-1 text-bad">
            {ps.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-ink-faint">
          Simulated: travel {Math.round(ps.travelMin)} min, entrance search {ps.searchMin} min, service {ps.serviceMin} min.
        </p>
      </div>
    </Panel>
  );
}

function CompareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, update } = useDemo();
  const plans = state.comparison ?? [];
  const meta = state.comparisonMeta;
  const best = plans.length ? Math.max(...plans.map((p) => p.totals.expectedSuccess)) : 0;
  const rows: { label: string; get: (p: Plan) => string; note?: string }[] = [
    { label: "Expected successful first attempts", get: (p) => p.totals.expectedSuccess.toFixed(1), note: "History-table estimate, same scorer for every method" },
    { label: "Stops with an estimate", get: (p) => `${p.totals.estimatedStops} / ${p.totals.stops}` },
    { label: "Estimated on-road minutes per parcel", get: (p) => onRoadMinutesPerParcel(p) === null ? `Not comparable: ${p.totals.stops - p.totals.scheduledStops} unscheduled / ${p.totals.stops} total` : `${onRoadMinutesPerParcel(p)!.toFixed(1)} min (${p.totals.stops} parcels)`, note: "Only shown when every pending parcel has a scheduled time" },
    { label: "Model prediction (experimental)", get: (p) => p.totals.modelExpectedSuccess === null ? "Not scored" : `${p.totals.modelExpectedSuccess.toFixed(1)} / ${p.totals.modelEstimatedStops} stops`, note: "Logistic regression prediction; not the common comparison score" },
    { label: "Stops in a block with under 65% chance", get: (p) => String(p.totals.lowChance), note: "e.g. schools and offices in the evening" },
    { label: "Distance (straight-line × 1.3)", get: (p) => `${p.totals.distanceKm.toFixed(1)} km` },
    { label: "Working time (travel + search + service)", get: (p) => `${Math.round(p.totals.onRoadMin)} min` },
    { label: "Estimated finish", get: (p) => fmt(p.totals.endMin) },
    { label: "Stops flagged for dispatcher", get: (p) => String(p.totals.flagged) },
    { label: "Buyer-confirmed windows kept", get: (p) => (p.totals.confirmedTotal ? `${p.totals.confirmedKept} / ${p.totals.confirmedTotal}` : "none confirmed") },
    { label: "Planner run time", get: (p) => `${p.computeMs} ms` },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Compare plans" description="Same parcels, same rider, same start. All figures are simulated estimates, not measured results." wide>
        {plans.length ? (
          <>
            {meta ? <div className="mb-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
              <div><b>Scenario:</b> {meta.scenarioId} · <b>Run:</b> {meta.runId}</div>
              <div><b>Sample:</b> {meta.totalStops} total stops · {meta.eligibleEstimatedStops} common eligible stops · <b>Source:</b> {meta.dataset}</div>
              <div><b>KPI method:</b> {meta.successMetric} <span className="font-medium">· SIMULATED</span></div>
              <div><b>Run time:</b> {new Date(meta.createdAt).toLocaleString()}</div>
            </div> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 pr-3 font-normal text-ink-faint">Measure</th>
                    {plans.map((p) => (
                      <th key={p.method} className="py-2 pr-3">
                        <MethodBadge method={p.method} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        {r.label}
                        {r.note ? <div className="text-xs text-ink-faint">{r.note}</div> : null}
                      </td>
                      {plans.map((p) => (
                        <td key={p.method} className={cn("py-2 pr-3 font-medium", r.label.startsWith("Expected") && p.totals.expectedSuccess === best && "text-ok")}>
                          {r.get(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="py-3 pr-3 text-ink-faint">Use as draft</td>
                    {plans.map((p) => (
                      <td key={p.method} className="py-3 pr-3">
                        <DialogClose asChild>
                          <Button size="sm" variant={p.method === "rules" ? "primary" : "outline"} onClick={() => update((s) => ({ ...s, method: p.method, draftPlan: p }))}>
                            Use {p.method === "model" ? "model" : p.method}
                          </Button>
                        </DialogClose>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-lg bg-canvas p-3 text-sm text-ink-soft">
              <p className="font-medium text-ink">How to read this</p>
              <p className="mt-1">
                The rules plan moves school and office stops out of the evening, where the dataset shows the weakest success, at the cost of more kilometres.
                The model plan uses the same constraints with a learned success model; on held-out October data it was not more accurate than the history table, so its
                small differences here are not evidence that AI is better. The pilot is designed to test that question.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-faint">Run Compare plans to see the three methods side by side.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ stopId, riderName, onClose, onConfirm }: { stopId: string | null; riderName: string; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = React.useState("Rider is over capacity in the evening block");
  return (
    <Dialog open={!!stopId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move ${stopId} to the backup rider?`} description={`The parcel is already loaded on ${riderName}. Moving it to ${BACKUP_RIDER} needs a physical handover, so it only happens when you confirm here.`}>
        <Label htmlFor="transfer-note">Reason (saved in the evidence log)</Label>
        <Textarea id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Keep with {riderName}</Button>
          <Button
            variant="primary"
            disabled={!note.trim()}
            onClick={() => {
              onConfirm(note.trim());
              onClose();
            }}
          >
            Move parcel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
