import { useMemo, useState } from 'react';
import { addToTrip, removeFromTrip, reorderStaples, reorderTripItems, setQty, toggleStaple } from '../data/actions';
import {
  currentTrip, lastFinishedTrip, money, plural, planModel, selectedMealIds, settingNumber,
  shortDate, sortedSections, type GroupKind, type PlanItem, type PlanSection
} from '../data/selectors';
import type { Tables, Trip } from '../data/types';
import { store, useStore } from '../data/useStore';
import { ProductPhotoSheet, ProductPicker, ProductSheet, SECTION_COLORS, Sheet, Stepper, Thumb, safeLink } from '../ui/common';
import { Arrow, Grip, Pin } from '../ui/icons';
import { Sortable, type GripProps } from '../ui/Sortable';
import { notify } from '../ui/toast';
import { FinishSheet } from './ShopPage';

const GROUP_LABEL: Record<GroupKind, [string, string]> = {
  staple: ['Staples', 'Every week'],
  meal: ['From meals', 'Added by meal plan'],
  added: ['Added this week', 'Clears after the trip']
};

export function PlanPage() {
  const { view } = useStore();
  const trip = currentTrip(view);
  const model = useMemo(() => planModel(view, trip), [view, trip]);
  const last = lastFinishedTrip(view);
  const budget = settingNumber(view, 'budget');
  const colors = new Map(sortedSections(view).map((s, i) => [s.id, SECTION_COLORS[i % SECTION_COLORS.length]]));
  const [resetting, setResetting] = useState(false);

  if (!trip) return <div className="empty">Getting this week ready…</div>;

  return (
    <>
      <section className="card card-pad summary" aria-label="Summary">
        <div className="summary-top">
          <div>
            <h1>Plan this week</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {plural(model.count, 'item')} on the list{last ? ` · last trip ${shortDate(last.date)}` : ''}
            </p>
          </div>
          <div className="total-block">
            <div className="eyebrow">Estimated total</div>
            <div className="total">{money(model.total)}</div>
            {budget ? (
              <div className="muted num" style={{ fontSize: 13 }}>
                {model.total > budget
                  ? <span style={{ color: 'var(--warn)' }}>{money(model.total - budget)} over budget</span>
                  : `${money(budget - model.total)} under budget`}
              </div>
            ) : null}
          </div>
        </div>
        <div className="balance" aria-hidden>
          {model.sections.map((s) => (
            <div key={s.section.id} style={{ width: `${model.total ? (s.total / model.total) * 100 : 0}%`, background: colors.get(s.section.id) }} />
          ))}
        </div>
        <div className="legend">
          {model.sections.map((s) => (
            <div className="legend-item" key={s.section.id}>
              <span className="swatch" style={{ background: colors.get(s.section.id) }} />
              <strong>{s.section.name}</strong>
              <span className="muted num">{money(s.total)} · {model.total ? Math.round((s.total / model.total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </section>

      <div className="sections">
        {model.sections.map((s) => (
          <SectionCard key={s.section.id} s={s} trip={trip} color={colors.get(s.section.id)!} view={view} />
        ))}
      </div>

      <div className="plan-foot">
        <p className="footnote">
          Pinned items are staples: they show up every week, at zero until you need them. Everything else clears when you reset the list.
          Drag <Grip size={14} /> to reorder.
        </p>
        <div className="row-flex" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setResetting(true)}>Reset List</button>
          <a className="btn primary" href="#/shop">Start shopping <Arrow size={16} /></a>
        </div>
      </div>

      {resetting && <FinishSheet trip={trip} title="Reset List" after="#/plan" onClose={() => setResetting(false)} />}
    </>
  );
}

function SectionCard({ s, trip, color, view }: { s: PlanSection; trip: Trip; color: string; view: Tables }) {
  const isMealSection = s.groups.some((g) => g.kind === 'meal') || s.section.name.toLowerCase() === 'dinner';
  const meals = isMealSection ? [...selectedMealIds(view, trip.id)].map((id) => view.meals[id]).filter(Boolean) : [];
  const onList = useMemo(() => new Set(s.groups.flatMap((g) => g.items.map((i) => i.productId))), [s]);

  const reorder = (kind: GroupKind, items: PlanItem[], keys: string[]) => {
    const current = store.getSnapshot().view;
    if (kind === 'staple') {
      store.commit(reorderStaples(current, s.section.id, keys));
    } else {
      const byProduct = new Map(items.map((i) => [i.productId, i.item!.id]));
      store.commit(reorderTripItems(current, keys.map((k) => byProduct.get(k)!)));
    }
  };

  return (
    <section className="card section-card" aria-label={s.section.name}>
      <header className="section-head">
        <span className="swatch" style={{ background: color }} />
        <h2>{s.section.name}</h2>
        <span className="muted" style={{ fontSize: 12 }}>{plural(s.count, 'item')}</span>
        <span className="total">{money(s.total)}</span>
      </header>
      {isMealSection && (
        <div className="meals-strip">
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">Meals · {meals.length}</span>
            <a href="#/meals" className="link-btn" style={{ fontSize: 13, textDecoration: 'none' }}>Plan meals</a>
          </div>
          {meals.length > 0 ? (
            <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
              {meals.map((m) => <span className="chip" key={m.id}>{m.name}</span>)}
            </div>
          ) : <span className="muted" style={{ fontSize: 13 }}>No meals picked yet.</span>}
        </div>
      )}
      {s.groups.map((g) => (
        <div key={g.kind}>
          <div className="group-head">
            <span className="eyebrow">{GROUP_LABEL[g.kind][0]}</span>
            <span className="hint">{GROUP_LABEL[g.kind][1]}</span>
          </div>
          <Sortable
            items={g.items}
            getKey={(it) => it.productId}
            onReorder={(keys) => reorder(g.kind, g.items, keys)}
            render={(it, grip) => <PlanRow it={it} trip={trip} view={view} grip={grip} />}
          />
        </div>
      ))}
      <div className="add-wrap">
        <ProductPicker
          placeholder={`Add to ${s.section.name}…`}
          exclude={onList}
          onPick={(pid) => store.commit(addToTrip(store.getSnapshot().view, trip, s.section.id, pid, 1))}
        />
      </div>
    </section>
  );
}

function PlanRow({ it, trip, view, grip }: { it: PlanItem; trip: Trip; view: Tables; grip: GripProps }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photo, setPhoto] = useState(false);
  const link = safeLink(it.product.link);
  const pinned = !!it.staple;
  const name = it.product.name;
  const togglePin = () => {
    store.commit(toggleStaple(view, it.sectionId, it.productId));
    notify(pinned ? `${name} is no longer a staple` : `${name} will show up every week`);
  };
  return (
    <div className={`plan-row${it.qty ? '' : ' zero'}`}>
      <button type="button" className="grip" aria-label={`Reorder ${name} (drag, or use the up and down arrow keys)`} title="Drag to reorder" {...grip}>
        <Grip size={16} />
      </button>
      <button
        type="button" className={`icon-btn pin${pinned ? ' on' : ''}`} onClick={togglePin}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${name} (stop showing it every week)` : `Pin ${name} as a weekly staple`}
        title={pinned ? 'Staple: shows every week. Click to unpin.' : 'Pin as a weekly staple'}
      >
        <Pin filled={pinned} />
      </button>
      <button type="button" className="info" onClick={() => setMenu(true)} aria-label={`${name}: options`} title="Edit, pin or remove">
        <span className="name">{name}</span>
        <span className="price">{money(it.product.price)}{it.qty > 1 ? ` each · ${money(it.product.price * it.qty)}` : ''}</span>
      </button>
      <Stepper value={it.qty} label={name} onChange={(n) => store.commit(setQty(store.getSnapshot().view, trip, it.sectionId, it.productId, n))} />
      {menu && (
        <Sheet title={name} sub={`${money(it.product.price)} · ${view.departments[it.product.dept_id]?.name ?? 'No department'}`} onClose={() => setMenu(false)}>
          <div className="stack" style={{ gap: 10 }}>
            {link && (
              <button type="button" className="btn big block thumb-row" onClick={() => { setMenu(false); setPhoto(true); }}>
                <Thumb href={link} size={34} /> See what it looks like
              </button>
            )}
            <button type="button" className="btn big block" onClick={() => { setMenu(false); setEditing(true); }}>
              {link ? 'Edit price, name, department or link' : 'Edit price, name, department or add a photo'}
            </button>
            <button type="button" className="btn big block" onClick={() => { togglePin(); setMenu(false); }}>
              {pinned ? 'Unpin: stop showing every week' : 'Pin as a weekly staple'}
            </button>
            {!pinned && (
              <button type="button" className="btn big block danger" onClick={() => { store.commit(removeFromTrip(view, trip, it.sectionId, it.productId)); setMenu(false); }}>
                Remove from this week
              </button>
            )}
          </div>
        </Sheet>
      )}
      {editing && <ProductSheet product={it.product} focusPrice onClose={() => setEditing(false)} />}
      {photo && <ProductPhotoSheet product={it.product} onClose={() => setPhoto(false)} />}
    </div>
  );
}
