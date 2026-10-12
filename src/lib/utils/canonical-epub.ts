/**
 * Component: Canonical EPUB Import Metadata
 * Documentation: documentation/features/canonical-identities.md
 */
import AdmZip from 'adm-zip';
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { CanonicalRules, ImportIdentity, identityKey } from './canonical-identity';

type Node = Record<string, any>;
const local = (key: string) => key.split(':').pop();
export function canonicalizeEpubBuffer(buffer: Buffer, metadata: ImportIdentity, rules: CanonicalRules): Buffer {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (new Set(entries.map(e => e.entryName)).size !== entries.length) throw new Error('Duplicate EPUB member names');
  // AdmZip mutates entry offsets while serializing. Snapshot decompressed members
  // before toBuffer so verification cannot read through rewritten old offsets.
  const originalMembers = new Map(entries.map(e => [e.entryName, Buffer.from(e.getData())]));
  const opfs = entries.filter(e => e.entryName.toLowerCase().endsWith('.opf'));
  if (opfs.length !== 1) throw new Error('Ambiguous EPUB package metadata');
  const xml = opfs[0].getData().toString('utf8');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid EPUB package XML');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false });
  const nodes: Node[] = parser.parse(xml);
  const packageNode = nodes.find(n => Object.keys(n).some(k => local(k) === 'package'));
  const packageKey = packageNode && Object.keys(packageNode).find(k => local(k) === 'package');
  if (!packageNode || !packageKey) throw new Error('Missing EPUB package');
  const metadataNode = packageNode[packageKey].find((n: Node) => Object.keys(n).some(k => local(k) === 'metadata'));
  const metadataKey = metadataNode && Object.keys(metadataNode).find(k => local(k) === 'metadata');
  if (!metadataNode || !metadataKey) throw new Error('Missing EPUB identity metadata');
  const children: Node[] = metadataNode[metadataKey];
  const roles = new Map<string, string>();
  for (const child of children) {
    const key = Object.keys(child).find(k => local(k) === 'meta');
    if (key && child[':@']?.['@_property'] === 'role') {
      roles.set((child[':@']['@_refines'] || '').replace(/^#/, ''), child[key].find((n: Node) => '#text' in n)?.['#text'] || '');
    }
  }
  const creatorNodes = children.filter(child => {
    const key = Object.keys(child).find(k => local(k) === 'creator');
    if (!key) return false;
    const attrs = child[':@'] || {};
    return (roles.get(attrs['@_id']) || Object.entries(attrs).find(([k]) => k.endsWith(':role'))?.[1] || 'aut') === 'aut';
  });
  const identified = metadata.asin ? rules.books_by_asin[metadata.asin.toUpperCase()] : undefined;
  if (identified && identified.authors.length !== creatorNodes.length) throw new Error('Canonical EPUB author count conflicts with contributor roles');
  let writerCount = 0;
  for (const child of children) {
    const key = Object.keys(child).find(k => local(k) === 'creator');
    if (!key) continue;
    const attrs = child[':@'] || {};
    const role = roles.get(attrs['@_id']) || Object.entries(attrs).find(([k]) => k.endsWith(':role'))?.[1] || 'aut';
    if (role !== 'aut') continue;
    const text = child[key].find((n: Node) => '#text' in n);
    if (!text || typeof text['#text'] !== 'string') throw new Error('Unsupported EPUB creator structure');
    text['#text'] = identified ? identified.authors[writerCount] : (creatorNodes.length === 1 ? metadata.author : rules.author_aliases[identityKey(text['#text'])] || text['#text']);
    writerCount++;
    // An old file-as value must not reintroduce the provider's author spelling.
    for (const attribute of Object.keys(attrs)) if (attribute.endsWith(':file-as')) delete attrs[attribute];
    const id = attrs['@_id'];
    if (id) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i][':@']?.['@_property'] === 'file-as' && children[i][':@']?.['@_refines'] === '#' + id) children.splice(i, 1);
      }
    }
  }
  if (!writerCount) throw new Error('No EPUB author role; refusing to infer credits');
  // Existing collection IDs and contributor roles survive. Normalize each exact
  // known collection name, overriding only the matching primary series position.
  const types = new Map<string, string>();
  for (const child of children) {
    const key = Object.keys(child).find(k => local(k) === 'meta');
    if (key && child[':@']?.['@_property'] === 'collection-type') {
      types.set((child[':@']['@_refines'] || '').replace(/^#/, ''), child[key].find((n: Node) => '#text' in n)?.['#text'] || '');
    }
  }
  const seriesCollections = children.filter(child => child[':@']?.['@_property'] === 'belongs-to-collection' && types.get(child[':@']?.['@_id']) === 'series');
  let primaryId: string | undefined;
  let calibre = false;
  let calibreIndex = false;
  for (const child of children) {
    const key = Object.keys(child).find(k => local(k) === 'meta');
    if (!key) continue;
    const attrs = child[':@'] || {};
    if (attrs['@_name'] === 'calibre:series') { calibre = true; attrs['@_content'] = metadata.series || rules.series_aliases[identityKey(attrs['@_content'] || '')] || attrs['@_content']; }
    if (attrs['@_name'] === 'calibre:series_index') { calibreIndex = true; if (metadata.seriesPart) attrs['@_content'] = metadata.seriesPart; }
    if (attrs['@_property'] === 'belongs-to-collection' && types.get(attrs['@_id']) === 'series') {
      const text = child[key].find((n: Node) => '#text' in n);
      if (text) {
        text['#text'] = rules.series_aliases[identityKey(text['#text'])] || text['#text'];
        if (metadata.series && (seriesCollections.length === 1 || text['#text'] === metadata.series)) {
          text['#text'] = metadata.series;
          primaryId = attrs['@_id'];
        }
      }
    }
  }
  const metaKey = (metadataKey.includes(':') ? metadataKey.split(':')[0] + ':' : '') + 'meta';
  if (metadata.series && !calibre) children.push({ [metaKey]: [], ':@': { '@_name': 'calibre:series', '@_content': metadata.series } });
  if (metadata.series && metadata.seriesPart && !calibreIndex) children.push({ [metaKey]: [], ':@': { '@_name': 'calibre:series_index', '@_content': metadata.seriesPart } });
  if (String(packageNode[':@']?.['@_version']).startsWith('3') && metadata.series && !primaryId) {
    const usedIds = new Set(children.map(c => c[':@']?.['@_id']));
    primaryId = 'canonical-primary-series';
    while (usedIds.has(primaryId)) primaryId += '-x';
    children.push({ [metaKey]: [{ '#text': metadata.series }], ':@': { '@_property': 'belongs-to-collection', '@_id': primaryId } });
    children.push({ [metaKey]: [{ '#text': 'series' }], ':@': { '@_property': 'collection-type', '@_refines': '#' + primaryId } });
  }
  if (primaryId && metadata.seriesPart) {
    const position = children.find(c => c[':@']?.['@_property'] === 'group-position' && c[':@']?.['@_refines'] === '#' + primaryId);
    if (position) {
      const positionKey = Object.keys(position).find(k => local(k) === 'meta')!;
      position[positionKey] = [{ '#text': metadata.seriesPart }];
    } else children.push({ [metaKey]: [{ '#text': metadata.seriesPart }], ':@': { '@_property': 'group-position', '@_refines': '#' + primaryId } });
  }
  const builder = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false });
  const updated = builder.build(nodes);
  if (XMLValidator.validate(updated) !== true) throw new Error('Invalid normalized EPUB XML');
  zip.updateFile(opfs[0].entryName, Buffer.from(updated));
  const result = zip.toBuffer();
  const verification = new AdmZip(result);
  for (const entry of entries) {
    if (entry.entryName !== opfs[0].entryName && !verification.getEntry(entry.entryName)?.getData().equals(originalMembers.get(entry.entryName)!)) {
      throw new Error('EPUB content changed during normalization');
    }
  }
  return result;
}
