import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import AnimePicker from '../AnimePicker';
import { useT } from '@/lib/i18n';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import type { GroupSummary } from '@/lib/domain/groupSummary';
import type { FranchiseComponentResponse } from '@/pages/api/anime/franchise-component';
import styles from './GroupBlade.module.css';

/**
 * « Mes regroupements » — create or edit one group.
 *
 * ⚠️ **A blade, not a modal** (§4). At the 1280 CSS px TV target a modal would
 * cover the pane being filed, and the pane IS the context the decision is made
 * in: "are these four cours one thing" is answered while looking at what else is
 * in the box.
 *
 * **Seeded from the provider relation component with every entry checked.**
 * "This whole show is one thing" is the common case and carving out is the
 * exception, so the cheap path is to accept and the expensive one is to think.
 * The graph is a suggestion the group is drawn from, never an authority it obeys
 * — that is the whole of « on my terms ».
 *
 * Four details from §4 that are easy to drop and each load-bearing:
 *
 * - **Unwatched entries stay listable and checkable.** They are inert until one
 *   is filed, and then it arrives already grouped. So this list is NOT the
 *   watched list.
 * - **Entries already in another group are labelled with that group's name** —
 *   informational, never blocking. A title may belong to several groups (the
 *   owner picks different subsets depending on what a box is about), but an
 *   overlap must be visible BEFORE it merges something: two declared groups that
 *   overlap fuse into one unit in the vote.
 * - **A picker**, so a title the relation graph does not connect can be added,
 *   and so a standalone title with no component can still start a group.
 * - **The name is pre-filled** from the component's earliest aired member, so
 *   « Bleach » arrives typed.
 *
 * ⚠️ It writes the group DEFINITION only. Declaring it on a box, and filing any
 * membership, are the caller's business — `groups` is a lens over `members`, and
 * a declaration that added membership would make the two sources of truth that
 * can drift.
 */
export interface GroupBladeProps {
  /**
   * What the blade opens on.
   *  - `{ seedFrom }` — a canonical id; the component is fetched and checked.
   *  - `{ group }` — an existing definition to edit.
   */
  seedFrom?: string;
  group?: GroupSummary;
  /** Every group, so an entry already in one can say so. */
  allGroups: GroupSummary[];
  /** Called with the saved group; the caller decides what to do about the box. */
  onSaved: (group: GroupSummary, created: boolean) => void;
  onClose: () => void;
}

/** A row in the blade: the title, and whether it is in the group being drawn. */
interface BladeRow {
  row: LeanAnimeRow;
  checked: boolean;
}

const GroupBlade: React.FC<GroupBladeProps> = ({ seedFrom, group, allGroups, onSaved, onClose }) => {
  const t = useT();
  const [name, setName] = useState(group?.name ?? '');
  const [rows, setRows] = useState<BladeRow[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /**
   * Where the app header stops.
   *
   * The blade must sit UNDER the site nav rather than over it — it is a blade,
   * not a modal, so the rest of the app stays usable — but the header is
   * `position: sticky; z-index: 100` and the blade is `fixed`, so a plain
   * `top: 0` puts the blade's own title behind it. Found on screen: the group
   * name input rendered half-hidden under the nav bar.
   *
   * Measured rather than hardcoded because the header's height is its padding
   * plus its content, and that content WRAPS onto a second line on a narrow
   * viewport — a 68px constant would be wrong exactly when the layout is
   * tightest.
   */
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      const rect = document.querySelector('.header')?.getBoundingClientRect();
      setTop(rect ? Math.max(0, rect.bottom) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Escape closes. The blade is the topmost surface while open, so it owns the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (group) {
          // Editing: the group's own members, all checked. The component is not
          // re-seeded — the carve already happened and re-proposing what was
          // deliberately left out would undo it on every open.
          const res = await fetch(`/api/anime/groups/${encodeURIComponent(group.id)}`);
          // The group GET ships full `rows` for exactly this; `preview` is the
          // index's 5-row slice and would silently truncate the carve.
          const data: { rows?: LeanAnimeRow[] } = res.ok ? await res.json() : {};
          if (!cancelled) setRows((data.rows ?? group.preview).map(row => ({ row, checked: true })));
        } else if (seedFrom) {
          const res = await fetch(`/api/anime/franchise-component?id=${encodeURIComponent(seedFrom)}`);
          if (!res.ok) throw new Error('component');
          const data: FranchiseComponentResponse = await res.json();
          if (cancelled) return;
          setRows(data.entries.map(row => ({ row, checked: true })));
          setFocusId(data.id);
          setName(n => n || data.name);
        }
      } catch {
        if (!cancelled) setError(t('groups.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seedFrom, group, t]);

  /** Which OTHER groups already hold a title — a client-side set test. */
  const otherGroups = useMemo(() => {
    const byAnime = new Map<string, string[]>();
    for (const g of allGroups) {
      if (group && g.id === group.id) continue;
      for (const id of g.members) {
        const list = byAnime.get(id);
        if (list) list.push(g.name);
        else byAnime.set(id, [g.name]);
      }
    }
    return byAnime;
  }, [allGroups, group]);

  const toggle = (id: string) =>
    setRows(prev => prev.map(r => (r.row.id === id ? { ...r, checked: !r.checked } : r)));

  const add = useCallback((row: LeanAnimeRow) => {
    setRows(prev => (prev.some(r => r.row.id === row.id) ? prev : [...prev, { row, checked: true }]));
  }, []);

  const checked = rows.filter(r => r.checked);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || checked.length === 0) return;
    setSaving(true);
    try {
      const members = checked.map(r => r.row.id);
      // `members` wholesale rather than add/remove: the blade IS the "save this
      // exact carve" action, and the set on screen is what the owner means.
      const res = group
        ? await fetch(`/api/anime/groups/${encodeURIComponent(group.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ members }),
          })
        : await fetch('/api/anime/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed, members }),
          });
      if (!res.ok) throw new Error('save');
      const saved = (await res.json()).group;
      // A rename rides separately: PUT owns membership, PATCH owns the name.
      if (group && trimmed !== group.name) {
        await fetch(`/api/anime/groups/${encodeURIComponent(group.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
      }
      onSaved({ ...saved, name: trimmed, members }, !group);
    } catch {
      setError(t('groups.saveError'));
    } finally {
      setSaving(false);
    }
  }, [name, checked, group, onSaved, t]);

  return (
    <>
      {/* Click-outside closes, but the scrim is transparent: the pane behind must
          stay readable, which is the reason this is a blade at all. */}
      <div className={styles.scrim} style={{ top }} onClick={onClose} aria-hidden="true" />

      <aside className={styles.blade} style={{ top }} role="dialog" aria-label={t('groups.bladeTitle')}>
        <header className={styles.head}>
          <h2 className={styles.title}>{group ? t('groups.editTitle') : t('groups.bladeTitle')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.clear')}>×</button>
        </header>

        <input
          className={styles.name}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('groups.namePlaceholder')}
          aria-label={t('groups.namePlaceholder')}
        />

        <p className={styles.hint}>{t('groups.bladeHint')}</p>

        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <p className={styles.note}>{t('common.loading')}</p>
        ) : (
          <ul className={styles.rows}>
            {rows.map(({ row, checked: on }) => {
              const others = otherGroups.get(row.id);
              return (
                <li key={row.id} className={`${styles.row} ${row.id === focusId ? styles.rowFocus : ''}`}>
                  <label className={styles.rowLabel}>
                    <input type="checkbox" checked={on} onChange={() => toggle(row.id)} />
                    {row.picture ? (
                      <Image src={row.picture} alt="" width={30} height={42} className={styles.poster} unoptimized />
                    ) : (
                      <span className={styles.poster} aria-hidden="true" />
                    )}
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{row.title}</span>
                      <span className={styles.rowMeta}>
                        {row.year ?? '—'}
                        {row.mediaType ? ` · ${row.mediaType.toUpperCase()}` : ''}
                        {/* Not a warning and not a block: overlap is legal and
                            sometimes the point. It just must not be a surprise. */}
                        {others ? ` · ${t('groups.alsoIn', { names: others.join(', ') })}` : ''}
                        {/* An unwatched entry is inert until one is filed — worth
                            saying, since this list is deliberately not the
                            watched list. */}
                        {!row.status ? ` · ${t('groups.unwatched')}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {/* The relation graph misses real connections (a spin-off filed as
            `other`, a title with no AniList entry at all), so a group must be
            completable by hand. */}
        <div className={styles.picker}>
          <AnimePicker
            picked={new Set(rows.map(r => r.row.id))}
            // `mean` is `number | null` on a search hit and optional on a lean
            // row — the picker's shape is the search API's, not the store's.
            onPick={hit => add({
              id: hit.id,
              title: hit.title,
              picture: hit.poster,
              year: hit.year,
              mediaType: hit.mediaType,
              ...(hit.mean === null ? {} : { mean: hit.mean }),
            })}
            placeholder={t('groups.addTitle')}
          />
        </div>

        <footer className={styles.foot}>
          <span className={styles.count}>{t('groups.selected', { count: checked.length })}</span>
          <button type="button" className={styles.cancel} onClick={onClose}>{t('groups.cancel')}</button>
          <button
            type="button"
            className={styles.save}
            onClick={save}
            disabled={saving || !name.trim() || checked.length === 0}
          >
            {saving ? t('groups.saving') : t('groups.save')}
          </button>
        </footer>
      </aside>
    </>
  );
};

export default GroupBlade;
