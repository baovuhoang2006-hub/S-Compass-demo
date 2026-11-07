// Data intake: turn an outside Excel/CSV table into checked S-Compass rider-days.
// Pure functions only (no browser APIs), so the checks are unit-tested.
// Rule: nothing is dropped silently. Every row ends as accepted, accepted with a warning, or quarantined.

import type { Block, KnowledgeRecord, LocationType, Parcel, Payment, Point, Rider, Shift, FixtureStop } from "./types";

export type RowStatus = "accepted" | "warning" | "quarantined";

export interface RowResult {
  row: number; // row number in the file (1 = header row)
  orderId: string;
  riderId: string;
  date: string;
  status: RowStatus;
  issues: string[];
}

export interface ImportedShiftInfo {
  shiftId: string;
  riderLabel: string;
  date: string;
  weekday: string;
  parcels: number;
  heavy: boolean;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  sheet: string | null;
  columns: Record<string, string>; // field -> column title found in the file
  riders: Rider[];
  shifts: Shift[];
  knowledge: KnowledgeRecord[];
  shiftInfo: ImportedShiftInfo[];
  rows: RowResult[]; // only rows with issues are kept, to keep storage small
  summary: {
    rowsRead: number;
    accepted: number;
    warning: number;
    quarantined: number;
    notProcessed: number;
    riderDays: number;
    heavyDays: number;
    places: number;
    newPlaceTypes: number;
  };
  fileNotes: string[];
}

export type IntakeResult = { ok: true; batch: ImportBatch } | { ok: false; error: string; foundColumns: string[] };

export const MAX_ROWS = 10000;
export const HEAVY_DAY_PARCELS = 40;
export const FAR_PIN_METERS = 300;
// Broad box around Ho Chi Minh City (incl. Thu Duc, Binh Chanh, Cu Chi, Nha Be).
const HCMC = { latMin: 10.3, latMax: 11.2, lonMin: 106.3, lonMax: 107.1 };

type Field =
  | "order_id"
  | "rider_id"
  | "date"
  | "location_type"
  | "location_id"
  | "location_name"
  | "payment"
  | "parcel"
  | "lat"
  | "lon"
  | "service_min"
  | "attempt_no"
  | "is_reattempt"
  | "status"
  | "window";

// Column names from the Shopee case dataset come first, then common alternatives (English and Vietnamese).
const ALIASES: Record<Field, string[]> = {
  order_id: ["order_id", "order", "orderid", "order_no", "order_code", "ma_don", "ma_don_hang", "parcel_id", "tracking_id"],
  rider_id: ["rider_id", "rider", "shipper", "shipper_id", "driver_id", "driver", "ma_shipper", "tai_xe"],
  date: ["delivery_date", "date", "attempt_date", "ngay", "ngay_giao", "shift_date", "day"],
  location_type: ["location_type", "place_type", "type", "site_type", "loai_dia_diem", "address_type"],
  location_id: ["location_id", "place_id", "site_id", "ma_dia_diem", "building_id"],
  location_name: ["location_name", "place_name", "site_name", "place", "location", "ten_dia_diem", "building"],
  payment: ["payment_type", "payment", "payment_method", "thanh_toan", "hinh_thuc_thanh_toan"],
  parcel: ["parcel_type", "parcel", "package_type", "loai_hang"],
  lat: ["address_latitude", "latitude", "lat", "vi_do"],
  lon: ["address_longitude", "longitude", "lon", "lng", "long", "kinh_do"],
  service_min: ["buyer_address_processing_time_min", "service_minutes", "service_min", "processing_time_min", "handover_minutes"],
  attempt_no: ["attempt_no", "attempt_number", "attempt", "lan_giao"],
  is_reattempt: ["is_reattempt", "reattempt", "retry", "giao_lai"],
  status: ["delivery_status", "status", "outcome", "trang_thai"],
  window: ["attempt_time", "time_block", "window", "khung_gio"],
};

export const TEMPLATE_COLUMNS = [
  "order_id",
  "rider_id",
  "delivery_date",
  "location_id",
  "location_type",
  "payment_type",
  "parcel_type",
  "address_latitude",
  "address_longitude",
  "buyer_address_processing_time_min",
  "attempt_no",
];

export function normHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapColumns(header: unknown[]): Partial<Record<Field, number>> {
  const norm = header.map(normHeader);
  const out: Partial<Record<Field, number>> = {};
  for (const f of Object.keys(ALIASES) as Field[]) {
    for (const a of ALIASES[f]) {
      const i = norm.indexOf(a);
      if (i >= 0 && !Object.values(out).includes(i)) {
        out[f] = i;
        break;
      }
    }
  }
  return out;
}

/** Find the header row: the row (among the first 10) that matches the most known columns. */
export function findHeader(rows: unknown[][]): { index: number; map: Partial<Record<Field, number>> } {
  let best = { index: 0, map: {} as Partial<Record<Field, number>>, score: -1 };
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const map = mapColumns(rows[i] ?? []);
    const score = Object.keys(map).length;
    if (score > best.score) best = { index: i, map, score };
  }
  return { index: best.index, map: best.map };
}

// ------------------------------------------------------------------ value parsing
const str = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim());

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Returns yyyy-mm-dd or null. Accepts Date objects, Excel serial numbers and common text formats. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number" && v > 20000 && v < 80000) d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  else {
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) d = mk(+m[1], +m[2], +m[3]);
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) d = mk(+m[3], +m[2], +m[1]); // dd/mm/yyyy (Vietnam)
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2020 || y > 2030) return null;
  return `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function mk(y: number, mo: number, da: number): Date | null {
  const d = new Date(Date.UTC(y, mo - 1, da));
  // Reject impossible dates such as 31/02 (JavaScript would roll them over).
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return d;
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const TYPE_MAP: Record<string, LocationType> = {
  school: "school", schools: "school", truong: "school", truong_hoc: "school", university: "school", college: "school", kindergarten: "school",
  office: "office", offices: "office", van_phong: "office", office_building: "office",
  industrial: "industrial", industrial_park: "industrial", factory: "industrial", khu_cong_nghiep: "industrial", nha_may: "industrial", kcn: "industrial", warehouse: "industrial",
  gated_facility: "gated_facility", gated: "gated_facility", gated_site: "gated_facility", gated_community: "gated_facility", facility: "gated_facility", khu_dan_cu: "gated_facility",
};

const PAY_MAP: Record<string, Payment> = {
  cod: "cod", cash: "cod", cash_on_delivery: "cod", tien_mat: "cod", thu_ho: "cod",
  prepaid: "prepaid", paid: "prepaid", online: "prepaid", card: "prepaid", ewallet: "prepaid", e_wallet: "prepaid", non_cod: "prepaid", shopeepay: "prepaid", da_thanh_toan: "prepaid",
};

const PARCEL_MAP: Record<string, Parcel> = {
  standard: "standard", normal: "standard", bulky: "bulky", large: "bulky", fragile: "fragile", documents: "documents", document: "documents", doc: "documents",
};

const BLOCK_MAP: Record<string, Block> = { morning: "morning", afternoon: "afternoon", evening: "evening", sang: "morning", chieu: "afternoon", toi: "evening" };

const DELIVERED = new Set(["delivered", "success", "successful", "ok", "thanh_cong", "da_giao", "completed", "1", "true", "yes"]);

function slug(s: string) {
  return normHeader(s).slice(0, 40) || "x";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function median(xs: number[]) {
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ------------------------------------------------------------------ main
interface Draft {
  row: number;
  orderId: string;
  riderId: string;
  date: string | null;
  type: LocationType | null;
  placeKey: string;
  placeName: string;
  payment: Payment;
  parcel: Parcel;
  latlon: [number, number] | null;
  serviceMin: number | null;
  attemptNo: number | null;
  reattemptFlag: boolean | null;
  delivered: boolean | null;
  window: Block | null;
  result: RowResult;
}

export function parseTable(rows: unknown[][], fileName: string, sheet: string | null = null, now = new Date()): IntakeResult {
  const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => str(c) !== ""));
  if (nonEmpty.length === 0) return { ok: false, error: "The file is empty.", foundColumns: [] };
  const { index, map } = findHeader(nonEmpty);
  const header = nonEmpty[index] ?? [];
  const foundColumns = header.map(str).filter(Boolean);
  const missing: string[] = [];
  if (map.date === undefined) missing.push("delivery_date");
  if (map.location_type === undefined) missing.push("location_type");
  if (missing.length)
    return {
      ok: false,
      error: `Required column not found: ${missing.join(", ")}. Use the template, or rename the column in the file.`,
      foundColumns,
    };

  const fileNotes: string[] = [];
  const body = nonEmpty.slice(index + 1);
  const notProcessed = Math.max(0, body.length - MAX_ROWS);
  if (notProcessed) fileNotes.push(`The file has ${body.length.toLocaleString()} data rows. One batch takes up to ${MAX_ROWS.toLocaleString()}; the last ${notProcessed.toLocaleString()} rows were not processed. Split the file and import the rest separately.`);
  if (map.order_id === undefined) fileNotes.push("No order ID column: each row was given a row-number ID.");
  if (map.rider_id === undefined) fileNotes.push("No rider column: all orders were put on one imported rider per day.");
  if (map.lat === undefined || map.lon === undefined) fileNotes.push("No latitude/longitude columns: every order is treated as having no map pin.");
  if (map.payment === undefined) fileNotes.push("No payment column: every order is treated as COD (the safer, riskier case).");

  const cell = (r: unknown[], f: Field) => (map[f] === undefined ? undefined : r[map[f]!]);
  const columns: Record<string, string> = {};
  for (const [f, i] of Object.entries(map)) columns[f] = str(header[i!]);

  const drafts: Draft[] = [];
  body.slice(0, MAX_ROWS).forEach((r, k) => {
    const rowNo = index + 2 + k; // 1-based, header = index+1
    const issues: string[] = [];
    let quarantine = false;

    const orderId = str(cell(r, "order_id")) || `row-${rowNo}`;
    let riderId = map.rider_id === undefined ? "IMPORTED" : str(cell(r, "rider_id"));
    if (!riderId) {
      quarantine = true;
      issues.push("No rider: the dispatcher must assign one");
      riderId = "(none)";
    }

    const rawDate = cell(r, "date");
    const date = parseDate(rawDate);
    if (!date) {
      quarantine = true;
      issues.push(str(rawDate) ? `Impossible or unreadable date “${str(rawDate)}”` : "No delivery date");
    }

    const rawType = str(cell(r, "location_type"));
    const type = TYPE_MAP[normHeader(rawType)] ?? null;
    if (!type) {
      quarantine = true;
      issues.push(rawType ? `Unknown place type “${rawType}”: no history to score it, so a dispatcher must classify it` : "No place type");
    }

    const rawPay = str(cell(r, "payment"));
    let payment: Payment = PAY_MAP[normHeader(rawPay)] ?? "cod";
    if (map.payment !== undefined && !rawPay) issues.push("Payment missing: treated as COD (safer)");
    else if (rawPay && !PAY_MAP[normHeader(rawPay)]) issues.push(`Unknown payment “${rawPay}”: treated as COD (safer)`);
    if (map.payment === undefined) payment = "cod";

    const rawParcel = str(cell(r, "parcel"));
    const parcel: Parcel = PARCEL_MAP[normHeader(rawParcel)] ?? "standard";
    if (rawParcel && !PARCEL_MAP[normHeader(rawParcel)]) issues.push(`Unknown parcel type “${rawParcel}”: treated as standard`);

    let latlon: [number, number] | null = null;
    const la = parseNum(cell(r, "lat"));
    const lo = parseNum(cell(r, "lon"));
    const inBox = (a: number, b: number) => a >= HCMC.latMin && a <= HCMC.latMax && b >= HCMC.lonMin && b <= HCMC.lonMax;
    if (la === null && lo === null) {
      if (map.lat !== undefined) issues.push("No map pin: uses the place’s drop-off point if known, and asks the buyer");
    } else if (la === null || lo === null) {
      issues.push("Half a map pin (only latitude or longitude): pin ignored, buyer will be asked");
    } else if (inBox(la, lo)) latlon = [la, lo];
    else if (inBox(lo, la)) {
      latlon = [lo, la];
      issues.push("Latitude and longitude were swapped: corrected automatically");
    } else issues.push(`Pin outside Ho Chi Minh City (${la}, ${lo}): ignored as anomalous, buyer will be asked`);

    let serviceMin = parseNum(cell(r, "service_min"));
    if (serviceMin !== null && (serviceMin < 0 || serviceMin > 120)) {
      issues.push(`Handover time ${serviceMin} min is impossible: ignored, the planner uses its default`);
      serviceMin = null;
    }

    const attemptNo = parseNum(cell(r, "attempt_no"));
    const rf = str(cell(r, "is_reattempt"));
    const reattemptFlag = rf ? DELIVERED.has(normHeader(rf)) : null;
    const st = str(cell(r, "status"));
    const delivered = map.status === undefined ? null : DELIVERED.has(normHeader(st));
    const window = BLOCK_MAP[normHeader(str(cell(r, "window")))] ?? null;

    const placeId = str(cell(r, "location_id"));
    const placeName = str(cell(r, "location_name"));
    let placeKey: string;
    if (placeId || placeName) placeKey = slug(placeId || placeName);
    else if (latlon) placeKey = `pin-${latlon[0].toFixed(4)}-${latlon[1].toFixed(4)}`; // ~10 m grid
    else {
      placeKey = `row-${rowNo}`;
      issues.push("No place ID, name or pin: treated as a new place");
    }

    const result: RowResult = { row: rowNo, orderId, riderId, date: date ?? str(rawDate), status: quarantine ? "quarantined" : issues.length ? "warning" : "accepted", issues };
    drafts.push({ row: rowNo, orderId, riderId, date, type, placeKey, placeName: placeName || placeId, payment, parcel, latlon, serviceMin, attemptNo, reattemptFlag, delivered, window, result });
  });

  // Duplicate order on the same day → quarantine the later copy. Same order on an earlier day → this is a re-attempt.
  const firstSeen = new Map<string, Draft>();
  const earliestDate = new Map<string, string>();
  for (const d of drafts) {
    if (d.result.status === "quarantined" || !d.date) continue;
    const k = `${d.orderId}|${d.date}`;
    const prev = firstSeen.get(k);
    if (prev && !d.orderId.startsWith("row-")) {
      d.result.status = "quarantined";
      d.result.issues.push(`Duplicate: same order on the same day as row ${prev.row}`);
      continue;
    }
    firstSeen.set(k, d);
    const e = earliestDate.get(d.orderId);
    if (!e || d.date < e) earliestDate.set(d.orderId, d.date);
  }

  const good = drafts.filter((d) => d.result.status !== "quarantined") as (Draft & { date: string; type: LocationType })[];

  // Local metre projection around the median pin of the batch (no rotation needed: this is the user's own file).
  const pins = good.flatMap((d) => (d.latlon ? [d.latlon] : []));
  const lat0 = pins.length ? median(pins.map((p) => p[0])) : 10.78;
  const lon0 = pins.length ? median(pins.map((p) => p[1])) : 106.7;
  const proj = (ll: [number, number]): Point => [
    Math.round((ll[1] - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180) * 10) / 10,
    Math.round((ll[0] - lat0) * 110540 * 10) / 10,
  ];

  // Places → knowledge records (new sites: no history, so cards start unverified and use the place-type average).
  const byPlace = new Map<string, (typeof good)[number][]>();
  for (const d of good) byPlace.set(d.placeKey, [...(byPlace.get(d.placeKey) ?? []), d]);
  const knowledge: KnowledgeRecord[] = [];
  const placeEntrance = new Map<string, Point | null>();
  const dateLabel = now.toISOString().slice(0, 10);
  for (const [pk, list] of byPlace) {
    const pts = list.flatMap((d) => (d.latlon ? [proj(d.latlon)] : []));
    let centre: Point | null = null;
    let spread: number | null = null;
    if (pts.length >= 2) {
      centre = [median(pts.map((p) => p[0])), median(pts.map((p) => p[1]))];
      spread = Math.round(median(pts.map((p) => dist(p, centre!))));
      for (const d of list) {
        if (!d.latlon) continue;
        const gap = Math.round(dist(proj(d.latlon), centre));
        if (gap > FAR_PIN_METERS) {
          d.result.issues.push(`Pin is ${gap} m from the other pins of this place: the place’s suggested drop-off point is used first`);
          if (d.result.status === "accepted") d.result.status = "warning";
        }
      }
    }
    placeEntrance.set(pk, centre);
    const types = [...new Set(list.map((d) => d.type))];
    const svc = list.flatMap((d) => (d.serviceMin === null ? [] : [d.serviceMin]));
    const name = list[0].placeName ? `${list[0].placeName}` : `Imported place ${knowledge.length + 1}`;
    knowledge.push({
      key: `imp-${pk}`,
      zone: "",
      name,
      type: types[0],
      visits: list.length,
      firstAttemptSuccess: null,
      entranceCandidate: centre,
      pinSpreadMeters: spread,
      pinMissingShare: Math.round((1 - pts.length / list.length) * 100) / 100,
      serviceMinutesMedian: svc.length ? median(svc) : null,
      entranceNotes: [],
      handoverNotes: [],
      accessNotes: [],
      windowNotes: [],
      windowRestrictions: [],
      pastIssues: [],
      windowHistory: {},
      evidence: `Imported from ${fileName} on ${dateLabel}: ${list.length} orders, no delivery history yet, so S-Compass uses the ${types[0].replace("_", " ")} average and asks risky buyers`,
    });
    if (types.length > 1)
      for (const d of list) {
        d.result.issues.push(`This place has rows with different types (${types.join(", ")}): the first one is used`);
        if (d.result.status === "accepted") d.result.status = "warning";
      }
  }

  // Rider-days → shifts.
  const byShift = new Map<string, (typeof good)[number][]>();
  for (const d of good) byShift.set(`${d.riderId}|${d.date}`, [...(byShift.get(`${d.riderId}|${d.date}`) ?? []), d]);
  const riderIds = [...new Set(good.map((d) => d.riderId))];
  const riders: Rider[] = [];
  const shifts: Shift[] = [];
  const shiftInfo: ImportedShiftInfo[] = [];
  const shortFile = fileName.length > 28 ? `${fileName.slice(0, 25)}…` : fileName;
  let k = 0;
  riderIds.forEach((rid, ri) => {
    const riderKey = `imp-r-${slug(rid)}`;
    const keys = [...byShift.keys()].filter((x) => x.startsWith(`${rid}|`)).sort();
    const shiftIds: string[] = [];
    const riderPins: Point[] = [];
    for (const key of keys) {
      const list = byShift.get(key)!;
      const date = list[0].date;
      const dt = new Date(`${date}T00:00:00Z`);
      const weekday = WEEKDAYS[dt.getUTCDay()];
      k += 1;
      const sid = `imp-${slug(rid)}-${date}`;
      const stops: FixtureStop[] = list.map((d, i) => {
        const pin = d.latlon ? proj(d.latlon) : null;
        if (pin) riderPins.push(pin);
        const earlier = earliestDate.get(d.orderId);
        const isReattempt = (d.attemptNo ?? 1) > 1 || d.reattemptFlag === true || (!!earlier && earlier < d.date && !d.orderId.startsWith("row-"));
        return {
          id: `I${k}-${pad(i + 1)}`,
          receivedOrder: i + 1,
          buyer: `Buyer of ${d.orderId}`,
          locationKey: `imp-${d.placeKey}`,
          locationType: d.type,
          payment: d.payment,
          parcel: d.parcel,
          pin,
          serviceMinutes: d.serviceMin,
          isReattempt,
        };
      });
      const withStatus = list.filter((d) => d.delivered !== null);
      const byWindow = { morning: { attempts: 0, delivered: 0 }, afternoon: { attempts: 0, delivered: 0 }, evening: { attempts: 0, delivered: 0 } };
      for (const d of withStatus)
        if (d.window) {
          byWindow[d.window].attempts += 1;
          if (d.delivered) byWindow[d.window].delivered += 1;
        }
      shifts.push({
        id: sid,
        riderId: riderKey,
        date,
        weekday,
        isWeekend: dt.getUTCDay() === 0 || dt.getUTCDay() === 6,
        zoneLabel: `Imported · ${shortFile}`,
        stops,
        actualDatasetOutcome: { attempts: withStatus.length, delivered: withStatus.filter((d) => d.delivered).length, byWindow },
      });
      shiftIds.push(sid);
      const heavy = stops.length > HEAVY_DAY_PARCELS;
      if (heavy) fileNotes.push(`Heavy day: ${rid} on ${date} has ${stops.length} parcels (more than ${HEAVY_DAY_PARCELS}). Everything is planned; a late finish will be flagged and parcels can move to a backup rider.`);
      shiftInfo.push({ shiftId: sid, riderLabel: `Imported · ${rid}`, date, weekday, parcels: stops.length, heavy });
    }
    const hub: Point = riderPins.length ? [median(riderPins.map((p) => p[0])), median(riderPins.map((p) => p[1]))] : [0, 0];
    const places = new Set(keys.flatMap((x) => byShift.get(x)!.map((d) => `imp-${d.placeKey}`)));
    for (const kr of knowledge) if (!kr.zone && places.has(kr.key)) kr.zone = riderKey;
    riders.push({
      id: riderKey,
      letter: `I${ri + 1}`,
      name: rid,
      label: `Imported · ${rid}`,
      persona: "Rider from an imported file",
      zoneLabel: shortFile,
      hub: { name: "Start point (centre of this rider’s pins, assumption)", pos: hub },
      pickupPoints: [],
      shiftIds,
      locations: places.size,
    });
  });

  const all = drafts.map((d) => d.result);
  const batch: ImportBatch = {
    id: `imp-${now.getTime().toString(36)}`,
    fileName,
    importedAt: now.toISOString(),
    sheet,
    columns,
    riders,
    shifts,
    knowledge,
    shiftInfo,
    rows: all.filter((r) => r.issues.length > 0),
    summary: {
      rowsRead: drafts.length,
      accepted: all.filter((r) => r.status === "accepted").length,
      warning: all.filter((r) => r.status === "warning").length,
      quarantined: all.filter((r) => r.status === "quarantined").length,
      notProcessed,
      riderDays: shifts.length,
      heavyDays: shiftInfo.filter((s) => s.heavy).length,
      places: knowledge.length,
      newPlaceTypes: all.filter((r) => r.issues.some((x) => x.startsWith("Unknown place type"))).length,
    },
    fileNotes,
  };
  return { ok: true, batch };
}

// ------------------------------------------------------------------ CSV
/** Small CSV parser: quotes, escaped quotes, comma or semicolon separator, BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

export function toCsvText(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n");
}

export function templateRows(): (string | number | null)[][] {
  return [
    TEMPLATE_COLUMNS,
    ["ORD-0001", "R07", "2026-10-21", "SCH-01", "school", "cod", "standard", 10.7769, 106.7009, 12, 1],
    ["ORD-0002", "R07", "2026-10-21", "OFF-01", "office", "prepaid", "documents", 10.7811, 106.6987, 8, 1],
    ["ORD-0003", "R07", "2026-10-21", "IND-01", "industrial", "cod", "bulky", 10.8012, 106.7203, "", 2],
  ];
}

/**
 * A fictional practice file with typical problems (labelled as fictional in the app).
 * Two riders on Wed 21/10/2026: R-S1 normal day (24 parcels), R-S2 heavy day (44 parcels), plus problem rows.
 */
export function messySampleRows(): (string | number | null)[][] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const places = [
    ["SCH-01", "school", 10.7801, 106.6952], ["SCH-02", "school", 10.7745, 106.7051], ["SCH-03", "school", 10.7862, 106.6911],
    ["OFF-01", "office", 10.7769, 106.7009], ["OFF-02", "office", 10.7732, 106.7032], ["OFF-03", "office", 10.7818, 106.6990],
    ["IND-01", "industrial", 10.8012, 106.7203], ["IND-02", "industrial", 10.7966, 106.7251],
    ["GAT-01", "gated_facility", 10.7885, 106.7102], ["GAT-02", "gated_facility", 10.7699, 106.6930],
  ] as const;
  const rows: (string | number | null)[][] = [TEMPLATE_COLUMNS];
  let n = 0;
  const add = (rider: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const p = places[Math.floor(rnd() * places.length)];
      n += 1;
      rows.push([
        `ORD-${String(n).padStart(4, "0")}`, rider, "2026-10-21", p[0], p[1], rnd() < 0.45 ? "cod" : "prepaid",
        rnd() < 0.8 ? "standard" : rnd() < 0.5 ? "documents" : "bulky",
        Math.round((p[2] + (rnd() - 0.5) * 0.0012) * 1e6) / 1e6, Math.round((p[3] + (rnd() - 0.5) * 0.0012) * 1e6) / 1e6,
        Math.round(5 + rnd() * 15), rnd() < 0.1 ? 2 : 1,
      ]);
    }
  };
  add("R-S1", 24);
  add("R-S2", 44);
  const problems: (string | number | null)[][] = [
    ["ORD-0901", "R-S1", "2026-10-21", "SCH-01", "school", "cod", "standard", "", "", 10, 1], // no pin
    ["ORD-0902", "R-S1", "2026-10-21", "OFF-02", "office", "", "standard", 10.7733, 106.7031, 8, 1], // payment missing
    ["ORD-0903", "R-S1", "2026-10-21", "HOS-01", "hospital", "prepaid", "standard", 10.7790, 106.6880, 10, 1], // unknown type
    ["ORD-0904", "R-S1", "2026-10-21", "SCH-02", "school", "cod", "standard", 21.0285, 105.8542, 10, 1], // pin in Hanoi
    ["ORD-0905", "R-S1", "2026-10-21", "OFF-01", "office", "prepaid", "documents", 106.7008, 10.7770, 6, 1], // lat/lon swapped
    ["ORD-0906", "R-S1", "31/02/2026", "GAT-01", "gated_facility", "cod", "standard", 10.7886, 106.7101, 9, 1], // impossible date
    ["ORD-0001", "R-S1", "2026-10-21", "SCH-01", "school", "cod", "standard", 10.7801, 106.6952, 12, 1], // duplicate order
    ["ORD-0907", "", "2026-10-21", "IND-01", "industrial", "cod", "bulky", 10.8013, 106.7204, 14, 1], // no rider
    ["ORD-0908", "R-S1", "2026-10-21", "GAT-02", "gated_facility", "prepaid", "standard", 10.7699, 106.6931, -5, 1], // impossible handover time
    ["ORD-0909", "R-S1", "2026-10-21", "SCH-03", "school", "cod", "standard", 10.7900, 106.6911, 10, 1], // pin ~420 m from the school
    ["ORD-0910", "R-S1", "2026-10-21", "", "", "cod", "standard", "", "", "", 1], // nothing usable
  ];
  return [...rows, ...problems];
}
