import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cleanLink, createProduct, updateProduct } from '../data/actions';
import { parsePrice, savedPrice } from '../data/pricing';
import { money, searchProducts, settingNumber, sortedDepartments } from '../data/selectors';
import type { Product, Tables } from '../data/types';
import { store, useStore } from '../data/useStore';
import { Close, LinkIcon, Plus } from './icons';

/* ---------------- Sheet: bottom sheet on phones, dialog on larger screens ---------------- */

export function Sheet({ title, sub, onClose, children, wide }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // A field marked data-autofocus wins; otherwise the first control. (React's autoFocus can
    // lose to the previous sheet handing focus back, so the sheet decides here.)
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)');
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

/**
 * A shelf-price input with a live preview of the price Aisle will save
 * (tax added, rounded to 50¢ — see data/pricing.ts). Blank means "leave the price as it is"
 * when `current` is given.
 */
export function ShelfPriceField({ id, value, onChange, current, big, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; current?: number; big?: boolean; autoFocus?: boolean;
}) {
  const { view } = useStore();
  const tax = settingNumber(view, 'tax_rate') ?? 0;
  const shelf = parsePrice(value);
  const saved = savedPrice(shelf, tax);
  const typed = value.trim() !== '';
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>Shelf price</label>
      <div className="input-money">
        <span>$</span>
        <input
          id={id} className={`input num${big ? ' big' : ''}`} inputMode="decimal" autoComplete="off" value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={current !== undefined ? 'Leave blank to keep' : '0.00'}
          aria-describedby={hintId} data-autofocus={autoFocus ? '' : undefined}
        />
      </div>
      <div id={hintId} className="price-preview" aria-live="polite">
        {typed && isFinite(shelf) ? (
          <>Saves as <strong className="num">{money(saved)}</strong>{' '}
            <span className="muted">({money(shelf)}{tax ? ` + ${tax}% tax` : ''}, rounded to 50¢)</span></>
        ) : typed ? (
          <span className="form-error">Enter a price like 3.29</span>
        ) : current !== undefined ? (
          <span className="muted">Saved price now <span className="num">{money(current)}</span></span>
        ) : (
          <span className="muted">{tax ? `Adds ${tax}% tax and rounds to 50¢.` : 'Rounds to 50¢. Set your sales tax in Settings.'}</span>
        )}
      </div>
    </div>
  );
}

/** Reads a ShelfPriceField's text: undefined = left blank, NaN = not a price, else the saved price. */
export function shelfToSaved(text: string, view: Tables): number | undefined {
  if (!text.trim()) return undefined;
  const shelf = parsePrice(text);
  if (!isFinite(shelf)) return NaN;
  return savedPrice(shelf, settingNumber(view, 'tax_rate') ?? 0);
}

export function ProductSheet({ product, initialName = '', onClose, onSaved, title, focusPrice }: {
  product?: Product;
  initialName?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
  title?: string;
  focusPrice?: boolean;
}) {
  const { view } = useStore();
  const [name, setName] = useState(product?.name ?? initialName);
  const [shelf, setShelf] = useState('');
  const [dept, setDept] = useState(product?.dept_id ?? '');
  const [link, setLink] = useState(product?.link ?? '');
  const [error, setError] = useState('');
  const save = () => {
    const price = shelfToSaved(shelf, view);
    if (price !== undefined && !isFinite(price)) return setError('Enter a shelf price like 3.29.');
    if (!product && price === undefined) return setError('Enter the shelf price.');
    if (!dept) return setError('Choose a department.');
    try {
      if (product) {
        store.commit(updateProduct(view, product.id, { name, dept_id: dept, link, ...(price !== undefined ? { price } : {}) }));
        onSaved?.(product.id);
      } else {
        const { ops, id } = createProduct(view, { name, price: price!, dept_id: dept, link });
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
        <ShelfPriceField id="ps-price" value={shelf} onChange={setShelf} current={product?.price} autoFocus={focusPrice} />
        <div className="field">
          <label htmlFor="ps-dept">Department</label>
          <DeptSelect id="ps-dept" value={dept} onChange={setDept} view={view} placeholder />
        </div>
        <LinkField value={link} onChange={setLink} />
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{product ? 'Save' : 'Add product'}</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Photo or product-page link, with a small preview when it's a picture. */
function LinkField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const href = safeLink(value);
  return (
    <div className="field">
      <label htmlFor="ps-link">Photo or product page link <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
      <div className="row-flex">
        <input
          id="ps-link" className="input" type="text" inputMode="url" autoComplete="off" spellCheck={false}
          value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" aria-describedby="ps-link-hint"
        />
        {href && <Thumb href={href} size={44} />}
        {value && (
          <button type="button" className="icon-btn" aria-label="Remove the link" onClick={() => onChange('')}><Close size={16} /></button>
        )}
      </div>
      <div id="ps-link-hint" className="muted" style={{ fontSize: 12 }}>
        Helps you spot it in the store. A picture link shows right in the app; on a store’s website,
        right-click the product photo and choose “Copy image address”. A page link opens in a new tab.
      </div>
    </div>
  );
}

/** The link if it's a usable http(s) address, else ''. Never returns javascript: or other schemes. */
export function safeLink(text: string): string {
  try {
    return cleanLink(text);
  } catch {
    return '';
  }
}

/**
 * A small square showing the product's photo. If the link isn't a picture (or can't load),
 * it shows a link icon instead. Purely visual: wrap it in a button to make it tappable.
 */
export function Thumb({ href, size = 40 }: { href: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [href]);
  return (
    <span className="thumb" style={{ width: size, height: size }} aria-hidden>
      {failed
        ? <LinkIcon size={Math.round(size * 0.45)} />
        : <img src={href} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </span>
  );
}

/** Tappable thumbnail that opens the product's photo / link. */
export function ProductLinkButton({ product, size = 40, onOpen }: { product: Product; size?: number; onOpen: () => void }) {
  const href = safeLink(product.link);
  if (!href) return null;
  return (
    <button type="button" className="thumb-btn" onClick={onOpen} aria-label={`See a photo or link for ${product.name}`} title="See what it looks like">
      <Thumb href={href} size={size} />
    </button>
  );
}

/** Full-size photo (or the link, if it's a web page) for spotting a product in the store. */
export function ProductPhotoSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const { view } = useStore();
  const href = safeLink(product.link);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const host = href ? new URL(href).hostname.replace(/^www\./, '') : '';
  const dept = view.departments[product.dept_id]?.name;
  return (
    <Sheet title={product.name} sub={`${money(product.price)}${dept ? ` · ${dept}` : ''}`} onClose={onClose}>
      {href && state !== 'error' && (
        <div className="photo-frame">
          <img src={href} alt={`Photo of ${product.name}`} referrerPolicy="no-referrer" onLoad={() => setState('ok')} onError={() => setState('error')} />
        </div>
      )}
      {state === 'error' && (
        <p className="muted" style={{ margin: 0 }}>
          {navigator.onLine === false
            ? 'You’re offline, and this picture hasn’t been saved on this device yet.'
            : `This link goes to a web page on ${host}, not straight to a picture.`}
        </p>
      )}
      {href && (
        <a className="btn big block" href={href} target="_blank" rel="noopener noreferrer">
          {state === 'ok' ? 'Open full size' : `Open ${host}`}
        </a>
      )}
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
