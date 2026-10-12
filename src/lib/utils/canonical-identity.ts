/**
 * Component: Canonical Import Identity Lookup
 * Documentation: documentation/features/canonical-identities.md
 */
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

const name = z.string().trim().min(1);
const rulesSchema = z.object({
  version: z.literal(1),
  author_aliases: z.record(name).default({}),
  series_aliases: z.record(name).default({}),
  books_by_asin: z.record(z.object({
    authors: z.array(name).min(1),
    series: z.array(z.object({ name, sequence: z.string().nullable().optional() })).default([]),
  })).default({}),
  disabled_ambiguous_aliases: z.object({ author: z.array(name).default([]), series: z.array(name).default([]) }).default({}),
  disabled_ambiguous_asins: z.array(name).default([]),
  strip_audiobook_format_labels: z.boolean().default(false),
});
export type CanonicalRules = z.infer<typeof rulesSchema>;
export interface ImportIdentity {
  title: string;
  author: string;
  asin?: string;
  series?: string;
  seriesPart?: string;
}
export function identityKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function parseCanonicalRules(input: unknown): CanonicalRules {
  const result = rulesSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid canonical identity rules');
  const rules = result.data;
  for (const field of ['author_aliases', 'series_aliases'] as const) {
    const map = rules[field];
    const normalized: Record<string, string> = Object.create(null);
    for (const [alias, canonical] of Object.entries(map)) {
      const key = identityKey(alias);
      if (!key || (normalized[key] && normalized[key] !== canonical)) throw new Error('Ambiguous canonical alias');
      normalized[key] = canonical;
    }
    rules[field] = normalized;
  }
  rules.disabled_ambiguous_aliases.author = rules.disabled_ambiguous_aliases.author.map(identityKey);
  rules.disabled_ambiguous_aliases.series = rules.disabled_ambiguous_aliases.series.map(identityKey);
  rules.disabled_ambiguous_asins = rules.disabled_ambiguous_asins.map(a => a.toUpperCase());
  const books: CanonicalRules['books_by_asin'] = Object.create(null);
  for (const [asin, book] of Object.entries(rules.books_by_asin)) {
    const id = asin.toUpperCase();
    if (books[id] && JSON.stringify(books[id]) !== JSON.stringify(book)) throw new Error('Ambiguous canonical identifier');
    books[id] = book;
  }
  rules.books_by_asin = books;
  return rules;
}
export async function readCanonicalRules(): Promise<CanonicalRules | null> {
  const file = process.env.CANONICAL_IDENTITIES_FILE;
  if (!file) return null;
  if (!path.isAbsolute(file)) throw new Error('Canonical identity file must be absolute');
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error();
    return parseCanonicalRules(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    // No private names, raw configuration or filesystem contents in job logs.
    throw new Error('Configured canonical identity file is unavailable or invalid');
  }
}
function stripFormat(value: string): string {
  return value.replace(/\s*\((?:light\s+)?novels?\)/gi, '').trim();
}
export function canonicalizeImport<T extends ImportIdentity>(metadata: T, rules: CanonicalRules | null, kind: 'audiobook' | 'ebook'): T {
  if (!rules) return metadata;
  const asin = metadata.asin?.toUpperCase();
  if (asin && rules.disabled_ambiguous_asins.includes(asin)) throw new Error('Ambiguous canonical book identifier');
  const book = asin ? rules.books_by_asin[asin] : undefined;
  const seriesKey = identityKey(metadata.series || '');
  const authorKey = identityKey(metadata.author);
  if (!book && (rules.disabled_ambiguous_aliases.author.includes(authorKey) || rules.disabled_ambiguous_aliases.series.includes(seriesKey))) {
    throw new Error('Ambiguous canonical author or series alias');
  }
  let series = book ? book.series[0]?.name : (metadata.series ? rules.series_aliases[seriesKey] || metadata.series : undefined);
  let title = metadata.title;
  if (kind === 'audiobook' && rules.strip_audiobook_format_labels) {
    title = stripFormat(title);
    if (series) series = stripFormat(series);
  }
  if (!title) throw new Error('Canonical title is empty');
  return {
    ...metadata,
    title,
    author: book ? book.authors.join(', ') : rules.author_aliases[authorKey] || metadata.author,
    series,
    seriesPart: book ? book.series[0]?.sequence ?? undefined : metadata.seriesPart,
  };
}
