import { useEffect, useMemo, useState } from 'react';
import {
  ActionError, createDepartment, deleteDepartment, moveDepartment, renameDepartment, updateProduct
} from '../data/actions';
import { plural, productStats, rows, shortDate, sortedDepartments, type ProductStats } from '../data/selectors';
import type { Product, Tables } from '../data/types';
import { store, useStore } from '../data/useStore';
import { DeptSelect, ProductSheet } from '../ui/common';
import { Close, Down, Plus, Search, Up } from '../ui/icons';
import { notify } from '../ui/toast';

const PAGE = 120;

export function ProductsPage() {
  const [tab, setTab] = useState<'products' | 'departments'>('products');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tab === 'products' ? 'Products' : 'Departments'}</h1>
          <p>{tab === 'products' ? 'Every change saves right away.' : 'In the order you walk through the store.'}</p>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'products'} onClick={() => setTab('products')}>Products</button>
        <button type="button" aria-pressed={tab === 'departments'} onClick={() => setTab('departments')}>Departments</button>
      </div>
      {tab === 'products' ? <ProductList /> : <DepartmentList />}
    </>
  );
}

function ProductList() {
  const { view } = useStore();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const stats = productStats(view);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows(view.products)
      .filter((p) => p.active)
      .filter((p) => !dept || p.dept_id === dept)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .filter((p) => !onlyDue || stats.get(p.id)?.due)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [view.products, q, dept, onlyDue, stats]);
  const total = rows(view.products).filter((p) => p.active).length;

  return (
    <>
      <div className="toolbar">
        <label className="picker-box search" style={{ borderStyle: 'solid', height: 44 }}>
          <Search size={16} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={`Search ${total} products`} aria-label="Search products" />
        </label>
        <select className="select" style={{ width: 'auto', flex: '0 1 220px' }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {sortedDepartments(view).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="row-flex" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Due for restock
        </label>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New product</button>
      </div>
      <div className="card table-wrap">
        <table className="ptable">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" style={{ width: 200 }}>Department</th>
              <th scope="col" style={{ width: 100, textAlign: 'right' }}>Price</th>
              <th scope="col" style={{ width: 190 }}>History</th>
              <th scope="col" style={{ width: 48 }}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((p) => <ProductRow key={p.id} p={p} view={view} s={stats.get(p.id)} />)}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">No products match.</div>}
      </div>
      {list.length > limit && (
        <button type="button" className="btn block" style={{ marginTop: 12 }} onClick={() => setLimit(limit + PAGE)}>
          Show more ({list.length - limit} more)
        </button>
      )}
      {adding && <ProductSheet initialName={q} onClose={() => setAdding(false)} onSaved={(id) => notify(`Added ${store.getSnapshot().view.products[id]?.name ?? 'product'}`)} />}
    </>
  );
}

function ProductRow({ p, view, s }: { p: Product; view: Tables; s?: ProductStats }) {
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(p.price.toFixed(2));
  useEffect(() => setName(p.name), [p.name]);
  useEffect(() => setPrice(p.price.toFixed(2)), [p.price]);
  const save = (fields: Partial<Product>) => {
    try {
      store.commit(updateProduct(store.getSnapshot().view, p.id, fields));
    } catch (e) {
      notify(e instanceof ActionError ? e.message : String(e));
      setName(p.name);
      setPrice(p.price.toFixed(2));
    }
  };
  const archive = () => {
    store.commit(updateProduct(view, p.id, { active: false }));
    notify(`Removed ${p.name}`, { label: 'Undo', run: () => store.commit(updateProduct(store.getSnapshot().view, p.id, { active: true })) });
  };
  return (
    <tr>
      <td className="c-name">
        <input
          className="cell-input" value={name} aria-label="Product name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== p.name && save({ name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="c-dept">
        <DeptSelect className="cell-input" value={p.dept_id} view={view} label={`Department for ${p.name}`} onChange={(v) => save({ dept_id: v })} />
      </td>
      <td className="c-price" style={{ textAlign: 'right' }}>
        <input
          className="cell-input price" value={price} inputMode="decimal" aria-label={`Price of ${p.name}`}
          onChange={(e) => setPrice(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const n = parseFloat(price.replace('$', ''));
            if (!isFinite(n)) setPrice(p.price.toFixed(2));
            else if (n !== p.price) save({ price: n });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="c-hist">
        {s?.last ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {shortDate(s.last)}{s.cycle ? ` · every ${Math.round(s.cycle)} d` : ''}{' '}
            {s.due && <span className="pill warn">Due</span>}
          </span>
        ) : <span className="muted" style={{ fontSize: 13 }}>Not bought yet</span>}
      </td>
      <td className="c-act">
        <button type="button" className="icon-btn" aria-label={`Remove ${p.name}`} title="Remove product" onClick={archive}><Close size={16} /></button>
      </td>
    </tr>
  );
}

function DepartmentList() {
  const { view } = useStore();
  const depts = sortedDepartments(view);
  const counts = new Map<string, number>();
  for (const p of rows(view.products)) if (p.active) counts.set(p.dept_id, (counts.get(p.dept_id) ?? 0) + 1);
  const [newName, setNewName] = useState('');
  return (
    <>
      <div className="card">
        {depts.map((d, i) => (
          <DeptRow key={d.id} id={d.id} name={d.name} n={i + 1} count={counts.get(d.id) ?? 0} first={i === 0} last={i === depts.length - 1} />
        ))}
      </div>
      <form
        className="row-flex" style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const { ops } = createDepartment(view, newName);
            store.commit(ops);
            setNewName('');
          } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
        }}
      >
        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New department" aria-label="New department name" />
        <button type="submit" className="btn primary" style={{ height: 44 }}>Add</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>The shopping list follows this order. Move departments when the store rearranges.</p>
    </>
  );
}

function DeptRow({ id, name, n, count, first, last }: { id: string; name: string; n: number; count: number; first: boolean; last: boolean }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const act = (fn: () => ReturnType<typeof moveDepartment>) => {
    try { store.commit(fn()); } catch (e) { notify(e instanceof Error ? e.message : String(e)); setValue(name); }
  };
  return (
    <div className="dept-row">
      <span className="dept-key">{n}</span>
      <input
        className="cell-input" style={{ flex: 1 }} value={value} aria-label={`Name of department ${n}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== name && act(() => renameDepartment(store.getSnapshot().view, id, value))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="muted num" style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>{plural(count, 'item')}</span>
      <button type="button" className="icon-btn" aria-label={`Move ${name} earlier`} disabled={first} onClick={() => act(() => moveDepartment(store.getSnapshot().view, id, -1))}><Up /></button>
      <button type="button" className="icon-btn" aria-label={`Move ${name} later`} disabled={last} onClick={() => act(() => moveDepartment(store.getSnapshot().view, id, 1))}><Down /></button>
      <button type="button" className="icon-btn" aria-label={`Delete ${name}`} onClick={() => act(() => deleteDepartment(store.getSnapshot().view, id))}><Close size={16} /></button>
    </div>
  );
}
