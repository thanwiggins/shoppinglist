import { useState } from 'react';
import { setSetting } from '../data/actions';
import { savedPrice } from '../data/pricing';
import { money, setting } from '../data/selectors';
import { store, useStore } from '../data/useStore';
import { notify } from '../ui/toast';

export function SettingsPage() {
  const s = useStore();
  const { view } = s;
  const [tax, setTax] = useState(setting(view, 'tax_rate', '0'));
  const [budget, setBudget] = useState(setting(view, 'budget', ''));
  const [confirmOut, setConfirmOut] = useState(false);
  const saveNumber = (key: string, value: string) => {
    const clean = value.trim() === '' ? '' : String(parseFloat(value.replace(/[$%]/g, '')) || 0);
    if (clean !== setting(view, key, '')) store.commit(setSetting(key, clean));
  };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Settings</h1></div></div>

      <section className="card card-pad stack">
        <h2 style={{ margin: 0, fontSize: 17 }}>Sync</h2>
        <div className="muted">
          {s.syncState === 'error' ? <span style={{ color: 'var(--warn)' }}>{s.syncError}</span>
            : s.syncState === 'offline' ? s.syncError
            : s.pending ? `${s.pending} changes waiting to sync` : 'Everything is saved to your Google Sheet.'}
          {s.lastSyncAt && <> · last synced {new Date(s.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</>}
        </div>
        <div className="row-flex" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void store.syncNow()}>Sync now</button>
          <button type="button" className="btn" onClick={() => store.download().then(() => notify('Downloaded a fresh copy'), () => notify('Could not reach the server'))}>
            Download everything again
          </button>
          {s.syncState === 'error' && s.pending > 0 && (
            <button type="button" className="btn danger" onClick={() => { store.discardPending(); notify('Unsent changes discarded'); }}>
              Discard {s.pending} unsent changes
            </button>
          )}
        </div>
      </section>

      <section className="card card-pad stack">
        <h2 style={{ margin: 0, fontSize: 17 }}>Prices and budget</h2>
        <div className="row-flex" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="tax">Sales tax (%)</label>
            <input id="tax" className="input num" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} onBlur={() => saveNumber('tax_rate', tax)} />
          </div>
          <div className="field" style={{ width: 200 }}>
            <label htmlFor="budget">Weekly budget ($)</label>
            <input id="budget" className="input num" inputMode="decimal" value={budget} placeholder="No budget" onChange={(e) => setBudget(e.target.value)} onBlur={() => saveNumber('budget', budget)} />
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          You type shelf prices; Aisle saves them with tax added, rounded up to the next 50¢
          (or down, if it's within 10¢ of the step below). Example: a $3.29 shelf price saves
          as <strong className="num">{money(savedPrice(3.29, parseFloat(tax) || 0))}</strong>
          {parseFloat(tax) ? ` at ${parseFloat(tax)}%` : ''}. Prices you've already saved don't change.
        </p>
      </section>

      <section className="card card-pad stack">
        <h2 style={{ margin: 0, fontSize: 17 }}>This device</h2>
        <div className="muted" style={{ wordBreak: 'break-all', fontSize: 13 }}>Connected to {s.config?.apiUrl}</div>
        <div>
          {confirmOut ? (
            <button type="button" className="btn danger" onClick={() => void store.disconnect()}>
              {s.pending ? `Disconnect and lose ${s.pending} unsynced changes` : 'Yes, disconnect this device'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmOut(true)}>Disconnect this device</button>
          )}
        </div>
      </section>
    </div>
  );
}
