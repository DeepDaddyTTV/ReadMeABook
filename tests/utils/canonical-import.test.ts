/** Component: Canonical Import Acceptance Tests | Documentation: documentation/features/canonical-identities.md */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const mocks = vi.hoisted(() => ({ configuration: vi.fn(), tagging: vi.fn(), available: vi.fn() }));
vi.mock('../../src/lib/db', () => ({ prisma: { configuration: { findUnique: mocks.configuration } } }));
vi.mock('../../src/lib/utils/metadata-tagger', () => ({ checkFfmpegAvailable: mocks.available, tagMultipleFiles: mocks.tagging }));
import { FileOrganizer } from '../../src/lib/utils/file-organizer';

let root: string;
let source: string;
let library: string;
const metadata = { title: 'Book (Light Novel)', author: 'Writer, A.', series: 'Story--Series', seriesPart: '1.5', narrator: 'Narrator Name' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-import-'));
  source = path.join(root, 'download'); library = path.join(root, 'library');
  await fs.mkdir(source); await fs.mkdir(library);
  const rules = path.join(root, 'rules.json');
  await fs.writeFile(rules, JSON.stringify({ version: 1, author_aliases: { 'writer, a.': 'A. Writer' }, series_aliases: { 'story--series': 'Story Series' }, strip_audiobook_format_labels: true }));
  vi.stubEnv('CANONICAL_IDENTITIES_FILE', rules);
  mocks.configuration.mockImplementation(async ({ where }: any) => ({ value: where.key === 'metadata_tagging_enabled' ? 'true' : 'false' }));
  mocks.tagging.mockResolvedValue([]);
  mocks.available.mockResolvedValue(true);
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe('canonical identities across actual import entry points', () => {
  it('uses the same names for audiobook paths, filenames and tagging while preserving source bytes', async () => {
    const bytes = Buffer.from('synthetic source fixture');
    await fs.writeFile(path.join(source, 'original.mp3'), bytes);
    const result = await new FileOrganizer(library, path.join(root, 'tmp')).organize(source, metadata, '{author}/{series}/{title}', undefined, { enabled: true, template: '{title}' });
    expect(result.success).toBe(true);
    expect(result.targetPath).toBe(path.join(library, 'A. Writer', 'Story Series', 'Book'));
    expect(result.canonicalMetadata).toEqual({ title: 'Book', author: 'A. Writer', series: 'Story Series', seriesPart: '1.5' });
    expect(mocks.tagging).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ title: 'Book', author: 'A. Writer', series: 'Story Series', seriesPart: '1.5', narrator: 'Narrator Name' }));
    expect(await fs.readFile(path.join(source, 'original.mp3'))).toEqual(bytes);
    expect(await fs.readFile(result.audioFiles[0])).toEqual(bytes);
  });
  it('normalizes copied EPUB metadata before publication, retaining the seeded original', async () => {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile('content.opf', Buffer.from('<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:creator>Writer, A.</dc:creator><dc:title>Book</dc:title></metadata><manifest/><spine/></package>'));
    zip.addFile('text.xhtml', Buffer.from('<html>UNCHANGED TEXT</html>'));
    const original = zip.toBuffer();await fs.writeFile(path.join(source, 'original.epub'), original);
    const result = await new FileOrganizer(library).organizeEbook(source, metadata, '{author}/{series}', undefined, true, { enabled: true, template: '{title}' });
    expect(result.success).toBe(true);expect(result.targetPath).toBe(path.join(library, 'A. Writer', 'Story Series'));
    const published = new AdmZip(await fs.readFile(path.join(result.targetPath, 'Book (Light Novel).epub')));
    expect(published.getEntry('content.opf')!.getData().toString()).toContain('A. Writer');
    expect(published.getEntry('content.opf')!.getData().toString()).toContain('Story Series');
    expect(published.getEntry('text.xhtml')!.getData()).toEqual(zip.getEntry('text.xhtml')!.getData());
    expect(await fs.readFile(path.join(source, 'original.epub'))).toEqual(original);
  });
  it('rejects invalid configured rules before creating any library files', async () => {
    await fs.writeFile(process.env.CANONICAL_IDENTITIES_FILE!, '{invalid-private-json');
    await fs.writeFile(path.join(source, 'original.mp3'), 'unchanged');
    const result = await new FileOrganizer(library).organize(source, metadata, '{author}/{title}');
    expect(result.success).toBe(false);expect(await fs.readdir(library)).toEqual([]);
    expect(result.errors.join()).toContain('unavailable or invalid');expect(result.errors.join()).not.toContain('invalid-private-json');
  });
});
