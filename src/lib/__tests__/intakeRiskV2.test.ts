import { describe, expect, it, vi } from "vitest";
import { activeImportBatch, commitImportedBatch, fixtures, setImported } from "../data";
import { cardsFor, generatePlan, initialState, selectShift } from "../demoState";
import { importUseReason } from "../importSafety";
import { MAX_COLUMNS, MAX_ROWS, MAX_SHEETS, MAX_UPLOAD_BYTES, parseCsv, parseTable, selectDeliverySheet, uploadProblem } from "../intake";
import { screenImport } from "../importRisk";
import { checkedPredict } from "../model";
import { modelInputFor } from "../planner";

const head = ["order_id", "rider_id", "delivery_date", "location_id", "location_type", "payment_type", "parcel_type", "address_latitude", "address_longitude", "buyer_address_processing_time_min", "attempt_no"];
const base = ["O-1", "R-1", "2026-10-21", "SCH-01", "school", "cod", "standard", 10.78, 106.69, 10, 1];
const row = (id: string, changes: Record<number, unknown> = {}) => base.map((x, i) => changes[i] ?? (i === 0 ? id : x));
const parse = (rows: unknown[][]) => parseTable([head, ...rows], "v2.csv", null, new Date("2026-11-10T00:00:00Z"));
const batch = (rows: unknown[][]) => { const result = parse(rows); if (!result.ok) throw Error(result.error); return result.batch; };
const issue = (rows: unknown[][], phrase: string) => expect(batch(rows).rows.some(r => r.issues.some(s => s.includes(phrase)))).toBe(true);

describe("Data Intake risk engine V2", () => {
  it("accepts a standard delivery file", () => expect(screenImport(batch([row("O-1")])).status).toBe("ok"));
  it("passes a low-anomaly file with explicit warnings and only eligible orders", () => {
    const b = batch([...Array.from({ length: 9 }, (_, i) => row(`O-${i}`)), row("O-9", { 9: -1 })]);
    expect(screenImport(b).status).toBe("warning");
    expect(b.shifts.flatMap(s => s.stops)).toHaveLength(10);
  });
  it("recognizes Vietnamese aliases", () => {
    const r = parseTable([["Mã đơn", "Mã shipper", "Ngày giao", "Loại địa điểm"], ["VN-1", "R-1", "21/10/2026", "trường học"]], "vi.csv");
    expect(r.ok).toBe(true);
  });
  it("rejects ambiguous delivery sheets and too many worksheets", () => {
    const sheet = { sheet: "A", data: [head, row("O-1")] };
    expect(() => selectDeliverySheet([sheet, { ...sheet, sheet: "B" }], "x.xlsx")).toThrow(/multiple worksheets/);
    expect(() => selectDeliverySheet(Array.from({ length: MAX_SHEETS + 1 }, (_, i) => ({ ...sheet, sheet: String(i) })), "x.xlsx")).toThrow(/System overload/);
    expect(selectDeliverySheet([{ sheet: "Notes", data: [["hello"]] }, sheet], "x.xlsx").sheet).toBe("A");
  });
  it("rejects a non-delivery table", () => expect(parseTable([["foo"], ["bar"]], "x.csv").ok).toBe(false));
  it("names missing required columns", () => {
    const r = parseTable([["order_id"], ["O-1"]], "x.csv");
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/rider_id.*delivery_date.*location_type/);
  });
  it("preserves first valid order, quarantines same-day copy and allows later reattempt", () => {
    const b = batch([row("O-1"), row("O-1"), row("O-1", { 2: "2026-10-22" })]);
    expect(b.summary.quarantined).toBe(1);
    expect(b.shifts.flatMap(s => s.stops).length).toBe(2);
    expect(b.shifts[1].stops[0].isReattempt).toBe(true);
  });
  it("rejects impossible and ambiguous dates", () => {
    const b = batch([row("bad", { 2: "31/02/2026" }), row("amb", { 2: "10/11/2026" }), row("ok", { 2: "21/10/2026" })]);
    expect(b.summary.quarantined).toBe(2);
  });
  it("blocks batches over 10,000 rows with no partial import", () => {
    const b = batch(Array.from({ length: MAX_ROWS + 1 }, (_, i) => row(`O-${i}`)));
    expect(b.summary.notProcessed).toBe(1);
    expect(screenImport(b).cases.find(c => c.kind === "overload")?.triggered).toBe(true);
  });
  it("blocks 100 parcels in one rider-day", () => expect(screenImport(batch(Array.from({ length: 100 }, (_, i) => row(`O-${i}`)))).primary).toBe("overload"));
  it("blocks a majority of missing pins before inference", () => {
    const sc = screenImport(batch(Array.from({ length: 10 }, (_, i) => row(`O-${i}`, i < 6 ? { 7: "", 8: "" } : {}))));
    expect(sc.cases.find(c => c.kind === "ai")?.triggered).toBe(true);
    expect(sc.cases.find(c => c.kind === "ai")?.detail).toMatch(/not a prediction/);
  });
  it("records all simultaneous overload, AI and data cases", () => {
    const rows = [...Array.from({ length: 100 }, (_, i) => row(`V-${i}`, i < 60 ? { 7: "", 8: "" } : {})), ...Array.from({ length: 50 }, (_, i) => row(`B-${i}`, { 2: "31/02/2026" }))];
    expect(screenImport(batch(rows)).cases.map(c => c.triggered)).toEqual([true, true, true]);
  });
  it("quarantines Excel numeric and scientific-notation IDs", () => {
    const b = batch([row("x", { 0: 12345 }), row("1.23E+10")]);
    expect(b.summary.quarantined).toBe(2);
    expect(b.shifts.flatMap(s => s.stops)).toHaveLength(0);
  });
  it("rejects empty, corrupted CSV and unsupported formats", () => {
    expect(parseTable([], "empty.csv").ok).toBe(false);
    expect(() => parseCsv('order_id\n"unfinished')).toThrow(/unterminated/);
    expect(uploadProblem("x.xlsx", 0)).toMatch(/file is empty/);
    expect(uploadProblem("x.pdf", 123)).toMatch(/only CSV/);
  });
  it("locks an imported batch used by a draft plan", () => {
    const b = batch([row("O-1")]); setImported(b);
    try { const state = selectShift(initialState(), b.shifts[0].id); expect(importUseReason(state, b)).toBeNull(); expect(importUseReason(generatePlan(state, "rules"), b)).toMatch(/blocked/); }
    finally { setImported(null); }
  });
  it("preserves the accepted dataset when browser storage fails on replace or remove", () => {
    const old = batch([row("OLD")]), next = batch([row("NEW")]);
    setImported(old);
    vi.stubGlobal("localStorage", { setItem: () => { throw Error("quota"); }, removeItem: () => { throw Error("quota"); } });
    try {
      expect(commitImportedBatch(next)).toMatch(/could not be saved/);
      expect(activeImportBatch()).toBe(old);
      expect(commitImportedBatch(null)).toMatch(/could not be saved/);
      expect(activeImportBatch()).toBe(old);
    } finally { vi.unstubAllGlobals(); setImported(null); }
  });
  it("rejects invalid AI output and missing inference features", () => {
    const shift = fixtures.shifts[0], state = selectShift(initialState(), shift.id), stop = shift.stops[0];
    const x = modelInputFor(stop, shift, cardsFor(state)[stop.locationKey], "morning");
    for (const fault of ["nan", "infinity", "above_one", "missing_feature"] as const) expect(checkedPredict(x, fault).p).toBeNull();
  });
  it("quarantines missing order ID and rider ID", () => expect(batch([row("", { 1: "" })]).summary.quarantined).toBe(1));
  it("quarantines unknown payment and parcel type", () => { issue([row("O-1", { 5: "crypto", 6: "mystery" })], "Unknown payment"); expect(batch([row("O-1", { 5: "crypto", 6: "mystery" })]).summary.quarantined).toBe(1); });
  it("quarantines invalid attempt, status and receiving window", () => {
    const r = parseTable([[...head, "delivery_status", "attempt_time"], [...row("O-1", { 10: -1 }), "unknown", "overnight"]], "x.csv");
    expect(r.ok && r.batch.rows[0].issues.join(" ")).toMatch(/attempt number.*delivery status.*receiving window/);
  });
  it("does not invent a missing actual outcome or silently accept invalid reattempt flags", () => {
    const r = parseTable([[...head, "delivery_status", "is_reattempt"], [...row("O-1"), "", ""], [...row("O-2"), "", "maybe"]], "x.csv");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.batch.summary.quarantined).toBe(1); expect(r.batch.shifts[0].actualDatasetOutcome.attempts).toBe(0); }
  });
  it("quarantines conflicting Stop Card place types", () => expect(batch([row("O-1"), row("O-2", { 4: "office" })]).summary.quarantined).toBe(2));
  it("rejects duplicate headers, extra data columns and excessive dimensions", () => {
    expect(parseTable([[...head, "order_id"], [...row("O-1"), "O-2"]], "x.csv").ok).toBe(false);
    expect(parseTable([head, [...row("O-1"), "surprise"]], "x.csv").ok).toBe(false);
    expect(parseTable([Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`)], "x.csv").ok).toBe(false);
    expect(uploadProblem("x.xlsx", MAX_UPLOAD_BYTES + 1)).toMatch(/System overload/);
  });
});
