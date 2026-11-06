import { describe, expect, it, vi } from 'vitest';
import { Drive, mergeEntries, parseSnapshot, trackChanges } from './driveSync';
import { PRESETS } from './recipe';

const r = PRESETS[0];
const old = { id: r.id, revision: '0000000000000001-a', recipe: r };
const deleted = { ...old, revision: '0000000000000002-b', recipe: null };
describe('Drive sync', () => {
  it('merges concurrent devices deterministically and retains deletions', () => {
    expect(mergeEntries([old], [deleted])).toEqual([deleted]);
    expect(mergeEntries([deleted], [old])).toEqual([deleted]);
    const other = { ...old, id: 'another', recipe: { ...r, id: 'another' } };
    expect(mergeEntries([old], [other])).toHaveLength(2);
  });
  it('tracks offline edits and deletions without revising unchanged recipes', () => {
    expect(trackChanges([old], [r])).toEqual([old]);
    expect(trackChanges([old], [])[0].recipe).toBeNull();
    expect(trackChanges([old], [{ ...r, name: 'Changed' }])[0].revision > old.revision).toBe(true);
  });
  it('rejects corrupt and future snapshots', () => {
    expect(() => parseSnapshot({ version: 2, entries: [] })).toThrow();
    expect(() => parseSnapshot({ version: 1, entries: [{ ...old, recipe: {} }] })).toThrow();
    expect(parseSnapshot({ version: 1, entries: [deleted] }).entries).toEqual([deleted]);
  });
  it('reads all pages and merges immutable snapshots', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'a' }], nextPageToken: 'next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, entries: [old] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'b' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, entries: [deleted] })));
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await new Drive('token').read()).toEqual([deleted]);
      expect(fetcher.mock.calls[2][0]).toContain('pageToken=next');
    } finally { vi.unstubAllGlobals(); }
  });
  it('surfaces expired authorization without writing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    try { await expect(new Drive('expired').read()).rejects.toThrow('다시 연결'); }
    finally { vi.unstubAllGlobals(); }
  });
});
