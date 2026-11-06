/** Row shapes. These mirror CORE_SCHEMA in apps-script/Core.js; keep the two in step. */

export interface SystemFields {
  id: string;
  updated_at?: string;
  deleted?: boolean;
  _v?: number;
}

export interface Department extends SystemFields { name: string; walk_order: number }
export interface Product extends SystemFields { name: string; price: number; dept_id: string; note: string; active: boolean }
export interface Section extends SystemFields { name: string; sort: number }
export interface Staple extends SystemFields { section_id: string; product_id: string; default_qty: number; sort: number }
export interface Meal extends SystemFields { name: string; note: string; active: boolean }
export interface MealItem extends SystemFields { meal_id: string; product_id: string; qty: number; pantry: boolean }
export type TripStatus = 'planning' | 'shopping' | 'done';
export interface Trip extends SystemFields { status: TripStatus; created: string; date: string; est_total: number; actual_total: number }
export type ItemSource = 'staple' | 'meal' | 'added' | 'carried';
export type ItemStatus = 'todo' | 'in_cart' | 'skipped';
export interface TripItem extends SystemFields {
  trip_id: string; product_id: string; section_id: string; qty: number;
  source: ItemSource; status: ItemStatus; price: number;
}
export interface TripMeal extends SystemFields { trip_id: string; meal_id: string }
export interface Purchase extends SystemFields { product_id: string; date: string; qty: number; price: number; trip_id: string }
export interface Setting extends SystemFields { value: string }

export interface RowTypes {
  departments: Department;
  products: Product;
  sections: Section;
  staples: Staple;
  meals: Meal;
  meal_items: MealItem;
  trips: Trip;
  trip_items: TripItem;
  trip_meals: TripMeal;
  purchases: Purchase;
  settings: Setting;
}

export type TableName = keyof RowTypes;

export const TABLES: TableName[] = [
  'departments', 'products', 'sections', 'staples', 'meals', 'meal_items',
  'trips', 'trip_items', 'trip_meals', 'purchases', 'settings'
];

export type Tables = { [T in TableName]: Record<string, RowTypes[T]> };

/** A change the device makes. Upserts carry only the fields that changed. */
export type Op =
  | { kind: 'upsert'; table: TableName; id: string; fields: Record<string, unknown>; at: string }
  | { kind: 'delete'; table: TableName; id: string; at: string };

/** Defaults for a brand-new row, matching CORE_SCHEMA. */
export const DEFAULTS: { [T in TableName]: Omit<RowTypes[T], 'id'> } = {
  departments: { name: '', walk_order: 0 },
  products: { name: '', price: 0, dept_id: '', note: '', active: true },
  sections: { name: '', sort: 0 },
  staples: { section_id: '', product_id: '', default_qty: 0, sort: 0 },
  meals: { name: '', note: '', active: true },
  meal_items: { meal_id: '', product_id: '', qty: 1, pantry: false },
  trips: { status: 'planning', created: '', date: '', est_total: 0, actual_total: 0 },
  trip_items: { trip_id: '', product_id: '', section_id: '', qty: 0, source: 'added', status: 'todo', price: 0 },
  trip_meals: { trip_id: '', meal_id: '' },
  purchases: { product_id: '', date: '', qty: 1, price: 0, trip_id: '' },
  settings: { value: '' }
};

export function emptyTables(): Tables {
  const t = {} as Tables;
  for (const name of TABLES) (t as Record<string, unknown>)[name] = {};
  return t;
}
