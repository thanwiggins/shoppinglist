/**
 * Domain actions. Each takes the current view of the data and returns the ops
 * that make the change. They never touch the store directly, which keeps them
 * easy to test; the UI passes the result to store.commit().
 */
import { newId, remove, upsert } from './ops';
import {
  currentTrip, mealItems, mealSectionId, rows, selectedMealIds, sortedDepartments, todayIso, tripItems
} from './selectors';
import type { ItemStatus, Op, Product, Tables, Trip, TripItem } from './types';

export class ActionError extends Error {}

/* ---------------- Trips & quantities ---------------- */

/** Makes sure there is an open trip to plan into. */
export function ensureTrip(t: Tables): Op[] {
  if (currentTrip(t)) return [];
  return [upsert('trips', newId('t'), { status: 'planning', created: todayIso() })];
}

function findItem(t: Tables, tripId: string, sectionId: string, productId: string): TripItem | undefined {
  return rows(t.trip_items).find((i) => i.trip_id === tripId && i.section_id === sectionId && i.product_id === productId);
}

/** The next position at the end of a section's list for this trip. */
function nextSort(t: Tables, tripId: string, sectionId: string): number {
  return Math.max(0, ...rows(t.trip_items).filter((i) => i.trip_id === tripId && i.section_id === sectionId).map((i) => i.sort || 0)) + 1;
}

function isStaple(t: Tables, sectionId: string, productId: string) {
  return rows(t.staples).some((s) => s.section_id === sectionId && s.product_id === productId);
}

export function setQty(t: Tables, trip: Trip, sectionId: string, productId: string, qty: number): Op[] {
  qty = Math.max(0, Math.round(qty));
  const item = findItem(t, trip.id, sectionId, productId);
  if (item) return item.qty === qty ? [] : [upsert('trip_items', item.id, { qty })];
  if (qty === 0) return [];
  return [upsert('trip_items', newId('ti'), {
    trip_id: trip.id, product_id: productId, section_id: sectionId, qty,
    source: isStaple(t, sectionId, productId) ? 'staple' : 'added', status: 'todo',
    sort: nextSort(t, trip.id, sectionId)
  })];
}

export function addToTrip(t: Tables, trip: Trip, sectionId: string, productId: string, qty = 1): Op[] {
  const item = findItem(t, trip.id, sectionId, productId);
  return setQty(t, trip, sectionId, productId, (item?.qty ?? 0) + qty);
}

/** Removes an item that isn't a staple from this week's list. */
export function removeFromTrip(t: Tables, trip: Trip, sectionId: string, productId: string): Op[] {
  const item = findItem(t, trip.id, sectionId, productId);
  return item ? [remove('trip_items', item.id)] : [];
}

/** Pin = make it a staple in this section; unpin = stop showing it every week. */
export function toggleStaple(t: Tables, sectionId: string, productId: string): Op[] {
  const existing = rows(t.staples).filter((s) => s.section_id === sectionId && s.product_id === productId);
  if (existing.length) return existing.map((s) => remove('staples', s.id));
  const sort = Math.max(0, ...rows(t.staples).filter((s) => s.section_id === sectionId).map((s) => s.sort)) + 1;
  return [upsert('staples', newId('st'), { section_id: sectionId, product_id: productId, default_qty: 1, sort })];
}

/** Saves a new order for a section's staples (product ids, top to bottom). */
export function reorderStaples(t: Tables, sectionId: string, productIds: string[]): Op[] {
  const bySection = rows(t.staples).filter((s) => s.section_id === sectionId);
  const ops: Op[] = [];
  productIds.forEach((pid, k) => {
    for (const s of bySection) if (s.product_id === pid && s.sort !== k + 1) ops.push(upsert('staples', s.id, { sort: k + 1 }));
  });
  return ops;
}

/** Saves a new order for this week's (non-staple) items in one group (trip item ids, top to bottom). */
export function reorderTripItems(t: Tables, itemIds: string[]): Op[] {
  return itemIds.flatMap((id, k) => (t.trip_items[id] && t.trip_items[id].sort !== k + 1 ? [upsert('trip_items', id, { sort: k + 1 })] : []));
}

/** Check off (or un-check, or skip) a product on the shopping list, across every section it's in. */
export function setShopStatus(t: Tables, trip: Trip, productId: string, status: ItemStatus): Op[] {
  return tripItems(t, trip.id)
    .filter((i) => i.product_id === productId && i.qty > 0 && i.status !== status)
    .map((i) => upsert('trip_items', i.id, { status }));
}

export function startShopping(trip: Trip): Op[] {
  return trip.status === 'planning' ? [upsert('trips', trip.id, { status: 'shopping' })] : [];
}

/**
 * What to do with items that weren't checked off when a trip is finished:
 *   carry   put them (and out-of-stock items) on next week's list
 *   bought  count unchecked items as bought; out-of-stock items still carry over
 *   drop    leave them off next week's list
 */
export type Leftovers = 'carry' | 'bought' | 'drop';

/**
 * Finishes a trip (also "Reset List"): records purchases, closes the trip and opens
 * next week's. Each product gets ONE purchase row even if it was in two sections.
 */
export function finishTrip(t: Tables, trip: Trip, date: string, leftovers: Leftovers): Op[] {
  const ops: Op[] = [];
  const items = tripItems(t, trip.id).filter((i) => i.qty > 0 && t.products[i.product_id]);
  const bought = new Map<string, number>();
  const isBought = (i: TripItem) => i.status === 'in_cart' || (leftovers === 'bought' && i.status === 'todo');
  let est = 0, actual = 0;
  for (const i of items) {
    const price = t.products[i.product_id].price;
    est += price * i.qty;
    ops.push(upsert('trip_items', i.id, { price, ...(isBought(i) && i.status !== 'in_cart' ? { status: 'in_cart' as const } : {}) }));
    if (isBought(i)) {
      actual += price * i.qty;
      bought.set(i.product_id, (bought.get(i.product_id) ?? 0) + i.qty);
    }
  }
  for (const [pid, qty] of bought) {
    ops.push(upsert('purchases', newId('pu'), { product_id: pid, date, qty, price: t.products[pid].price, trip_id: trip.id }));
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  ops.push(upsert('trips', trip.id, { status: 'done', date, est_total: round(est), actual_total: round(actual) }));

  const nextId = newId('t');
  ops.push(upsert('trips', nextId, { status: 'planning', created: todayIso() }));
  if (leftovers !== 'drop') {
    for (const i of items) {
      if (isBought(i)) continue;
      ops.push(upsert('trip_items', newId('ti'), {
        trip_id: nextId, product_id: i.product_id, section_id: i.section_id, qty: i.qty,
        source: isStaple(t, i.section_id, i.product_id) ? 'staple' : 'carried', status: 'todo', sort: i.sort || 0
      }));
    }
  }
  return ops;
}

/* ---------------- Meals ---------------- */

function adjustMealIngredient(t: Tables, trip: Trip, sectionId: string, productId: string, delta: number, pending: Map<string, TripItem>): Op[] {
  const key = productId;
  const item = pending.get(key) ?? findItem(t, trip.id, sectionId, productId);
  if (item) {
    const qty = Math.max(0, item.qty + delta);
    pending.set(key, { ...item, qty });
    if (qty === 0 && item.source === 'meal') return [remove('trip_items', item.id)];
    return [upsert('trip_items', item.id, { qty })];
  }
  if (delta <= 0) return [];
  const id = newId('ti');
  const sort = Math.max(nextSort(t, trip.id, sectionId), ...[...pending.values()].map((p) => (p.sort || 0) + 1));
  const fields = { trip_id: trip.id, product_id: productId, section_id: sectionId, qty: delta, source: 'meal' as const, status: 'todo' as const, price: 0, sort };
  pending.set(key, { id, ...fields });
  return [upsert('trip_items', id, fields)];
}

/** Selecting a meal adds its (non-pantry) ingredients; deselecting takes them back off. */
export function toggleMeal(t: Tables, trip: Trip, mealId: string): Op[] {
  const sectionId = mealSectionId(t);
  const selected = rows(t.trip_meals).filter((tm) => tm.trip_id === trip.id && tm.meal_id === mealId);
  const on = selected.length === 0;
  const ops: Op[] = on ? [upsert('trip_meals', newId('tm'), { trip_id: trip.id, meal_id: mealId })] : selected.map((tm) => remove('trip_meals', tm.id));
  const pending = new Map<string, TripItem>();
  for (const mi of mealItems(t, mealId)) {
    if (mi.pantry) continue;
    ops.push(...adjustMealIngredient(t, trip, sectionId, mi.product_id, on ? mi.qty : -mi.qty, pending));
  }
  return ops;
}

/** Pantry check: "Add" puts a usually-on-hand ingredient on the list; "Have it" takes it off. */
export function setPantryNeeded(t: Tables, trip: Trip, productId: string, needed: boolean): Op[] {
  const sectionId = mealSectionId(t);
  const item = findItem(t, trip.id, sectionId, productId);
  if (needed) return item && item.qty > 0 ? [] : adjustMealIngredient(t, trip, sectionId, productId, 1, new Map());
  if (!item) return [];
  return item.source === 'meal' ? [remove('trip_items', item.id)] : [upsert('trip_items', item.id, { qty: 0 })];
}

/** Pantry ingredients of the meals picked for this trip, with whether each is on the list. */
export function pantryCheck(t: Tables, trip: Trip | undefined) {
  if (!trip) return [];
  const sectionId = mealSectionId(t);
  const seen = new Map<string, { productId: string; meals: string[]; onList: boolean }>();
  for (const mealId of selectedMealIds(t, trip.id)) {
    for (const mi of mealItems(t, mealId)) {
      if (!mi.pantry) continue;
      const entry = seen.get(mi.product_id) ?? {
        productId: mi.product_id, meals: [],
        onList: (findItem(t, trip.id, sectionId, mi.product_id)?.qty ?? 0) > 0
      };
      entry.meals.push(t.meals[mealId].name);
      seen.set(mi.product_id, entry);
    }
  }
  return [...seen.values()].sort((a, b) => t.products[a.productId].name.localeCompare(t.products[b.productId].name));
}

export function createMeal(t: Tables, name: string): { ops: Op[]; id: string } {
  name = name.trim();
  if (!name) throw new ActionError('Give the meal a name.');
  if (rows(t.meals).some((m) => m.active && m.name.toLowerCase() === name.toLowerCase())) {
    throw new ActionError(`There's already a meal called “${name}”.`);
  }
  const id = newId('m');
  return { id, ops: [upsert('meals', id, { name, active: true })] };
}

export function renameMeal(t: Tables, mealId: string, name: string): Op[] {
  name = name.trim();
  if (!name) throw new ActionError('Give the meal a name.');
  if (rows(t.meals).some((m) => m.id !== mealId && m.active && m.name.toLowerCase() === name.toLowerCase())) {
    throw new ActionError(`There's already a meal called “${name}”.`);
  }
  return [upsert('meals', mealId, { name })];
}

export function deleteMeal(t: Tables, mealId: string): Op[] {
  const ops: Op[] = [];
  const trip = currentTrip(t);
  if (trip && selectedMealIds(t, trip.id).has(mealId)) ops.push(...toggleMeal(t, trip, mealId));
  ops.push(upsert('meals', mealId, { active: false }));
  return ops;
}

export function setMealIngredient(t: Tables, mealId: string, productId: string, fields: { qty?: number; pantry?: boolean }): Op[] {
  const existing = rows(t.meal_items).find((mi) => mi.meal_id === mealId && mi.product_id === productId);
  if (existing) return [upsert('meal_items', existing.id, fields)];
  return [upsert('meal_items', newId('mi'), { meal_id: mealId, product_id: productId, qty: fields.qty ?? 1, pantry: fields.pantry ?? false })];
}

export function removeMealIngredient(mealItemId: string): Op[] {
  return [remove('meal_items', mealItemId)];
}

/* ---------------- Products & departments ---------------- */

function checkProductName(t: Tables, name: string, exceptId?: string) {
  if (!name) throw new ActionError('Give the product a name.');
  const clash = rows(t.products).find((p) => p.id !== exceptId && p.active && p.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ActionError(`“${clash.name}” is already in your products.`);
}

/**
 * Tidies a photo / product-page link: blank stays blank, "www.store.com/x" gets https://,
 * anything that isn't a web address is refused.
 */
export function cleanLink(text: string): string {
  const raw = text.trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ActionError('That link doesn’t look like a web address.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
    throw new ActionError('That link doesn’t look like a web address.');
  }
  return url.href;
}

export function createProduct(t: Tables, input: { name: string; price: number; dept_id: string; link?: string }): { ops: Op[]; id: string } {
  const name = input.name.trim();
  checkProductName(t, name);
  if (!(input.price >= 0)) throw new ActionError('Enter a price.');
  const link = cleanLink(input.link ?? '');
  // Bring back an archived product with the same name instead of making a twin.
  const archived = rows(t.products).find((p) => !p.active && p.name.toLowerCase() === name.toLowerCase());
  const id = archived?.id ?? newId('p');
  return { id, ops: [upsert('products', id, { name, price: round2(input.price), dept_id: input.dept_id, link, active: true })] };
}

export function updateProduct(t: Tables, productId: string, fields: Partial<Pick<Product, 'name' | 'price' | 'dept_id' | 'note' | 'active' | 'link'>>): Op[] {
  const clean: Partial<Product> = { ...fields };
  if (clean.name !== undefined) {
    clean.name = clean.name.trim();
    checkProductName(t, clean.name, productId);
  }
  if (clean.price !== undefined) {
    if (!(clean.price >= 0)) throw new ActionError('Enter a price.');
    clean.price = round2(clean.price);
  }
  if (clean.link !== undefined) clean.link = cleanLink(clean.link);
  return [upsert('products', productId, clean)];
}

export function createDepartment(t: Tables, name: string): { ops: Op[]; id: string } {
  name = name.trim();
  if (!name) throw new ActionError('Give the department a name.');
  if (rows(t.departments).some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new ActionError(`“${name}” already exists.`);
  const id = newId('d');
  const walk = Math.max(0, ...rows(t.departments).map((d) => d.walk_order)) + 1;
  return { id, ops: [upsert('departments', id, { name, walk_order: walk })] };
}

export function renameDepartment(t: Tables, id: string, name: string): Op[] {
  name = name.trim();
  if (!name) throw new ActionError('Give the department a name.');
  if (rows(t.departments).some((d) => d.id !== id && d.name.toLowerCase() === name.toLowerCase())) throw new ActionError(`“${name}” already exists.`);
  return [upsert('departments', id, { name })];
}

/** Moves a department earlier (-1) or later (+1) in the walk through the store. */
export function moveDepartment(t: Tables, id: string, delta: -1 | 1): Op[] {
  const list = sortedDepartments(t);
  const i = list.findIndex((d) => d.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.flatMap((d, k) => (d.walk_order === k + 1 ? [] : [upsert('departments', d.id, { walk_order: k + 1 })]));
}

export function deleteDepartment(t: Tables, id: string): Op[] {
  const used = rows(t.products).filter((p) => p.dept_id === id && p.active).length;
  if (used) throw new ActionError(`Move its ${used} product${used === 1 ? '' : 's'} to another department first.`);
  return [remove('departments', id)];
}

export function setSetting(key: string, value: string): Op[] {
  return [upsert('settings', key, { value })];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
