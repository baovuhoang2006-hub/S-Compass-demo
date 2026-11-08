import { describe, expect, it } from "vitest";
import { parseTable } from "../intake";
import { screenImport } from "../importRisk";

const HEAD = ["order_id", "rider_id", "delivery_date", "location_id", "location_type", "payment_type", "parcel_type", "address_latitude", "address_longitude", "buyer_address_processing_time_min", "attempt_no"];

function screen(rows: (string | number)[][]) {
  const r = parseTable([HEAD, ...rows], "t.csv", null, new Date("2026-11-08T00:00:00Z"));
  if (!r.ok) throw new Error(r.error);
  return screenImport(r.batch);
}

function order(i: number, over: Partial<Record<string, string | number>> = {}) {
  const base: Record<string, string | number> = {
    order_id: `ORD-${i}`, rider_id: "R-1", delivery_date: "2026-10-20", location_id: "SCH-01",
    location_type: "school", payment_type: "cod", parcel_type: "standard",
    address_latitude: 10.7801, address_longitude: 106.6952, buyer_address_processing_time_min: 10, attempt_no: 1,
  };
  return HEAD.map((h) => over[h] ?? base[h]);
}

describe("import risk screening", () => {
  it("passes a small clean file and allows import", () => {
    const sc = screen(Array.from({ length: 12 }, (_, i) => order(i)));
    expect(sc.status).toBe("ok");
    expect(sc.cases.every((c) => !c.triggered)).toBe(true);
  });

  it("blocks overload when one rider-day is far above the per-day limit", () => {
    const sc = screen(Array.from({ length: 100 }, (_, i) => order(i)));
    expect(sc.status).toBe("blocked");
    expect(sc.primary).toBe("overload");
    expect(sc.cases.find((c) => c.kind === "overload")?.triggered).toBe(true);
  });

  it("blocks AI uncertainty when most orders have no pin", () => {
    const sc = screen(Array.from({ length: 20 }, (_, i) => order(i, { address_latitude: "", address_longitude: "" })));
    expect(sc.status).toBe("blocked");
    expect(sc.cases.find((c) => c.kind === "ai")?.triggered).toBe(true);
  });

  it("blocks anomalous data when many rows are quarantined", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => order(i)),
      ...Array.from({ length: 10 }, (_, i) => order(100 + i, { delivery_date: "31/02/2026" })), // impossible date -> quarantined
    ];
    const sc = screen(rows);
    expect(sc.status).toBe("blocked");
    expect(sc.cases.find((c) => c.kind === "data")?.triggered).toBe(true);
  });

  it("gives a stable incident id and an ok reason", () => {
    const a = screen(Array.from({ length: 12 }, (_, i) => order(i)));
    expect(a.incidentId).toMatch(/^IMPORT-[0-9a-f]{8}$/);
    expect(a.okReason.length).toBeGreaterThan(0);
  });
});
