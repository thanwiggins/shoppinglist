import { useMemo, useState } from 'react';
import {
  addToTrip, bestSectionFor, moveStaple, removeFromTrip, setQty, toggleStaple
} from '../data/actions';
import {
  currentTrip, lastFinishedTrip, money, planModel, productStats, rows, selectedMealIds, settingNumber,
  shortDate, sortedSections, type GroupKind, type PlanItem, type PlanSection
} from '../data/selectors';
import type { Tables, Trip } from '../data/types';
import { store, useStore } from '../data/useStore';
import { ProductPicker, ProductSheet, SECTION_COLORS, Sheet, Stepper } from '../ui/common';
import { Arrow, Down, Pin, Up } from '../ui/icons';
import { notify } from '../ui/toast';

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
  const tax = settingNumber(view, 'tax_rate') ?? 0;
  const budget = settingNumber(view, 'budget');
  const colors = new Map(sortedSections(view).map((s, i) => [s.id, SECTION_COLORS[i % SECTION_COLORS.length]]));

  if (!trip) return <div className="empty">Getting this week ready…</div>;

  return (
    <>
      <section className="card card-pad summary" aria-label="Summary">
        <div className="summary-top">
          <div>
            <h1>Plan this week</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {model.count} {model.count === 1 ? 'item' : 'items'} on the list{last ? ` · last trip ${shortDate(last.date)}` : ''}
            </p>
          </div>
          <div className="total-block">
            <div className="eyebrow">Estimated total</div>
            <div className="total">{money(model.total)}</div>
            {(tax > 0 || budget) && (
              <div className="muted num" style={{ fontSize: 13 }}>
                {tax > 0 && `≈ ${money(model.total * (1 + tax / 100))} with tax`}
                {tax > 0 && budget ? ' · ' : ''}
                {budget ? (model.total * (1 + tax / 100) > budget
                  ? <span style={{ color: 'var(--warn)' }}>{money(model.total * (1 + tax / 100) - budget)} over budget</span>
                  : `${money(budget - model.total * (1 + tax / 100))} under budget`) : ''}
              </div>
            )}
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
        <DueForRestock trip={trip} />
      </section>

      <div className="sections">
        {model.sections.map((s) => (
          <SectionCard key={s.section.id} s={s} trip={trip} color={colors.get(s.section.id)!} view={view} />
        ))}
      </div>

      <div className="row-flex" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <p className="footnote">
          Pinned items are staples: they show up every week, at zero until you need them. Everything else clears after the trip.
        </p>
        <a className="btn primary" href="#/shop" style={{ marginTop: 16 }}>Start shopping <Arrow size={16} /></a>
      </div>
    </>
  );
}

function SectionCard({ s, trip, color, view }: { s: PlanSection; trip: Trip; color: string; view: Tables }) {
  const isMealSection = s.groups.some((g) => g.kind === 'meal') || s.section.name.toLowerCase() === 'dinner';
  const meals = isMealSection ? [...selectedMealIds(view, trip.id)].map((id) => view.meals[id]).filter(Boolean) : [];
  const onList = useMemo(() => new Set(s.groups.flatMap((g) => g.items.map((i) => i.productId))), [s]);
  return (
    <section className="card section-card" aria-label={s.section.name}>
      <header className="section-head">
        <span className="swatch" style={{ background: color }} />
        <h2>{s.section.name}</h2>
        <span className="muted" style={{ fontSize: 12 }}>{s.count} {s.count === 1 ? 'item' : 'items'}</span>
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
          {g.items.map((it) => <PlanRow key={it.productId} it={it} trip={trip} view={view} />)}
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

function PlanRow({ it, trip, view }: { it: PlanItem; trip: Trip; view: Tables }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const pinned = !!it.staple;
  const name = it.product.name;
  const togglePin = () => {
    store.commit(toggleStaple(view, it.sectionId, it.productId));
    notify(pinned ? `${name} is no longer a staple` : `${name} will show up every week`);
  };
  return (
    <div className={`plan-row${it.qty ? '' : ' zero'}`}>
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
            <button type="button" className="btn big block" onClick={() => { setMenu(false); setEditing(true); }}>Edit price, name or department</button>
            <button type="button" className="btn big block" onClick={() => { togglePin(); setMenu(false); }}>
              {pinned ? 'Unpin: stop showing every week' : 'Pin as a weekly staple'}
            </button>
            {pinned && (
              <div className="row-flex">
                <button type="button" className="btn big" style={{ flex: 1 }} onClick={() => store.commit(moveStaple(view, it.staple!.id, -1))}><Up /> Move up</button>
                <button type="button" className="btn big" style={{ flex: 1 }} onClick={() => store.commit(moveStaple(view, it.staple!.id, 1))}><Down /> Move down</button>
              </div>
            )}
            {!pinned && (
              <button type="button" className="btn big block danger" onClick={() => { store.commit(removeFromTrip(view, trip, it.sectionId, it.productId)); setMenu(false); }}>
                Remove from this week
              </button>
            )}
          </div>
        </Sheet>
      )}
      {editing && <ProductSheet product={it.product} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Suggestions from purchase history: things you usually buy by now that aren't on the list. */
function DueForRestock({ trip }: { trip: Trip }) {
  const { view } = useStore();
  const [picking, setPicking] = useState<string | null>(null);
  const due = useMemo(() => {
    const stats = productStats(view);
    const onList = new Set(rows(view.trip_items).filter((i) => i.trip_id === trip.id && i.qty > 0).map((i) => i.product_id));
    return [...stats.entries()]
      // Skip things you've stopped buying: more than three cycles overdue.
      .filter(([pid, s]) => s.due && s.count >= 2 && s.daysSince! <= s.cycle! * 3 && !onList.has(pid) && view.products[pid]?.active)
      .sort((a, b) => (b[1].daysSince! / b[1].cycle!) - (a[1].daysSince! / a[1].cycle!))
      .slice(0, 8)
      .map(([pid, s]) => ({ product: view.products[pid], s }));
  }, [view, trip.id]);
  if (!due.length) return null;
  const add = (pid: string, sectionId: string) => {
    store.commit(addToTrip(store.getSnapshot().view, trip, sectionId, pid, 1));
    notify(`Added ${view.products[pid].name} to ${view.sections[sectionId]?.name}`);
  };
  return (
    <div className="due-row">
      <span className="eyebrow" style={{ marginRight: 4 }}>Usually bought by now</span>
      {due.map(({ product, s }) => (
        <button
          key={product.id} type="button" className="chip chip-btn"
          title={`Last bought ${s.daysSince} days ago; usually every ${Math.round(s.cycle!)} days`}
          onClick={() => {
            const sec = bestSectionFor(view, product.id);
            if (sec && view.sections[sec]) add(product.id, sec);
            else setPicking(product.id);
          }}
        >
          <Plus12 /> {product.name}
        </button>
      ))}
      {picking && (
        <Sheet title={`Add ${view.products[picking].name}`} sub="Which part of the list?" onClose={() => setPicking(null)}>
          <div className="stack" style={{ gap: 10 }}>
            {sortedSections(view).map((sec) => (
              <button key={sec.id} type="button" className="btn big block" onClick={() => { add(picking, sec.id); setPicking(null); }}>{sec.name}</button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

const Plus12 = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
