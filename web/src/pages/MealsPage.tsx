import { useMemo, useState } from 'react';
import {
  ActionError, createMeal, deleteMeal, pantryCheck, removeMealIngredient, renameMeal, setMealIngredient,
  setPantryNeeded, toggleMeal
} from '../data/actions';
import { currentTrip, mealCost, mealItems, money, selectedMealIds, sortedMeals } from '../data/selectors';
import { store, useStore } from '../data/useStore';
import { ProductPicker, Sheet, Stepper } from '../ui/common';
import { Check, Close, Pencil, Plus, Search } from '../ui/icons';
import { notify } from '../ui/toast';

export function MealsPage() {
  const { view } = useStore();
  const trip = currentTrip(view);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = selectedMealIds(view, trip?.id);
  const meals = useMemo(() => {
    const all = sortedMeals(view);
    const needle = q.trim().toLowerCase();
    return all
      .filter((m) => !needle || m.name.toLowerCase().includes(needle))
      .map((m) => ({ meal: m, cost: mealCost(view, m.id), items: mealItems(view, m.id) }))
      .sort((a, b) => a.cost - b.cost || a.meal.name.localeCompare(b.meal.name));
  }, [view, q]);
  const picked = [...selected].map((id) => view.meals[id]).filter(Boolean);
  const pickedCost = picked.reduce((s, m) => s + mealCost(view, m.id), 0);
  const pantry = pantryCheck(view, trip);

  if (!trip) return <div className="empty">Getting this week ready…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan meals</h1>
          <p>Pick what you'll cook. Ingredients go straight onto the Dinner list.</p>
        </div>
        <button type="button" className="btn" onClick={() => setCreating(true)}><Plus size={16} /> New meal</button>
      </div>
      <div className="meal-layout">
        <div className="meal-grid-wrap">
          <label className="picker-box" style={{ borderStyle: 'solid', marginBottom: 12, height: 44 }}>
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meals" aria-label="Search meals" />
          </label>
          <div className="meal-grid">
            {meals.map(({ meal, cost, items }) => {
              const on = selected.has(meal.id);
              const main = items.filter((i) => !i.pantry).map((i) => view.products[i.product_id].name + (i.qty > 1 ? ` ×${i.qty}` : ''));
              const base = items.filter((i) => i.pantry).map((i) => view.products[i.product_id].name);
              return (
                <div key={meal.id} style={{ position: 'relative' }}>
                  <button
                    type="button" className="meal-card" aria-pressed={on} style={{ width: '100%', height: '100%' }}
                    onClick={() => store.commit(toggleMeal(store.getSnapshot().view, trip, meal.id))}
                  >
                    <span className="meal-tick" aria-hidden><Check size={12} /></span>
                    <span className="meal-name">{meal.name}</span>
                    <span className="meal-price">{money(cost)}</span>
                    <span className="meal-ings">{main.join(' · ') || 'No ingredients yet'}</span>
                    {base.length > 0 && <span className="meal-ings" style={{ fontSize: 12 }}>Pantry: {base.join(', ')}</span>}
                  </button>
                  <button type="button" className="icon-btn meal-edit" aria-label={`Edit ${meal.name}`} onClick={() => setEditing(meal.id)}>
                    <Pencil size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          {meals.length === 0 && <div className="empty">No meals match “{q}”.</div>}
        </div>

        <aside>
          <section className="card card-pad" style={{ padding: 18 }}>
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>This week · {picked.length}</h2>
              <span className="num" style={{ fontWeight: 700 }}>{money(pickedCost)}</span>
            </div>
            {picked.length === 0 && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>Tap a meal to add it.</p>}
            {picked.map((m, i) => (
              <div key={m.id} className="row-flex" style={{ marginTop: 6 }}>
                <span className="muted num" style={{ width: 18 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{m.name}</span>
                <span className="muted num">{money(mealCost(view, m.id))}</span>
                <button type="button" className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => store.commit(toggleMeal(store.getSnapshot().view, trip, m.id))}>
                  <Close size={14} />
                </button>
              </div>
            ))}
          </section>

          {pantry.length > 0 && (
            <section className="card card-pad" style={{ padding: 18, background: 'var(--meal-soft)', borderColor: 'var(--meal-line)' }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>Pantry check</h2>
              <p className="muted" style={{ margin: '4px 0 10px', fontSize: 13 }}>These meals also use basics you usually have. Need any?</p>
              {pantry.map((p) => (
                <div key={p.productId} className="row-flex" style={{ padding: '6px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{view.products[p.productId].name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{p.meals.join(', ')}</div>
                  </div>
                  <div className="toggle2" role="group" aria-label={view.products[p.productId].name}>
                    <button type="button" aria-pressed={!p.onList} onClick={() => store.commit(setPantryNeeded(store.getSnapshot().view, trip, p.productId, false))}>Have it</button>
                    <button type="button" aria-pressed={p.onList} onClick={() => store.commit(setPantryNeeded(store.getSnapshot().view, trip, p.productId, true))}>Add</button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <a href="#/plan" className="btn primary big block">Back to the list</a>
        </aside>
      </div>

      {editing && <MealEditor mealId={editing} onClose={() => setEditing(null)} />}
      {creating && (
        <NewMealSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setEditing(id); }}
        />
      )}
    </>
  );
}

function NewMealSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { view } = useStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <Sheet title="New meal" onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        try {
          const { ops, id } = createMeal(view, name);
          store.commit(ops);
          onCreated(id);
        } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      }}>
        <div className="field">
          <label htmlFor="meal-name">Name</label>
          <input id="meal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Next: ingredients</button>
        </div>
      </form>
    </Sheet>
  );
}

function MealEditor({ mealId, onClose }: { mealId: string; onClose: () => void }) {
  const { view } = useStore();
  const meal = view.meals[mealId];
  const [name, setName] = useState(meal?.name ?? '');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!meal) return null;
  const items = mealItems(view, mealId);
  const inMeal = new Set(items.map((i) => i.product_id));
  const commitName = () => {
    if (name.trim() === meal.name) return;
    try {
      store.commit(renameMeal(view, mealId, name));
      setError('');
    } catch (e) { setError(e instanceof ActionError ? e.message : String(e)); }
  };
  return (
    <Sheet title="Edit meal" sub={`Estimated ${money(mealCost(view, mealId))} for the ingredients (pantry items not counted).`} onClose={() => { commitName(); onClose(); }} wide>
      <div className="field">
        <label htmlFor="edit-meal-name">Name</label>
        <input id="edit-meal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} />
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div>
        <div className="label" style={{ marginBottom: 4 }}>Ingredients</div>
        {items.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Add the products this meal needs.</p>}
        {items.map((mi) => (
          <div className="ing-row" key={mi.id}>
            <span className="name">{view.products[mi.product_id].name}</span>
            <span className="muted num" style={{ fontSize: 12 }}>{money(view.products[mi.product_id].price)}</span>
            <div className="toggle2" role="group" aria-label={`Type for ${view.products[mi.product_id].name}`}>
              <button type="button" aria-pressed={!mi.pantry} onClick={() => store.commit(setMealIngredient(view, mealId, mi.product_id, { pantry: false }))}>Buy</button>
              <button type="button" aria-pressed={mi.pantry} onClick={() => store.commit(setMealIngredient(view, mealId, mi.product_id, { pantry: true }))}>Pantry</button>
            </div>
            <Stepper value={mi.qty} label={view.products[mi.product_id].name} onChange={(n) => store.commit(setMealIngredient(view, mealId, mi.product_id, { qty: Math.max(1, n) }))} />
            <button type="button" className="icon-btn" aria-label={`Remove ${view.products[mi.product_id].name}`} onClick={() => store.commit(removeMealIngredient(mi.id))}>
              <Close size={14} />
            </button>
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          <ProductPicker placeholder="Add an ingredient…" exclude={inMeal} onPick={(pid) => store.commit(setMealIngredient(store.getSnapshot().view, mealId, pid, { qty: 1, pantry: false }))} />
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          “Pantry” items are basics you usually have; picking the meal asks about them instead of adding them.
        </p>
      </div>
      <div className="sheet-actions">
        {confirmDelete ? (
          <button type="button" className="btn danger" onClick={() => {
            store.commit(deleteMeal(view, mealId));
            notify(`Deleted ${meal.name}`);
            onClose();
          }}>Yes, delete it</button>
        ) : (
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete meal</button>
        )}
        <button type="button" className="btn primary" onClick={() => { commitName(); onClose(); }}>Done</button>
      </div>
    </Sheet>
  );
}
