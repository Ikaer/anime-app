/**
 * A durable SET of canonical ids in one JSON file — the shape of
 * `user/hidden.json`, `user/reco_ignored.json` and `user/seed_mutes.json`, which
 * were three byte-identical read / add / remove blocks before this.
 *
 * Only the mechanics live here. What each set MEANS — and therefore where it is
 * filed (`store/` for `hidden`, which is on the seven-slice join, `reco/` for
 * the two engine annotations, which are not) — stays with its own module, which
 * wraps this under its own names. `onChange` is how `hidden` keeps invalidating
 * the row cache while the two `reco/` sets, off the join, do not.
 *
 * Writes go through `writeJsonFile`, so the `jsonStore` shared-reference
 * contract holds: `add` mutates the parsed array and writes it straight back.
 *
 * Server-only (uses `fs` via `jsonStore`).
 */
import { dataFile, readJsonFile, writeJsonFile } from './jsonStore';

export interface IdSetStore {
  /** The ids, in insertion order. A shared parse — do not mutate without writing. */
  list(): string[];
  /** The same ids as a `Set`, for per-candidate membership tests. */
  set(): Set<string>;
  /** Adds the id; returns whether the file changed. */
  add(canonicalId: string): boolean;
  /** Removes the id; returns whether the file changed. */
  remove(canonicalId: string): boolean;
}

export function createIdSetStore(relativePath: string, onChange?: () => void): IdSetStore {
  const file = dataFile(relativePath);
  const list = () => readJsonFile<string[]>(file, []);
  return {
    list,
    set: () => new Set(list()),
    add(canonicalId) {
      const ids = list();
      if (ids.includes(canonicalId)) return false;
      ids.push(canonicalId);
      writeJsonFile(file, ids);
      onChange?.();
      return true;
    },
    remove(canonicalId) {
      const ids = list();
      const next = ids.filter(id => id !== canonicalId);
      if (next.length === ids.length) return false;
      writeJsonFile(file, next);
      onChange?.();
      return true;
    },
  };
}
