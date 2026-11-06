import { useMemo, useState } from 'react';
import { addToTrip, finishTrip, setShopStatus, startShopping, updateProduct, type Leftovers } from '../data/actions';
import { currentTrip, money, plural, shopModel, sortedDepartments, sortedSections, todayIso, type ShopRow } from '../data/selectors';
import type { Trip } from '../data/types';
import { store, useStore } from '../data/useStore';
import { DeptSelect, ProductPicker, Sheet, ShelfPriceField, shelfToSaved } from '../ui/common';
import { Check } from '../ui/icons';
import { notify } from '../ui/toast';

type Filter = 'all' | 'todo' | 'done';

export function ShopPage() {
  const { view } = useStore();
  const trip = currentTrip(view);
  const model = useMemo(() => shopModel(view, trip), [view, trip]);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<ShopRow | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const depts = sortedDepartments(view);
  const keyOf = new Map(depts.map((d, i) => [d.id, i + 1]));

  if (!trip) return <div className="empty">Getting this week ready…</div>;

  const toggle = (r: ShopRow) => {
    const next = r.status === 'in_cart' ? 'todo' : 'in_cart';
    store.commit([...startShopping(trip), ...setShopStatus(view, trip, r.productId, next)]);
  };

  const visible = model.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => filter === 'all' || (filter === 'todo' ? r.status === 'todo' : r.status !== 'todo')) }))
    .filter((g) => g.rows.length);
  const left = model.count - model.done;

  return (
    <>
      <div className="shop-head">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Shopping</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {model.done} of {plural(model.count, 'item')} · {left} left{model.skipped ? ` · ${model.skipped} out of stock` : ''}
            </div>
          </div>
        </div>
        <div className="shop-totals">
          <div>
            <span className="cart">{money(model.cart)}</span>
            <span className="muted" style={{ fontSize: 13, marginLeft: 6 }}>in cart</span>
          </div>
          <div className="muted num" style={{ fontSize: 13 }}>Est. total <strong style={{ color: 'var(--ink)' }}>{money(model.total)}</strong></div>
        </div>
        <div className="progress" aria-hidden><div style={{ width: `${model.total ? (model.cart / model.total) * 100 : 0}%` }} /></div>
        <div className="seg" role="group" aria-label="Show">
          {([['all', 'All'], ['todo', 'To get'], ['done', 'In cart']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      {model.count + model.skipped === 0 && (
        <div className="empty">
          Nothing on the list yet. <a href="#/plan">Plan this week</a> or add something below.
        </div>
      )}
      {model.count > 0 && visible.length === 0 && (
        <div className="empty">{filter === 'todo' ? 'Everything is in the cart.' : 'Nothing checked off yet.'}</div>
      )}

      {visible.map((g) => {
        const all = model.groups.find((x) => x.dept?.id === g.dept?.id)!;
        const remaining = all.rows.filter((r) => r.status === 'todo').length;
        return (
          <section key={g.dept?.id ?? 'none'} aria-label={g.dept?.name ?? 'No department'}>
            <div className="dept-head">
              <span className="dept-key">{g.dept ? keyOf.get(g.dept.id) : '?'}</span>
              <h2>{g.dept?.name ?? 'No department'}</h2>
              <span className="left">{remaining ? `${remaining} left` : 'Done'}</span>
            </div>
            <div className="shop-list">
              {g.rows.map((r) => (
                <div key={r.productId} className={`shop-row${r.status === 'in_cart' ? ' done' : ''}${r.status === 'skipped' ? ' skipped' : ''}`}>
                  <button type="button" className="shop-check" aria-pressed={r.status === 'in_cart'} onClick={() => toggle(r)}>
                    <span className="tick" aria-hidden><Check /></span>
                    <span className="label">{r.product.name}</span>
                    {r.status === 'skipped' && <span className="pill warn">Out of stock</span>}
                    {r.qty > 1 && r.status !== 'skipped' && <span className="qty-badge">×{r.qty}</span>}
                  </button>
                  <button type="button" className="shop-price" aria-label={`Edit price or department for ${r.product.name}`} onClick={() => setEditing(r)}>
                    <span>{money(r.total)}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <div className="shop-foot">
        <ProductPicker placeholder="Add something to the list…" onPick={(pid) => setAdding(pid)} />
        {model.count + model.skipped > 0 && (
          <button type="button" className="btn big block primary" onClick={() => setFinishing(true)}>Finish trip</button>
        )}
        <p className="muted" style={{ textAlign: 'center', fontSize: 13, margin: 0 }}>Tap a price to fix it or move an item to another department.</p>
      </div>

      {editing && <EditSheet row={editing} trip={trip} onClose={() => setEditing(null)} />}
      {finishing && <FinishSheet trip={trip} onClose={() => setFinishing(false)} />}
      {adding && (
        <Sheet title={`Add ${view.products[adding]?.name}`} sub="Which part of the list?" onClose={() => setAdding(null)}>
          <div className="stack" style={{ gap: 10 }}>
            {sortedSections(view).map((s) => (
              <button key={s.id} type="button" className="btn big block" onClick={() => {
                store.commit(addToTrip(store.getSnapshot().view, trip, s.id, adding, 1));
                notify(`Added ${view.products[adding]?.name}`);
                setAdding(null);
              }}>{s.name}</button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

function EditSheet({ row, trip, onClose }: { row: ShopRow; trip: Trip; onClose: () => void }) {
  const { view } = useStore();
  const product = view.products[row.productId];
  const [shelf, setShelf] = useState('');
  const [dept, setDept] = useState(product.dept_id);
  const [error, setError] = useState('');
  const save = () => {
    const price = shelfToSaved(shelf, view);
    if (price !== undefined && !isFinite(price)) return setError('Enter the shelf price like 3.29, or leave it blank.');
    try {
      const fields: { price?: number; dept_id?: string } = {};
      if (price !== undefined && price !== product.price) fields.price = price;
      if (dept !== product.dept_id) fields.dept_id = dept;
      if (Object.keys(fields).length) store.commit(updateProduct(view, product.id, fields));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const skipped = row.status === 'skipped';
  return (
    <Sheet title={product.name} sub={`Saved price ${money(product.price)}${row.qty > 1 ? ` each · you need ${row.qty}` : ''}. Changes apply to every future list.`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <ShelfPriceField id="shelf-price" value={shelf} onChange={setShelf} current={product.price} big />
        <div className="field">
          <label htmlFor="shelf-dept">Department (store order)</label>
          <DeptSelect id="shelf-dept" value={dept} onChange={setDept} view={view} />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
        <button
          type="button" className="btn block"
          onClick={() => {
            store.commit(setShopStatus(view, trip, product.id, skipped ? 'todo' : 'skipped'));
            onClose();
          }}
        >
          {skipped ? 'Back on the list' : 'Out of stock today'}
        </button>
      </form>
    </Sheet>
  );
}

/** "Finish trip" on Shop and "Reset List" on Plan: the same step under two names. */
export function FinishSheet({ trip, onClose, title = 'Finish trip', after = '#/plan' }: {
  trip: Trip; onClose: () => void; title?: string; after?: string;
}) {
  const { view } = useStore();
  const model = shopModel(view, trip);
  const [date, setDate] = useState(todayIso());
  const rowsAll = model.groups.flatMap((g) => g.rows);
  const unchecked = rowsAll.filter((r) => r.status === 'todo');
  const outOfStock = rowsAll.filter((r) => r.status === 'skipped');
  // Nothing checked off usually means the store trip wasn't tracked in the app: assume it was all bought.
  const [leftovers, setLeftovers] = useState<Leftovers>(model.done === 0 ? 'bought' : 'carry');
  const boughtCount = model.done + (leftovers === 'bought' ? unchecked.length : 0);
  const them = unchecked.length === 1 ? 'it' : 'them';
  const finish = () => {
    store.commit(finishTrip(view, trip, date, leftovers));
    onClose();
    notify(`List reset: ${plural(boughtCount, 'item')} saved to your history`);
    location.hash = after;
  };
  const option = (value: Leftovers, label: string) => (
    <label className="radio-row">
      <input type="radio" name="leftovers" value={value} checked={leftovers === value} onChange={() => setLeftovers(value)} />
      <span>{label}</span>
    </label>
  );
  return (
    <Sheet title={title} sub="Saves what you bought to your history and starts next week's list. Staples stay; this week's extras clear." onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); finish(); }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <span>Checked off</span><strong className="num">{plural(model.done, 'item')} · {money(model.cart)}</strong>
          </div>
          {unchecked.length > 0 && (
            <div className="row-flex muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span>Not checked off</span><span className="num">{plural(unchecked.length, 'item')}</span>
            </div>
          )}
          {outOfStock.length > 0 && (
            <div className="row-flex muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span>Out of stock</span><span className="num">{plural(outOfStock.length, 'item')}</span>
            </div>
          )}
        </div>
        {unchecked.length > 0 && (
          <fieldset className="radio-group">
            <legend className="label">The {plural(unchecked.length, 'item')} not checked off</legend>
            {option('carry', `Put ${them} on next week's list`)}
            {option('bought', `Count ${them} as bought`)}
            {option('drop', `Leave ${them} off next week`)}
          </fieldset>
        )}
        {outOfStock.length > 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {leftovers === 'drop' ? 'Out-of-stock items will be left off too.' : 'Out-of-stock items go on next week\'s list.'}
          </p>
        )}
        <div className="field">
          <label htmlFor="trip-date">Trip date</label>
          <input id="trip-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{title}</button>
        </div>
      </form>
    </Sheet>
  );
}
