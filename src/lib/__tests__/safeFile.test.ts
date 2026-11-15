import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import readXlsxFile from "read-excel-file/node";
import { parseTable, selectDeliverySheet, TEMPLATE_COLUMNS } from "../intake";
import { screenImport } from "../importRisk";
import { buildSafeFile, safeTable, SAFE_DAY_PARCELS } from "../safeFile";
import { buildSafeWorkbook } from "../safeWorkbook";

const PLACES: [string, string, number, number][] = [
  ["SCH-01", "school", 10.7801, 106.6952], ["OFF-01", "office", 10.7769, 106.7009],
  ["IND-01", "industrial", 10.8012, 106.7203], ["GAT-01", "gated_facility", 10.7885, 106.7102],
];

type Opts = { riders?: number; parcels?: number; repeat?: number; nopin?: number; broken?: number; swap?: number; badpay?: number };
function file(o: Opts): unknown[][] {
  const { riders = 3, parcels = 30, repeat = 0, nopin = 0, broken = 0, swap = 0, badpay = 0 } = o;
  const rows: unknown[][] = [[...TEMPLATE_COLUMNS]];
  let n = 0;
  for (let r = 1; r <= riders; r++) for (let i = 0; i < parcels; i++) {
    const p = PLACES[n % PLACES.length];
    n += 1;
    rows.push([`T-${String(n).padStart(5, "0")}`, `R${String(r).padStart(2, "0")}`, "2026-11-16", p[0], p[1], n % 2 ? "cod" : "prepaid", "standard", p[2] + (n % 7) * 0.00005, p[3], 10, 1]);
  }
  const N = rows.length - 1;
  let at = 1;
  const take = (share: number) => { const k = Math.round(N * share); const out = Array.from({ length: k }, (_, j) => at + j); at += k; return out; };
  for (const i of take(nopin)) { rows[i][7] = ""; rows[i][8] = ""; }
  for (const i of take(repeat)) rows[i][10] = 2;
  take(broken).forEach((i, j) => { if (j % 3 === 0) rows[i][4] = "spaceship"; else if (j % 3 === 1) rows[i][2] = "2026-02-31"; else rows[i][0] = rows[N][0]; });
  for (const i of take(swap)) { const t = rows[i][7]; rows[i][7] = rows[i][8]; rows[i][8] = t; }
  for (const i of take(badpay)) rows[i][5] = "Tien mat";
  return rows;
}

function screenOf(rows: unknown[][]) {
  const res = parseTable(rows, "x.csv", null);
  if (!res.ok) throw new Error(res.error);
  return screenImport(res.batch);
}

const CASES: [string, Opts, string][] = [
  ["overload: one rider with 150", { riders: 1, parcels: 150 }, "overload"],
  ["overload: 11.11, 6 riders x 800", { riders: 6, parcels: 800 }, "overload"],
  ["AI: 60% repeat attempts", { repeat: 0.6 }, "ai"],
  ["AI: 30% no pin + 30% repeats", { nopin: 0.3, repeat: 0.3 }, "ai"],
  ["data: 40% broken rows", { broken: 0.4 }, "data"],
  ["combo: overload + AI + data", { riders: 4, parcels: 60, repeat: 0.3, nopin: 0.25, broken: 0.3 }, "ai"],
];

describe("safe file", () => {
  for (const [name, opts, kind] of CASES) {
    it(`${name}: original is blocked, safe file passes, and no order is lost`, () => {
      const rows = file(opts);
      expect(screenOf(rows).status).toBe("blocked");
      expect(screenOf(rows).cases.find((c) => c.kind === kind)?.triggered).toBe(true);
      const r = buildSafeFile(rows, "risky.xlsx");
      if (!r.ok) throw new Error(r.reason);
      expect(r.before.blocked).toBe(true);
      expect(r.after.blocked).toBe(false);
      expect(screenOf(safeTable(r.safe)).status).not.toBe("blocked");
      expect(r.safe.length + r.actions.length).toBe(rows.length - 1);
      expect(r.after.maxDay).toBeLessThanOrEqual(SAFE_DAY_PARCELS);
      expect(r.solved.some((x) => x.kind === kind)).toBe(true);
    });
  }

  it("fixes certain errors in place and marks them, without inventing pins", () => {
    const rows = file({ swap: 0.2, badpay: 0.2, nopin: 0.1 });
    const r = buildSafeFile(rows, "fixable.csv");
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixedCount).toBeGreaterThanOrEqual(36);
    const swapped = r.safe.find((x) => x.note.includes("swapped"))!;
    expect(swapped.values[7]).toBeGreaterThan(10);
    expect(swapped.values[7]).toBeLessThan(11.2);
    expect(r.safe.find((x) => x.note.includes("Tien mat"))!.values[5]).toBe("cod");
    expect(r.safe.filter((x) => x.values[7] === null).length).toBe(9); // missing pins stay missing
  });

  it("a structurally broken file is reported, not repaired", () => {
    const rows = file({}).map((r) => r.filter((_, i) => i !== 1)); // no rider column
    const r = buildSafeFile(rows, "norider.csv");
    expect(r.ok).toBe(false);
  });

  it("the 3-sheet Excel round-trips: the app picks the safe sheet and it passes screening", async () => {
    const r = buildSafeFile(file({ riders: 6, parcels: 800, repeat: 0.2, broken: 0.1 }), "peak.xlsx");
    if (!r.ok) throw new Error(r.reason);
    const sheets = buildSafeWorkbook(r, "2026-11-15 15:30");
    expect(sheets.map((s) => s.sheet)).toEqual(["1. Summary", "2. Safe orders", "3. Action list"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await (writeXlsxFile as any)(sheets).toBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const read: any = await (readXlsxFile as any)(buf);
    const picked = selectDeliverySheet(read, r.safeName);
    expect(picked.sheet).toBe("2. Safe orders");
    expect(screenOf(picked.rows).status).not.toBe("blocked");
    expect(screenOf(picked.rows).cases.every((c) => !c.triggered)).toBe(true);
  });
});
