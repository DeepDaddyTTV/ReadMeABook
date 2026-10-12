/** Component: EPUB Identity Tests | Documentation: documentation/features/canonical-identities.md */
import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { canonicalizeEpubBuffer } from '../../src/lib/utils/canonical-epub';
import { parseCanonicalRules } from '../../src/lib/utils/canonical-identity';

const rules = parseCanonicalRules({ version: 1, author_aliases: { 'Writer, A.': 'A. Writer' }, series_aliases: { 'Story--Series': 'Story Series' } });
function fixture(version = '3.0') {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip')); zip.getEntry('mimetype')!.header.method = 0;
  zip.addFile('content.opf', Buffer.from(`<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" version="${version}"><metadata><dc:creator id="author" opf:role="aut" opf:file-as="Writer, A.">Writer, A.</dc:creator><dc:creator id="translator" opf:role="trl">Translator Name</dc:creator><dc:identifier id="bookid">unchanged-isbn</dc:identifier><meta name="calibre:series" content="Story--Series"/><meta name="calibre:series_index" content="1.5"/><meta property="belongs-to-collection" id="series">Story--Series</meta><meta property="collection-type" refines="#series">series</meta><meta property="group-position" refines="#series">1.5</meta><meta property="belongs-to-collection" id="set">Unrelated Collection</meta><meta property="collection-type" refines="#set">set</meta></metadata><manifest><item id="page" href="page.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="page"/></spine></package>`));
  zip.addFile('page.xhtml', Buffer.from('<html>UNCHANGED TEXT</html>'));
  zip.addFile('cover.jpg', Buffer.from('UNCHANGED IMAGE'));
  return zip.toBuffer();
}
describe('canonical EPUB import metadata', () => {
  it.each(['2.0', '3.0'])('preserves content, identifiers and contributor roles in EPUB %s', version => {
    const input = fixture(version);
    const original = new AdmZip(input);
    const output = new AdmZip(canonicalizeEpubBuffer(input, { title: 'Book', author: 'A. Writer', series: 'Story Series', seriesPart: '0.5' }, rules));
    for (const entry of original.getEntries().filter(e => e.entryName !== 'content.opf')) expect(output.getEntry(entry.entryName)!.getData()).toEqual(entry.getData());
    const xml = output.getEntry('content.opf')!.getData().toString();
    expect(xml).toContain('A. Writer');expect(xml).not.toContain('Writer, A.');
    expect(xml).toContain('opf:role="trl"');expect(xml).toContain('Translator Name');
    expect(xml).toContain('unchanged-isbn');expect(xml).toContain('Unrelated Collection');
    expect(xml).toContain('Story Series');expect(xml).not.toContain('Story--Series');
    expect(xml).toContain('>0.5<');
    expect(output.getEntry('mimetype')!.header.method).toBe(0);
  });
  it('never invents author credits for an EPUB without an author role', () => {
    const zip = new AdmZip(fixture());
    zip.updateFile('content.opf', Buffer.from(zip.getEntry('content.opf')!.getData().toString().replace('opf:role="aut"', 'opf:role="ill"')));
    expect(() => canonicalizeEpubBuffer(zip.toBuffer(), { title: 'Book', author: 'A. Writer' }, rules)).toThrow('No EPUB author role');
  });
  it('rejects multiple package files before writing anything', () => {
    const zip = new AdmZip(fixture());zip.addFile('second.opf', Buffer.from('<package/>'));
    expect(() => canonicalizeEpubBuffer(zip.toBuffer(), { title: 'Book', author: 'A. Writer' }, rules)).toThrow('Ambiguous');
  });
  it('preserves separate coauthors while normalizing their individual aliases', () => {
    const zip = new AdmZip(fixture());
    zip.updateFile('content.opf', Buffer.from(zip.getEntry('content.opf')!.getData().toString().replace('</metadata>', '<dc:creator opf:role="aut">Second Writer</dc:creator></metadata>')));
    const xml = new AdmZip(canonicalizeEpubBuffer(zip.toBuffer(), { title: 'Book', author: 'A. Writer, Second Writer' }, rules)).getEntry('content.opf')!.getData().toString();
    expect(xml).toContain('>A. Writer<');expect(xml).toContain('>Second Writer<');expect(xml).not.toContain('>A. Writer, Second Writer<');
  });
  it('removes stale series on an identified standalone book while preserving unrelated collections', () => {
    const standalone = parseCanonicalRules({ version: 1, books_by_asin: { ASIN1: { authors: ['A. Writer'], series: [] } } });
    const xml = new AdmZip(canonicalizeEpubBuffer(fixture(), { title: 'Book', author: 'A. Writer', asin: 'ASIN1' }, standalone)).getEntry('content.opf')!.getData().toString();
    expect(xml).not.toContain('calibre:series');expect(xml).not.toContain('Story--Series');expect(xml).not.toContain('refines="#series"');
    expect(xml).toContain('Unrelated Collection');expect(xml).toContain('Translator Name');
  });
});
