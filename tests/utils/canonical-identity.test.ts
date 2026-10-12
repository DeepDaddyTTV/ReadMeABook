/** Component: Canonical Identity Tests | Documentation: documentation/features/canonical-identities.md */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { canonicalizeImport, parseCanonicalRules, readCanonicalRules } from '../../src/lib/utils/canonical-identity';

const raw = { version: 1, author_aliases: { 'Writer, A.': 'A. Writer' }, series_aliases: { 'Story--Series': 'Story Series' }, strip_audiobook_format_labels: true };
const metadata = { title: 'Book (Light Novel) (Part 1)', author: 'Writer, A.', series: 'Story--Series', seriesPart: '1.5', narrator: 'Narrator Name', asin: 'ASIN1' };
afterEach(() => vi.unstubAllEnvs());
describe('optional canonical import identities', () => {
  it('preserves exact current behavior when no file is configured', async () => {
    vi.stubEnv('CANONICAL_IDENTITIES_FILE', '');
    expect(await readCanonicalRules()).toBeNull();
    expect(canonicalizeImport(metadata, null, 'audiobook')).toBe(metadata);
  });
  it('normalizes only curated identities and redundant audiobook format labels', () => {
    expect(canonicalizeImport(metadata, parseCanonicalRules(raw), 'audiobook')).toEqual({ ...metadata, title: 'Book (Part 1)', author: 'A. Writer', series: 'Story Series' });
  });
  it('keeps ebook titles, narrators, sequence and ASIN intact', () => {
    const normalized = canonicalizeImport(metadata, parseCanonicalRules(raw), 'ebook');
    expect(normalized.title).toBe(metadata.title);
    expect(normalized.narrator).toBe(metadata.narrator);
    expect(normalized.seriesPart).toBe('1.5');
    expect(normalized.asin).toBe('ASIN1');
  });
  it('preserves unknown authors, series editions and abridgement labels', () => {
    const unknown = { ...metadata, author: 'Different Writer', series: 'Story Series (Color)', title: 'Book (Abridged)' };
    expect(canonicalizeImport(unknown, parseCanonicalRules(raw), 'audiobook')).toEqual(unknown);
  });
  it('does not resolve object prototype properties as unknown aliases', () => {
    const normalized = canonicalizeImport({ ...metadata, author: 'constructor', series: '__proto__' }, parseCanonicalRules({ version: 1 }), 'audiobook');
    expect(normalized.author).toBe('constructor');expect(normalized.series).toBe('__proto__');
  });
  it('uses exact identifier bindings ahead of provider spellings', () => {
    const rules = parseCanonicalRules({ ...raw, books_by_asin: { asin1: { authors: ['A. Writer'], series: [{ name: 'Story Series', sequence: '0.5' }] } } });
    const normalized = canonicalizeImport({ ...metadata, author: 'Provider Error' }, rules, 'audiobook');
    expect(normalized.author).toBe('A. Writer');
    expect(normalized.seriesPart).toBe('0.5');
  });
  it('clears an incorrect provider series for an explicitly identified standalone book', () => {
    const rules = parseCanonicalRules({ version: 1, books_by_asin: { ASIN1: { authors: ['A. Writer'], series: [] } } });
    const normalized = canonicalizeImport(metadata, rules, 'audiobook');
    expect(normalized.series).toBeUndefined();expect(normalized.seriesPart).toBeUndefined();
  });
  it('rejects aliases that conflict after Unicode/whitespace normalization', () => {
    expect(() => parseCanonicalRules({ version: 1, author_aliases: { 'A Writer': 'First', ' A  Writer ': 'Second' } })).toThrow('Ambiguous');
  });
  it('rejects explicitly ambiguous aliases and identifiers', () => {
    expect(() => canonicalizeImport(metadata, parseCanonicalRules({ ...raw, disabled_ambiguous_aliases: { series: ['story--series'] } }), 'audiobook')).toThrow('Ambiguous');
    expect(() => canonicalizeImport(metadata, parseCanonicalRules({ ...raw, disabled_ambiguous_asins: ['asin1'] }), 'audiobook')).toThrow('Ambiguous');
  });
  it('does not expose invalid configuration contents in errors', () => {
    expect(() => parseCanonicalRules({ version: 999, author_aliases: { private: '' } })).toThrow('Invalid canonical identity rules');
  });
  it('requires an absolute private file and fails on missing configured files', async () => {
    vi.stubEnv('CANONICAL_IDENTITIES_FILE', 'relative.json');
    await expect(readCanonicalRules()).rejects.toThrow('absolute');
    vi.stubEnv('CANONICAL_IDENTITIES_FILE', path.join(os.tmpdir(), 'does-not-exist-canonical-rules.json'));
    await expect(readCanonicalRules()).rejects.toThrow('unavailable or invalid');
  });
  it('reads mounted private rules without altering the file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-rules-'));
    try {
      const file = path.join(dir, 'rules.json');
      const text = JSON.stringify(raw);
      await fs.writeFile(file, text);
      vi.stubEnv('CANONICAL_IDENTITIES_FILE', file);
      expect((await readCanonicalRules())?.author_aliases['writer, a.']).toBe('A. Writer');
      expect(await fs.readFile(file, 'utf8')).toBe(text);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
