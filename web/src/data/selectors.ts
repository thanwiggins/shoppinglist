import type { Department, ItemStatus, Meal, Product, Section, Staple, Tables, Trip, TripItem } from './types';

const byNum = <T,>(f: (x: T) => number) => (a: T, b: T) => f(a) - f(b);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export const rows = <T,>(rec: Record<string, T>): T[] => Object.values(rec);

export function sortedDepartments(t: Tables): Department[] {
  return rows(t.departments).sort((a, b) => a.walk_order - b.walk_order || byName(a, b));
}

export function sortedSections(t: Tables): Section[] {
  return rows(t.sections).sort((a, b) => a.sort - b.sort || byName(a, b));
}

export function activeProducts(t: Tables): Product[] {
  return rows(t.products).filter((p) => p.active).sort(byName);
}

export function setting(t: Tables, key: string, fallback = ''): string {
  return t.settings[key]?.value ?? fallback;
}

export function settingNumber(t: Tables, key: string): number | null {
  const v = parseFloat(setting(t, key));
  return isFinite(v) ? v : null;
}

/** The open trip (planning or shopping). There should only ever be one. */
export function currentTrip(t: Tables): Trip | undefined {
  return rows(t.trips)
    .filter((tr) => tr.status !== 'done')
    .sort((a, b) => (b.created || '').localeCompare(a.created || '') || b.id.localeCompare(a.id))[0];
}

export function lastFinishedTrip(t: Tables): Trip | undefined {
  return rows(t.trips)
    .filter((tr) => tr.status === 'done' && tr.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function tripItems(t: Tables, tripId: string): TripItem[] {
  return rows(t.trip_items).filter((i) => i.trip_id === tripId);
}

/** The section new meal ingredients land in (Dinner, unless changed in settings). */
export function mealSectionId(t: Tables): string {
  const id = setting(t, 'meal_section_id');
  if (id && t.sections[id]) return id;
  const sections = sortedSections(t);
  return (sections.find((s) => s.name.toLowerCase() === 'dinner') ?? sections[sections.length - 1])?.id ?? '';
}

/* ---------------- Purchase history ---------------- */

export interface ProductStats {
  last?: string;
  /** Typical days between purchases (same rule as the old Product Life column). */
  cycle?: number;
  daysSince?: number;
  due: boolean;
  count: number;
}

const DAY = 86400000;
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function todayIso(d = new Date()): string {
  const m = d.getMonth() + 1, day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

const statsCache = new WeakMap<object, Map<string, ProductStats>>();

export function productStats(t: Tables, today = todayIso()): Map<string, ProductStats> {
  const cached = statsCache.get(t.purchases);
  if (cached) return cached;
  const dates = new Map<string, Set<string>>();
  for (const p of rows(t.purchases)) {
    if (!p.date) continue;
    if (!dates.has(p.product_id)) dates.set(p.product_id, new Set());
    dates.get(p.product_id)!.add(p.date);
  }
  const out = new Map<string, ProductStats>();
  for (const [pid, set] of dates) {
    const d = [...set].sort().reverse(); // newest first
    let cycle: number | undefined;
    if (d.length >= 3) cycle = (Math.abs(toDay(d[0]) - toDay(d[1])) + Math.abs(toDay(d[1]) - toDay(d[2]))) / 2 / DAY;
    else if (d.length === 2) cycle = (toDay(d[0]) - toDay(d[1])) / DAY;
    const daysSince = Math.round((toDay(today) - toDay(d[0])) / DAY);
    out.set(pid, { last: d[0], cycle, daysSince, due: cycle !== undefined && cycle > 0 && daysSince >= cycle, count: d.length });
  }
  statsCache.set(t.purchases, out);
  return out;
}

/* ---------------- Plan ---------------- */

export type GroupKind = 'staple' | 'meal' | 'added';

export interface PlanItem {
  productId: string;
  product: Product;
  sectionId: string;
  qty: number;
  item?: TripItem;
  staple?: Staple;
}

export interface PlanSection {
  section: Section;
  total: number;
  count: number;
  groups: { kind: GroupKind; items: PlanItem[] }[];
}

export interface PlanModel {
  sections: PlanSection[];
  total: number;
  count: number;
}

export function planModel(t: Tables, trip: Trip | undefined): PlanModel {
  const items = trip ? tripItems(t, trip.id) : [];
  const sections = sortedSections(t).map<PlanSection>((section) => {
    const staples = rows(t.staples)
      .filter((s) => s.section_id === section.id && t.products[s.product_id])
      .sort(byNum((s) => s.sort));
    const stapleIds = new Set(staples.map((s) => s.product_id));
    const mine = items.filter((i) => i.section_id === section.id && t.products[i.product_id]);
    const itemFor = new Map(mine.map((i) => [i.product_id, i]));
    const stapleItems: PlanItem[] = staples.map((s) => {
      const item = itemFor.get(s.product_id);
      return { productId: s.product_id, product: t.products[s.product_id], sectionId: section.id, qty: item?.qty ?? 0, item, staple: s };
    });
    const others = mine
      .filter((i) => !stapleIds.has(i.product_id))
      .sort((a, b) => byName(t.products[a.product_id], t.products[b.product_id]));
    const toPlan = (i: TripItem): PlanItem => ({ productId: i.product_id, product: t.products[i.product_id], sectionId: section.id, qty: i.qty, item: i });
    const groups: PlanSection['groups'] = [
      { kind: 'staple' as const, items: stapleItems },
      { kind: 'meal' as const, items: others.filter((i) => i.source === 'meal').map(toPlan) },
      { kind: 'added' as const, items: others.filter((i) => i.source !== 'meal').map(toPlan) }
    ].filter((g) => g.items.length > 0);
    let total = 0, count = 0;
    for (const i of mine) {
      if (i.qty > 0) { total += i.qty * t.products[i.product_id].price; count += 1; }
    }
    return { section, total, count, groups };
  });
  return {
    sections,
    total: sections.reduce((s, x) => s + x.total, 0),
    count: sections.reduce((s, x) => s + x.count, 0)
  };
}

/* ---------------- Shop ---------------- */

export interface ShopRow {
  productId: string;
  product: Product;
  qty: number;
  total: number;
  status: ItemStatus;
  itemIds: string[];
}

export interface ShopGroup {
  dept: Department | null;
  rows: ShopRow[];
}

export interface ShopModel {
  groups: ShopGroup[];
  total: number;
  cart: number;
  count: number;
  done: number;
  skipped: number;
}

/** One row per product (summed across sections), grouped in store-walk order. */
export function shopModel(t: Tables, trip: Trip | undefined): ShopModel {
  const items = trip ? tripItems(t, trip.id).filter((i) => i.qty > 0 && t.products[i.product_id]) : [];
  const byProduct = new Map<string, TripItem[]>();
  for (const i of items) {
    if (!byProduct.has(i.product_id)) byProduct.set(i.product_id, []);
    byProduct.get(i.product_id)!.push(i);
  }
  const shopRows: ShopRow[] = [...byProduct.entries()].map(([pid, list]) => {
    const product = t.products[pid];
    const qty = list.reduce((s, i) => s + i.qty, 0);
    const statuses = new Set(list.map((i) => i.status));
    const status: ItemStatus = statuses.size === 1 ? list[0].status : statuses.has('todo') ? 'todo' : 'in_cart';
    return { productId: pid, product, qty, total: qty * product.price, status, itemIds: list.map((i) => i.id) };
  });
  const depts = sortedDepartments(t);
  const groups: ShopGroup[] = [];
  for (const d of depts) {
    const r = shopRows.filter((x) => x.product.dept_id === d.id).sort((a, b) => byName(a.product, b.product));
    if (r.length) groups.push({ dept: d, rows: r });
  }
  const orphans = shopRows.filter((x) => !t.departments[x.product.dept_id]).sort((a, b) => byName(a.product, b.product));
  if (orphans.length) groups.push({ dept: null, rows: orphans });

  let total = 0, cart = 0, done = 0, skipped = 0;
  for (const r of shopRows) {
    if (r.status === 'skipped') { skipped += 1; continue; }
    total += r.total;
    if (r.status === 'in_cart') { cart += r.total; done += 1; }
  }
  return { groups, total, cart, count: shopRows.length - skipped, done, skipped };
}

/* ---------------- Meals ---------------- */

export function mealItems(t: Tables, mealId: string) {
  return rows(t.meal_items)
    .filter((mi) => mi.meal_id === mealId && t.products[mi.product_id])
    .sort((a, b) => Number(a.pantry) - Number(b.pantry) || byName(t.products[a.product_id], t.products[b.product_id]));
}

/** Estimated cost: the non-pantry ingredients at today's prices. */
export function mealCost(t: Tables, mealId: string): number {
  return mealItems(t, mealId)
    .filter((mi) => !mi.pantry)
    .reduce((s, mi) => s + mi.qty * t.products[mi.product_id].price, 0);
}

export function sortedMeals(t: Tables): Meal[] {
  return rows(t.meals).filter((m) => m.active).sort(byName);
}

export function selectedMealIds(t: Tables, tripId: string | undefined): Set<string> {
  if (!tripId) return new Set();
  return new Set(rows(t.trip_meals).filter((tm) => tm.trip_id === tripId && t.meals[tm.meal_id]).map((tm) => tm.meal_id));
}

/* ---------------- Search ---------------- */

/** Simple ranked product search: prefix matches first, then word starts, then substrings. */
export function searchProducts(t: Tables, query: string, limit = 8): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, Product][] = [];
  for (const p of rows(t.products)) {
    if (!p.active) continue;
    const n = p.name.toLowerCase();
    let score = -1;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.split(/[\s,()/-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || byName(a[1], b[1])).slice(0, limit).map((x) => x[1]);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
