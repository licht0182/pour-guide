import { describe, expect, it, vi } from 'vitest';
import { Drive, DriveAuthError, mergeEntries, parseSnapshot, trackChanges } from './driveSync';
import { DriveNetworkError } from './driveErrors';
import { PRESETS } from './recipe';

const r = PRESETS[0];
const old = { id: r.id, revision: '0000000000000001-a', recipe: { ...r, order: 0 } };
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
  it('records the library position and revises recipes when only the order moves', () => {
    const second = { ...PRESETS[1], id: 'second' };
    const stored = trackChanges([old], [second, r]);
    expect(stored.map(entry => entry.recipe?.order)).toEqual([1, 0]);
    const revisionOf = (set: typeof stored, id: string) => set.find(entry => entry.id === id)!.revision;
    const moved = trackChanges(stored, [r, second]);
    // Swapping two recipes changes both positions, so both get a new revision.
    expect(revisionOf(moved, r.id) > revisionOf(stored, r.id)).toBe(true);
    expect(revisionOf(moved, 'second') > revisionOf(stored, 'second')).toBe(true);
    expect(trackChanges(moved, [r, second])).toEqual(moved);
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
  it('verifies uploaded sync content by reading the returned file ID', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: 'saved' }))
      .mockResolvedValueOnce(Response.json({ version: 1, entries: [old] }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await new Drive('token').write([old]);
      expect(fetcher.mock.calls[1][0]).toContain('/saved?alt=media');
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects writes that cannot be read back correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id: 'wrong' }))
      .mockResolvedValueOnce(Response.json({ version: 1, entries: [deleted] })));
    try { await expect(new Drive('token').write([old])).rejects.toThrow(/일치하지/); }
    finally { vi.unstubAllGlobals(); }
  });
  it('reports a dropped connection as a transport failure, not a rejected login', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    try {
      const failure = await new Drive('token').read().catch(error => error);
      expect(failure).toBeInstanceOf(DriveNetworkError);
      expect(failure).not.toBeInstanceOf(DriveAuthError);
    } finally { vi.unstubAllGlobals(); }
  });
});
