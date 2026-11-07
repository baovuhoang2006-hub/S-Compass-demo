import { describe, expect, it } from "vitest";
import { fixtures, setImported, shiftById } from "../data";
import { dispatchPlan, generatePlan, initialState, planFor, selectShift } from "../demoState";
import { messySampleRows, parseCsv, parseDate, parseTable, templateRows, toCsvText } from "../intake";

describe("data intake", () => {
  const res = parseTable(messySampleRows(), "practice.csv", null, new Date("2026-11-07T00:00:00Z"));
  if (!res.ok) throw new Error(res.error);
  const b = res.batch;
  const byOrder = (id: string) => b.rows.find((r) => r.orderId === id);

  it("counts every row and drops none", () => {
    expect(b.summary.rowsRead).toBe(24 + 44 + 11);
    expect(b.summary.accepted + b.summary.warning + b.summary.quarantined).toBe(b.summary.rowsRead);
  });

  it("quarantines unknown type, impossible date, duplicate, no rider and empty rows", () => {
    for (const id of ["ORD-0903", "ORD-0906", "ORD-0907", "ORD-0910"]) expect(byOrder(id)?.status).toBe("quarantined");
    expect(b.rows.some((r) => r.orderId === "ORD-0001" && r.issues.some((x) => x.startsWith("Duplicate")))).toBe(true);
    expect(b.summary.quarantined).toBe(5);
  });

  it("keeps fixable rows with a warning", () => {
    expect(byOrder("ORD-0901")?.issues.join()).toMatch(/No map pin/);
    expect(byOrder("ORD-0902")?.issues.join()).toMatch(/treated as COD/);
    expect(byOrder("ORD-0904")?.issues.join()).toMatch(/outside Ho Chi Minh City/);
    expect(byOrder("ORD-0905")?.issues.join()).toMatch(/swapped/);
    expect(byOrder("ORD-0908")?.issues.join()).toMatch(/impossible/);
    expect(byOrder("ORD-0909")?.issues.join()).toMatch(/m from the other pins/);
    for (const id of ["ORD-0901", "ORD-0902", "ORD-0904", "ORD-0905", "ORD-0908", "ORD-0909"]) expect(byOrder(id)?.status).toBe("warning");
  });

  it("builds rider-days and flags the heavy day", () => {
    expect(b.summary.riderDays).toBe(2);
    const heavy = b.shiftInfo.find((x) => x.heavy)!;
    expect(heavy.parcels).toBe(44);
    expect(b.shifts.every((s) => s.weekday === "Wednesday" && !s.isWeekend)).toBe(true);
  });

  it("plans imported rider-days with the same planner, then removes them cleanly", () => {
    const before = fixtures.shifts.length;
    setImported(b);
    let st = selectShift(initialState(), b.shifts[0].id);
    for (const m of ["baseline", "rules", "model"] as const) {
      const p = planFor(st, m);
      expect(p.stops.length).toBe(shiftById(b.shifts[0].id).stops.length);
      expect(p.totals.expectedSuccess).toBeGreaterThan(0);
    }
    st = generatePlan(st, "rules");
    st = dispatchPlan(st, st.draftPlan!);
    expect(st.currentPlan[b.shifts[0].id]).not.toBeNull();
    const heavy = b.shiftInfo.find((x) => x.heavy)!;
    const hp = planFor(selectShift(st, heavy.shiftId), "rules");
    expect(hp.stops.length).toBe(44);
    setImported(null);
    expect(fixtures.shifts.length).toBe(before);
  });

  it("reads dates, CSV and the template", () => {
    expect(parseDate("21/10/2026")).toBe("2026-10-21");
    expect(parseDate("2026-10-21 08:30")).toBe("2026-10-21");
    expect(parseDate(46316)).toBe("2026-10-21");
    expect(parseDate("31/02/2026")).toBeNull();
    const csv = parseCsv(toCsvText(templateRows()));
    const t = parseTable(csv, "template.csv");
    expect(t.ok && t.batch.summary.quarantined).toBe(0);
    const semi = parseCsv("delivery_date;location_type\n2026-10-21;school\n");
    expect(semi[1]).toEqual(["2026-10-21", "school"]);
  });

  it("refuses a file without the needed columns and says which", () => {
    const r = parseTable([["foo", "bar"], [1, 2]], "x.csv");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/order_id.*rider_id.*delivery_date.*location_type/);
  });

  it("recognises the case dataset column names", () => {
    const r = parseTable(
      [
        ["order_id", "rider_id", "location_id", "location_type", "delivery_date", "attempt_time", "delivery_status", "payment_type", "parcel_type", "address_latitude", "address_longitude", "buyer_address_processing_time_min"],
        ["O1", "R01", "L1", "office", new Date("2026-10-02T00:00:00Z"), "morning", "delivered", "cod", "standard", 10.77, 106.7, 10],
        ["O1", "R01", "L1", "office", new Date("2026-10-03T00:00:00Z"), "evening", "failed", "cod", "standard", 10.77, 106.7, 10],
      ],
      "case.xlsx",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.batch.summary.quarantined).toBe(0);
      expect(r.batch.shifts[1].stops[0].isReattempt).toBe(true);
      expect(r.batch.shifts[0].actualDatasetOutcome.delivered).toBe(1);
    }
  });
});
