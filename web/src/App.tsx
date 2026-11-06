import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ensureTrip } from './data/actions';
import { currentTrip } from './data/selectors';
import { startBackgroundSync, store, useStore } from './data/useStore';
import { MealsPage } from './pages/MealsPage';
import { PlanPage } from './pages/PlanPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import { ShopPage } from './pages/ShopPage';
import { SyncBadge } from './ui/common';
import { Arrow, Check, Gear, MealIcon, PlanIcon, ShopIcon, TagIcon } from './ui/icons';
import { Toasts } from './ui/toast';

type Route = 'plan' | 'shop' | 'meals' | 'products' | 'settings';
const ROUTES: Route[] = ['plan', 'shop', 'meals', 'products', 'settings'];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  if (ROUTES.includes(r)) return r;
  return window.matchMedia('(max-width: 899px)').matches ? 'shop' : 'plan';
}

function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const snap = useStore();
  const route = useRoute();
  const topbar = useRef<HTMLElement>(null);

  useEffect(() => { void store.init(); startBackgroundSync(); }, []);

  // There is always an open trip to plan into.
  const needsTrip = snap.hasData && !currentTrip(snap.view);
  useEffect(() => { if (needsTrip) store.commit(ensureTrip(store.getSnapshot().view)); }, [needsTrip]);

  // Sticky department headers sit just under the top bar.
  useLayoutEffect(() => {
    const el = topbar.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });

  if (!snap.ready) return <div className="splash">Loading…</div>;
  if (!snap.config || !snap.hasData) return <><SetupPage /><Toasts /></>;

  const nav: [Route, string][] = [['plan', 'Plan'], ['shop', 'Shop'], ['meals', 'Meals'], ['products', 'Products']];
  const page = {
    plan: <PlanPage />,
    shop: <ShopPage />,
    meals: <MealsPage />,
    products: <ProductsPage />,
    settings: <SettingsPage />
  }[route];

  return (
    <div className="shell">
      <header className="topbar" ref={topbar}>
        <div className="topbar-inner">
          <a className="brand" href="#/plan"><span className="brand-mark"><Check size={18} /></span>Aisle</a>
          <nav className="nav" aria-label="Main">
            {nav.map(([r, label]) => <a key={r} href={`#/${r}`} aria-current={route === r ? 'page' : undefined}>{label}</a>)}
          </nav>
          <div className="topbar-right">
            <SyncBadge onClick={() => { location.hash = '#/settings'; }} />
            <a className="icon-btn" href="#/settings" aria-label="Settings" aria-current={route === 'settings' ? 'page' : undefined}><Gear /></a>
            {route === 'plan' && (
              <a className="btn primary hide-mobile" href="#/shop">Start shopping <Arrow size={16} /></a>
            )}
          </div>
        </div>
      </header>

      <main className={`main${route === 'shop' || route === 'settings' ? ' narrow' : ''}`}>{page}</main>

      <nav className="tabbar" aria-label="App">
        <a href="#/shop" aria-current={route === 'shop' ? 'page' : undefined}><ShopIcon />Shop</a>
        <a href="#/plan" aria-current={route === 'plan' ? 'page' : undefined}><PlanIcon />Plan</a>
        <a href="#/meals" aria-current={route === 'meals' ? 'page' : undefined}><MealIcon />Meals</a>
        <a href="#/products" aria-current={route === 'products' ? 'page' : undefined}><TagIcon />Products</a>
      </nav>
      <Toasts />
    </div>
  );
}
