/**
 * /boxes — « Mes boîtes », box-first.
 *
 * **The inversion is the whole point.** The page this replaces asked an
 * O(titles × boxes) question — 473 franchise groups down the page, a 26-chip row
 * under each, 12,298 cells — and the evidence that nobody answers it 473 times is
 * the coverage: 108 of 720 watched titles (15%) filed anywhere at all, and 13 of
 * the 26 boxes still empty after two labeling sessions. Here the page IS the list
 * of boxes, and each one says what it holds and what it means.
 *
 * See docs/boxesV2/DESIGN.md §5. It was built alongside the chip grid it replaces
 * and swapped over it in one commit (§2), so nothing here ever had to keep the
 * old O(titles × boxes) page working.
 *
 * Writes are optimistic and incremental (`add`/`remove`, never a full `members`
 * replacement) for the reason the chip rows already were: this page fires many
 * writes against many boxes, and a client-side read-modify-write would let the
 * second clobber the first.
 */
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useT } from '@/lib/i18n';
import BoxCard from '@/components/anime/boxes/BoxCard';
import type { BoxListResponse, BoxSummary } from '../api/anime/boxes';

export default function BoxesV2Page() {
  const t = useT();
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/boxes');
      if (!res.ok) throw new Error('boxes');
      setBoxes(((await res.json()) as BoxListResponse).boxes);
      setError('');
    } catch {
      setError(t('boxes.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  /**
   * Every write reloads the list rather than patching state locally.
   *
   * The card renders `top` and `unitCount`, both computed SERVER-side from the
   * collapse — so a local patch would have to re-derive the units in the browser
   * to keep the strip and the count honest, which is the one thing that must not
   * drift from what the ranker sees. One cheap request instead.
   */
  const write = useCallback(async (boxId: string, body: Record<string, unknown>, method = 'PUT') => {
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('write');
      await load();
    } catch {
      setError(t('boxes.saveError'));
    }
  }, [load, t]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch('/api/anime/boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error('create');
      setName(''); setEmoji(''); setDescription('');
      await load();
    } catch {
      setError(t('boxes.saveError'));
    }
  }, [name, emoji, description, load, t]);

  return (
    <>
      <Head><title>{t('boxes.title')} — Anime Tracker</title></Head>

      <div className="bx2">
        <header className="bx2-head">
          <h1>📦 {t('boxes.title')}</h1>
          <p className="bx2-sub">{t('boxes.subtitle')}</p>
        </header>

        <section className="bx2-create">
          <input
            className="bx2-emoji"
            value={emoji}
            onChange={e => setEmoji(e.target.value)}
            placeholder="📦"
            aria-label="emoji"
            maxLength={4}
          />
          <input
            className="bx2-name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder={t('boxes.namePlaceholder')}
            aria-label={t('boxes.namePlaceholder')}
          />
          <input
            className="bx2-desc"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder={t('boxes.descPlaceholder')}
            aria-label={t('boxes.descPlaceholder')}
          />
          <button type="button" className="bx2-btn" onClick={create} disabled={!name.trim()}>
            {t('boxes.createAction')}
          </button>
        </section>

        {error && <p className="bx2-error">{error}</p>}

        {loading ? (
          <p className="bx2-note">{t('common.loading')}</p>
        ) : boxes.length === 0 ? (
          <p className="bx2-note">{t('boxes.noBoxes')}</p>
        ) : (
          boxes.map(box => (
            <BoxCard
              key={box.id}
              box={box}
              href={`/boxes/${encodeURIComponent(box.id)}`}
              onPatch={patch => write(box.id, patch, 'PATCH')}
              onAdd={id => write(box.id, { add: [id] })}
              onRemove={ids => write(box.id, { remove: ids })}
            />
          ))
        )}
      </div>

      {/* Scoped block: everything below is markup this component returns itself,
          so styled-jsx's scope class reaches all of it. `BoxCard` styles itself
          through a CSS Module precisely because a rule here would NOT reach it. */}
      <style jsx>{`
        .bx2 { max-width: 1100px; margin: 0 auto; padding: 16px 20px 48px; }
        .bx2-head h1 { font-size: 1.5rem; margin: 0 0 4px; }
        .bx2-sub { color: var(--text-muted); font-size: 0.88rem; margin: 0 0 18px; }

        .bx2-create {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 18px;
        }
        .bx2-emoji { width: 3rem; text-align: center; }
        .bx2-name { width: 220px; }
        .bx2-desc { flex: 1; min-width: 240px; }
        .bx2-create input {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px 10px;
          color: var(--text-primary);
          font-size: 0.88rem;
        }
        .bx2-create input:focus { border-color: var(--accent-primary); outline: none; }

        .bx2-btn {
          background: var(--accent-primary);
          border: 1px solid var(--accent-primary);
          border-radius: 6px;
          color: #fff;
          font-size: 0.85rem;
          padding: 6px 16px;
          cursor: pointer;
        }
        .bx2-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .bx2-btn:hover:not(:disabled) { background: var(--accent-hover); }

        .bx2-note { color: var(--text-muted); font-size: 0.88rem; padding: 20px 0; }
        .bx2-error { color: var(--accent-danger, #f87171); font-size: 0.85rem; }
      `}</style>
    </>
  );
}
