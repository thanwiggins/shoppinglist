import { describe, expect, it } from 'vitest';
import { mealId, productId, sampleView, sectionId } from '../test/helpers';
import {
  ActionError, cleanLink, createProduct, deleteDepartment, finishTrip, moveDepartment, pantryCheck, reorderStaples,
  reorderTripItems, setPantryNeeded, setQty, setShopStatus, toggleMeal, toggleStaple, updateProduct
} from './actions';
import { applyOps } from './ops';
import { currentTrip, planModel, productStats, rows, shopModel, sortedDepartments } from './selectors';

describe('plan', () => {
  it('shows staples at zero and puts meal items in their own group', () => {
    const t = sampleView();
    const plan = planModel(t, currentTrip(t));
    const supplies = plan.sections.find((s) => s.section.name === 'Supplies')!;
    expect(supplies.groups.map((g) => g.kind)).toEqual(['staple', 'added']);
    const towels = supplies.groups[0].items.find((i) => i.product.name === 'Paper Towels')!;
    expect(towels.qty).toBe(0);
    const dinner = plan.sections.find((s) => s.section.name === 'Dinner')!;
    expect(dinner.groups.find((g) => g.kind === 'meal')!.items.map((i) => i.product.name).sort()).toEqual(['Breadsticks', 'Pizza', 'Red Sauce']);
    expect(plan.total).toBe(89.5);
  });

  it('sets quantities and creates list items as needed', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    t = applyOps(t, setQty(t, trip, sectionId(t, 'Supplies'), productId(t, 'Paper Towels'), 3));
    const item = rows(t.trip_items).find((i) => i.product_id === productId(t, 'Paper Towels'))!;
    expect(item).toMatchObject({ qty: 3, source: 'staple' });
    expect(setQty(t, trip, sectionId(t, 'Supplies'), productId(t, 'Paper Towels'), 3)).toEqual([]);
  });

  it('pins and unpins staples', () => {
    let t = sampleView();
    const sec = sectionId(t, 'Supplies');
    const soap = productId(t, 'Dish Soap');
    t = applyOps(t, toggleStaple(t, sec, soap));
    expect(rows(t.staples).some((s) => s.product_id === soap && s.section_id === sec)).toBe(true);
    t = applyOps(t, toggleStaple(t, sec, soap));
    expect(rows(t.staples).some((s) => s.product_id === soap)).toBe(false);
  });
});

describe('meals', () => {
  it('adds ingredients when picked and takes them back off when unpicked', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    const before = planModel(t, trip).total;
    t = applyOps(t, toggleMeal(t, trip, mealId(t, 'Chicken Sandwiches')));
    const dinner = sectionId(t, 'Dinner');
    const patties = rows(t.trip_items).find((i) => i.product_id === productId(t, 'Chicken Patties') && i.section_id === dinner)!;
    expect(patties).toMatchObject({ qty: 1, source: 'meal' });
    t = applyOps(t, toggleMeal(t, trip, mealId(t, 'Chicken Sandwiches')));
    expect(rows(t.trip_items).some((i) => i.product_id === productId(t, 'Chicken Patties'))).toBe(false);
    expect(planModel(t, trip).total).toBe(before);
  });

  it('keeps a shared ingredient when only one of two meals is removed', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    // Red Sauce is already on the list once (from "Redsauce Rice and Breadsticks"); Pasta Night needs it too.
    t = applyOps(t, toggleMeal(t, trip, mealId(t, 'Pasta Night')));
    const sauce = () => rows(t.trip_items).find((i) => i.product_id === productId(t, 'Red Sauce'))!;
    expect(sauce().qty).toBe(2);
    t = applyOps(t, toggleMeal(t, trip, mealId(t, 'Pasta Night')));
    expect(sauce().qty).toBe(1);
  });

  it('asks about pantry items instead of adding them', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    t = applyOps(t, toggleMeal(t, trip, mealId(t, 'Tacos')));
    expect(rows(t.trip_items).some((i) => i.product_id === productId(t, 'Salsa'))).toBe(false);
    expect(pantryCheck(t, trip).map((p) => t.products[p.productId].name)).toEqual(['Cheddar Cheese', 'Fresh Tortillas', 'Salsa']);
    t = applyOps(t, setPantryNeeded(t, trip, productId(t, 'Salsa'), true));
    expect(pantryCheck(t, trip).find((p) => t.products[p.productId].name === 'Salsa')!.onList).toBe(true);
    t = applyOps(t, setPantryNeeded(t, trip, productId(t, 'Salsa'), false));
    expect(rows(t.trip_items).some((i) => i.product_id === productId(t, 'Salsa'))).toBe(false);
  });
});

describe('shopping and finishing a trip', () => {
  it('merges a product that is in two sections into one shopping row', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    t = applyOps(t, setQty(t, trip, sectionId(t, 'Lunch'), productId(t, 'Milk'), 2));
    const shop = shopModel(t, trip);
    const milk = shop.groups.flatMap((g) => g.rows).filter((r) => r.product.name === 'Milk');
    expect(milk).toHaveLength(1);
    expect(milk[0].qty).toBe(3);
    t = applyOps(t, setShopStatus(t, trip, milk[0].productId, 'in_cart'));
    expect(rows(t.trip_items).filter((i) => i.product_id === milk[0].productId).every((i) => i.status === 'in_cart')).toBe(true);
  });

  it('follows the department walk order', () => {
    const t = sampleView();
    const shop = shopModel(t, currentTrip(t));
    const order = shop.groups.map((g) => g.dept!.walk_order);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(shop.groups[0].dept!.name).toBe('Cosmetics');
  });

  it('records one purchase per product, closes the trip and carries leftovers', () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    const milk = productId(t, 'Milk');
    t = applyOps(t, setQty(t, trip, sectionId(t, 'Lunch'), milk, 2));
    t = applyOps(t, setShopStatus(t, trip, milk, 'in_cart'));
    t = applyOps(t, setShopStatus(t, trip, productId(t, 'Apples'), 'skipped'));
    const before = rows(t.purchases).filter((p) => p.product_id === milk).length;
    t = applyOps(t, finishTrip(t, trip, '2026-11-07', 'carry'));

    const milkBuys = rows(t.purchases).filter((p) => p.product_id === milk);
    expect(milkBuys).toHaveLength(before + 1);
    expect(milkBuys.find((p) => p.date === '2026-11-07')!.qty).toBe(3);
    expect(t.trips[trip.id]).toMatchObject({ status: 'done', date: '2026-11-07' });

    const next = currentTrip(t)!;
    expect(next.id).not.toBe(trip.id);
    const carried = rows(t.trip_items).filter((i) => i.trip_id === next.id);
    expect(carried.some((i) => i.product_id === productId(t, 'Apples'))).toBe(true);
    expect(carried.some((i) => i.product_id === milk)).toBe(false);
    expect(carried.some((i) => i.product_id === productId(t, 'Diapers'))).toBe(false); // was in the cart
    expect(productStats(t, '2026-11-07').get(milk)!.last).toBe('2026-11-07');
  });
});

describe('products and departments', () => {
  it('refuses duplicate product names', () => {
    const t = sampleView();
    expect(() => createProduct(t, { name: 'milk', price: 1, dept_id: '' })).toThrow(ActionError);
    expect(() => updateProduct(t, productId(t, 'Bread'), { name: 'Milk' })).toThrow(ActionError);
    const { ops } = createProduct(t, { name: 'Oat Milk', price: 4.499, dept_id: '' });
    expect(ops[0]).toMatchObject({ table: 'products', fields: { name: 'Oat Milk', price: 4.5 } });
  });

  it('reorders departments and keeps walk order tidy', () => {
    let t = sampleView();
    const second = sortedDepartments(t)[1];
    t = applyOps(t, moveDepartment(t, second.id, -1));
    expect(sortedDepartments(t)[0].id).toBe(second.id);
    expect(sortedDepartments(t).map((d) => d.walk_order)).toEqual(sortedDepartments(t).map((_, i) => i + 1));
  });

  it("won't delete a department that still has products", () => {
    const t = sampleView();
    const produce = sortedDepartments(t).find((d) => d.name === 'Produce')!;
    expect(() => deleteDepartment(t, produce.id)).toThrow(/Move its/);
  });
});

describe('reordering the plan', () => {
  const names = (t: ReturnType<typeof sampleView>, section: string, kind: string) =>
    planModel(t, currentTrip(t)).sections.find((s) => s.section.name === section)!
      .groups.find((g) => g.kind === kind)!.items.map((i) => i.product.name);

  it('reorders staples within a section', () => {
    let t = sampleView();
    expect(names(t, 'Supplies', 'staple')).toEqual(['Diapers', 'Wipes', 'Paper Towels']);
    const ids = ['Paper Towels', 'Diapers', 'Wipes'].map((n) => productId(t, n));
    t = applyOps(t, reorderStaples(t, sectionId(t, 'Supplies'), ids));
    expect(names(t, 'Supplies', 'staple')).toEqual(['Paper Towels', 'Diapers', 'Wipes']);
  });

  it("reorders this week's items and puts new ones at the bottom", () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    const sec = sectionId(t, 'Supplies');
    t = applyOps(t, setQty(t, trip, sec, productId(t, 'Toilet Paper'), 1));
    t = applyOps(t, setQty(t, trip, sec, productId(t, 'Apples'), 1));
    expect(names(t, 'Supplies', 'added')).toEqual(['Deodorant', 'Dish Soap', 'Toilet Paper', 'Apples']);
    const itemId = (n: string) => rows(t.trip_items).find((i) => i.section_id === sec && i.product_id === productId(t, n))!.id;
    t = applyOps(t, reorderTripItems(t, ['Apples', 'Toilet Paper', 'Dish Soap', 'Deodorant'].map(itemId)));
    expect(names(t, 'Supplies', 'added')).toEqual(['Apples', 'Toilet Paper', 'Dish Soap', 'Deodorant']);
  });
});

describe('reset list options', () => {
  const setup = () => {
    let t = sampleView();
    const trip = currentTrip(t)!;
    t = applyOps(t, setShopStatus(t, trip, productId(t, 'Apples'), 'skipped'));
    return { t, trip };
  };
  const nextItems = (t: ReturnType<typeof sampleView>) => rows(t.trip_items).filter((i) => i.trip_id === currentTrip(t)!.id);

  it('counts unchecked items as bought, but out-of-stock ones still carry over', () => {
    let { t, trip } = setup();
    const milk = productId(t, 'Milk'); // on the list, not checked off
    t = applyOps(t, finishTrip(t, trip, '2026-11-07', 'bought'));
    expect(rows(t.purchases).some((p) => p.product_id === milk && p.date === '2026-11-07')).toBe(true);
    expect(nextItems(t).map((i) => t.products[i.product_id].name)).toEqual(['Apples']);
    expect(t.trips[trip.id].actual_total).toBe(t.trips[trip.id].est_total - 5); // Apples: 10 × $0.50 not bought
  });

  it('drops everything that was not bought', () => {
    let { t, trip } = setup();
    t = applyOps(t, finishTrip(t, trip, '2026-11-07', 'drop'));
    expect(nextItems(t)).toHaveLength(0);
  });
});

describe('product links', () => {
  it('tidies links and refuses things that are not web addresses', () => {
    expect(cleanLink('')).toBe('');
    expect(cleanLink('  www.walmart.com/ip/123 ')).toBe('https://www.walmart.com/ip/123');
    expect(cleanLink('https://i5.walmartimages.com/a.jpeg?w=200')).toBe('https://i5.walmartimages.com/a.jpeg?w=200');
    expect(() => cleanLink('javascript:alert(1)')).toThrow(ActionError);
    expect(() => cleanLink('milk')).toThrow(ActionError);
  });

  it('saves a link with a new product and on edit', () => {
    const t = sampleView();
    const { ops } = createProduct(t, { name: 'Oat Milk', price: 4, dept_id: '', link: 'example.com/oat.jpg' });
    expect(ops[0]).toMatchObject({ fields: { link: 'https://example.com/oat.jpg' } });
    expect(updateProduct(t, productId(t, 'Milk'), { link: '' })[0]).toMatchObject({ fields: { link: '' } });
  });
});

