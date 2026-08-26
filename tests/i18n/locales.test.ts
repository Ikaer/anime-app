/**
 * Whole-dictionary invariants over `fr.json` / `en.json`.
 *
 * `TranslationKey = keyof typeof fr` plus `DICTS: Record<Lang, Record<
 * TranslationKey, string>>` already makes a key present in fr and missing from
 * en a COMPILE error. Everything asserted here is what that typing cannot see:
 *
 *  - **Orphans in the other direction.** `en` is an imported JSON object, not a
 *    fresh object literal, so excess-property checking never runs on it: a key
 *    left in `en.json` after its `fr.json` counterpart was deleted type-checks
 *    forever. Nothing renders it and nothing complains.
 *  - **Empty strings.** `translate()` falls back on `??`, not on falsiness, so
 *    `""` is a successful lookup that renders as nothing at all.
 *  - **Placeholder drift.** `interpolate` replaces `{name}` only where the
 *    template has it. Drop the token from one language and that language
 *    silently loses the value — the sentence still reads as a sentence, which
 *    is exactly why nobody notices.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

const DICTS: Record<string, Record<string, string>> = { fr, en };

/** `{name}` tokens in a template, sorted — the interpolation contract. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
}

test('fr and en carry exactly the same keys', () => {
  const frKeys = Object.keys(fr).sort();
  const enKeys = Object.keys(en).sort();
  // Reported as two directed diffs rather than a deepEqual dump: at 765 keys
  // the assertion output otherwise says nothing about WHICH key moved.
  assert.deepEqual(frKeys.filter(k => !(k in en)), [], 'in fr.json but missing from en.json');
  assert.deepEqual(enKeys.filter(k => !(k in fr)), [], 'orphaned in en.json — fr.json is the canonical key set');
});

test('no translation is an empty string', () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const empty = Object.keys(dict).filter(k => dict[k].trim() === '');
    assert.deepEqual(empty, [], `empty values in ${lang}.json`);
  }
});

test('every key interpolates the same placeholders in both languages', () => {
  const drift = Object.keys(fr)
    .filter(k => k in en)
    .map(k => ({ key: k, fr: placeholders(fr[k as keyof typeof fr]), en: placeholders(en[k as keyof typeof en]) }))
    .filter(row => row.fr.join(',') !== row.en.join(','))
    .map(row => `${row.key}: fr={${row.fr}} en={${row.en}}`);
  assert.deepEqual(drift, []);
});

/**
 * ⚠️ The header dropdown's own ⚠️, made enforceable: *every entry carries an
 * emoji, including the diagnostic ones* — a menu where two thirds of the rows
 * have an icon reads as unfinished, and an iconless chip in the primary bar
 * renders shorter than its neighbours so the row stops lining up.
 *
 * The group HEADINGS are deliberately bare (they are labels, not destinations),
 * as is `nav.others`, the dropdown trigger. Those are the only exemptions; a
 * new `nav.*` key is assumed to be a destination and must lead with a glyph.
 */
test('every nav destination label leads with an emoji, in both languages', () => {
  const isHeading = (key: string) => key.startsWith('nav.group.') || key === 'nav.others';
  const destinations = Object.keys(fr).filter(k => k.startsWith('nav.') && !isHeading(k));

  assert.ok(destinations.length > 10, 'sanity: the nav families should not be empty');

  for (const [lang, dict] of Object.entries(DICTS)) {
    const bare = destinations.filter(k => (dict[k].codePointAt(0) ?? 0) < 0x80);
    assert.deepEqual(bare, [], `nav labels with no leading emoji in ${lang}.json`);
  }
});
