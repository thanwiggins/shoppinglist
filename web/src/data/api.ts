import type { Op, TableName } from './types';

export interface Config {
  apiUrl: string;
  key: string;
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type Rows = Partial<Record<TableName, Array<{ id: string; deleted?: boolean }>>>;
export interface BootstrapResponse { ok: true; version: number; epoch: string; tables: Rows }
export interface SyncResponse { ok: true; version: number; epoch: string; changes: Rows; reset?: boolean }

export type Transport = (config: Config, body: Record<string, unknown>) => Promise<unknown>;

/**
 * POSTs as text/plain so the browser skips the CORS pre-flight (Apps Script can't answer it).
 * Apps Script replies with a redirect to the actual JSON, which fetch follows.
 */
export const fetchTransport: Transport = async (config, body) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: config.key }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    if (!res.ok) throw new ApiError('http', `Server error ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError('bad_response', 'The address did not answer like the Aisle API. Check the web app URL.');
    }
  } finally {
    clearTimeout(timer);
  }
};

export async function call<T>(transport: Transport, config: Config, body: Record<string, unknown>): Promise<T> {
  const res = (await transport(config, body)) as { ok?: boolean; code?: string; error?: string };
  if (!res || res.ok !== true) throw new ApiError(res?.code || 'error', res?.error || 'Unknown server error');
  return res as T;
}

export function bootstrap(transport: Transport, config: Config) {
  return call<BootstrapResponse>(transport, config, { action: 'bootstrap' });
}

export function sync(transport: Transport, config: Config, since: number, epoch: string, ops: Op[]) {
  return call<SyncResponse>(transport, config, { action: 'sync', since, epoch, ops });
}
