import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createProduct, updateProduct } from '../data/actions';
import { money, searchProducts, sortedDepartments } from '../data/selectors';
import type { Product, Tables } from '../data/types';
import { store, useStore } from '../data/useStore';
import { Close, Plus } from './icons';

/* ---------------- Sheet: bottom sheet on phones, dialog on larger screens ---------------- */

export function Sheet({ title, sub, onClose, children, wide }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim">
      <button type="button" className="scrim-close" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="sheet-handle" aria-hidden />
        <div className="row-flex" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId}>{title}</h2>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- Stepper ---------------- */

export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className={`stepper${value ? '' : ' zero'}`}>
      <button type="button" aria-label={`One fewer ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span aria-label={`${label} quantity`}>{value || '–'}</span>
      <button type="button" aria-label={`One more ${label}`} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

/* ---------------- Sync status ---------------- */

export function SyncBadge({ onClick }: { onClick?: () => void }) {
  const s = useStore();
  let label = 'Saved';
  if (s.syncState === 'syncing') label = s.pending ? `Saving ${s.pending}` : 'Syncing';
  else if (s.syncState === 'offline') label = s.pending ? `${s.pending} unsynced` : 'Offline';
  else if (s.syncState === 'error') label = 'Sync problem';
  else if (s.pending) label = `${s.pending} unsynced`;
  return (
    <button type="button" className={`sync ${s.syncState}${s.pending ? ' pending' : ''}`} onClick={onClick} title={s.syncError || 'All changes saved'}>
      <span className="dot" aria-hidden />
      {label}
    </button>
  );
}

/* ---------------- Product picker (search + create) ---------------- */

export function ProductPicker({ placeholder, onPick, exclude }: {
  placeholder: string;
  onPick: (productId: string) => void;
  exclude?: Set<string>;
}) {
  const { view } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const listId = useId();
  const results = useMemo(
    () => searchProducts(view, q, 8).filter((p) => !exclude?.has(p.id)),
    [view, q, exclude]
  );
  const exact = results.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());
  const options: Array<{ kind: 'product'; p: Product } | { kind: 'create' }> = [
    ...results.map((p) => ({ kind: 'product' as const, p })),
    ...(q.trim() && !exact ? [{ kind: 'create' as const }] : [])
  ];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'product') {
      onPick(o.p.id);
      setQ('');
      setOpen(false);
    } else {
      setCreating(q.trim());
      setOpen(false);
    }
  };
  return (
    <div className="picker">
      <label className="picker-box">
        <Plus size={16} />
        <input
          value={q}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        />
      </label>
      {open && options.length > 0 && (
        <div className="picker-list" role="listbox" id={listId}>
          {options.map((o, i) => o.kind === 'product' ? (
            <button
              type="button" role="option" key={o.p.id} aria-selected={i === active} className="picker-opt"
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}
            >
              <span className="name">{o.p.name}</span>
              <span className="meta num">{money(o.p.price)} · {view.departments[o.p.dept_id]?.name ?? 'No department'}</span>
            </button>
          ) : (
            <button
              type="button" role="option" key="create" aria-selected={i === active} className="picker-opt create"
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}
            >
              <Plus size={16} /> New product “{q.trim()}”
            </button>
          ))}
        </div>
      )}
      {creating !== null && (
        <ProductSheet
          initialName={creating}
          onClose={() => setCreating(null)}
          onSaved={(id) => { setCreating(null); setQ(''); onPick(id); }}
        />
      )}
    </div>
  );
}

/* ---------------- Add / edit a product ---------------- */

export function ProductSheet({ product, initialName = '', onClose, onSaved, title }: {
  product?: Product;
  initialName?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
  title?: string;
}) {
  const { view } = useStore();
  const [name, setName] = useState(product?.name ?? initialName);
  const [price, setPrice] = useState(product ? product.price.toFixed(2) : '');
  const [dept, setDept] = useState(product?.dept_id ?? '');
  const [error, setError] = useState('');
  const save = () => {
    const p = parseFloat(price.replace('$', ''));
    if (!dept) return setError('Choose a department.');
    try {
      if (product) {
        store.commit(updateProduct(view, product.id, { name, price: p, dept_id: dept }));
        onSaved?.(product.id);
      } else {
        const { ops, id } = createProduct(view, { name, price: p, dept_id: dept });
        store.commit(ops);
        onSaved?.(id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Sheet title={title ?? (product ? 'Edit product' : 'New product')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="field">
          <label htmlFor="ps-name">Name</label>
          <input id="ps-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="ps-price">Price</label>
          <div className="input-money">
            <span>$</span>
            <input id="ps-price" className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ps-dept">Department</label>
          <DeptSelect id="ps-dept" value={dept} onChange={setDept} view={view} placeholder />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{product ? 'Save' : 'Add product'}</button>
        </div>
      </form>
    </Sheet>
  );
}

export function DeptSelect({ id, value, onChange, view, placeholder, className = 'select', label }: {
  id?: string; value: string; onChange: (v: string) => void; view: Tables; placeholder?: boolean; className?: string; label?: string;
}) {
  const depts = sortedDepartments(view);
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {(placeholder || !value) && <option value="" disabled>Choose a department</option>}
      {depts.map((d, i) => <option key={d.id} value={d.id}>{i + 1} · {d.name}</option>)}
    </select>
  );
}

/** Colors for sections, by position; distinct in lightness as well as hue. */
export const SECTION_COLORS = ['#2F4858', '#C98A1E', '#3A7CA5', '#B5523B', '#6B5CA5', '#4F7F3A'];
