import { useState } from 'react';
import { ApiError } from '../data/api';
import { store } from '../data/useStore';
import { Check } from '../ui/icons';

export function SetupPage() {
  const [url, setUrl] = useState(import.meta.env.DEV ? '/api' : '');
  const [key, setKey] = useState(import.meta.env.DEV ? 'dev' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await store.connect({ apiUrl: url.trim(), key: key.trim() });
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.code === 'unauthorized' ? 'That access key is not right.' : e.message);
      } else {
        setError('Could not reach that address. Check the web app URL and your connection.');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup">
      <div className="brand"><span className="brand-mark"><Check size={18} /></span>Aisle</div>
      <h1>Connect to your list</h1>
      <ol>
        <li>In your Google Sheet, open <strong>Aisle app → Connect a device</strong>.</li>
        <li>Copy the web app address and the access key into the boxes below. You only do this once per device.</li>
      </ol>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <div className="field">
          <label htmlFor="api-url">Web app address</label>
          <input id="api-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" required />
        </div>
        <div className="field">
          <label htmlFor="api-key">Access key</label>
          <input id="api-key" className="input" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="btn primary big" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
      </form>
    </main>
  );
}
