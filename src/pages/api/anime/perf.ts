import type { NextApiRequest, NextApiResponse } from 'next';
import { perfLog, perfSnapshot } from '@/lib/store/perf';

/**
 * The perf ledger's two doors (see `lib/store/perf.ts`).
 *
 *   GET  — a snapshot: uptime (a restart shows as a small one), heap against its
 *          limit, and what the last row rebuild cost and why. A pure read: it
 *          does NOT touch the store, so polling it cannot warm the cache and hide
 *          the thing being measured.
 *   POST — the browser's side of a slow load, written to `perf.log` as a
 *          `client` line. That half is what tells a slow SERVER from time the
 *          server never saw: the browser queueing the request, the network, or
 *          the render.
 *
 * The POST body is untrusted input written to a log file, so only whitelisted
 * fields pass, numbers as numbers and strings capped.
 */

const NUMERIC_FIELDS = [
  'fetchMs', 'renderMs', 'sinceNavMs', 'queueMs', 'connectMs', 'ttfbMs', 'downloadMs', 'serverMs', 'kb',
] as const;
const STRING_FIELDS = ['page', 'url', 'kind', 'rows'] as const;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return res.status(200).json(perfSnapshot());

    case 'POST': {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const key of NUMERIC_FIELDS) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) fields[key] = Math.round(v);
      }
      for (const key of STRING_FIELDS) {
        const v = body[key];
        if (typeof v === 'string') fields[key] = v.slice(0, 120);
      }
      perfLog('client', fields);
      return res.status(204).end();
    }

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
