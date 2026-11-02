import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const NAVIGATION_GUARD_MS = 5_000;
const VERSION_PARAM = 'v';

// Substituted at build time by Vite's `define`; the typeof check keeps the hook
// safe in environments that never ran the app build (dev harness, unit tests).
const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

/** Accepts exactly `{ "version": "<non-empty string>" }`. */
function readVersion(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null;
  const version: unknown = value.version;
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

/** Reloads the current document with only the version query changed. */
function goToVersion(version: string, nonce?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(VERSION_PARAM, nonce ? `${version}-${nonce}` : version);
  // Other query parameters and the hash are left exactly as they were.
  window.location.replace(url.toString());
}

/**
 * Watches `version.json` and rolls the page onto a newer build.
 *
 * `autoBlocked` withholds the automatic navigation (a brew, the completed
 * screen, an editor, fullscreen) while still reporting `available`.
 * `refreshBlocked` only gates the explicit `refresh()` call; it is normally the
 * same, but the completed screen allows the user's own click.
 */
export function useAppUpdate(autoBlocked: boolean, refreshBlocked = autoBlocked) {
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const blockedRef = useRef(autoBlocked);
  const refreshBlockedRef = useRef(refreshBlocked);
  const activeRef = useRef(false);
  const navigatingRef = useRef(false);
  const autoAttemptedRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  blockedRef.current = autoBlocked;
  refreshBlockedRef.current = refreshBlocked;

  const check = useCallback(async () => {
    if (!activeRef.current || navigatingRef.current) return;
    const sequence = ++sequenceRef.current;
    // Coalesce overlapping triggers (mount, visibility, online, interval).
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.href);
      url.searchParams.set('t', Date.now().toString(36));
      const response = await fetch(url.toString(), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      const version = readVersion(payload);
      // A newer trigger took over, or the hook unmounted.
      if (!version || sequence !== sequenceRef.current || !activeRef.current) return;
      if (version === APP_VERSION) {
        setPendingVersion(null);
        return;
      }
      if (blockedRef.current) {
        // Surfaced while the brew is in flight instead of navigating: polling
        // resumes automatic rollover once the page is no longer blocked.
        setPendingVersion(version);
        return;
      }
      // Never hop twice to the same target: this document was already loaded
      // with `?v=<version>`, so an edge cache is still serving the old bundle.
      // Reloading again would loop, so the update stays a manual retry whose
      // click adds a fresh nonce.
      const requested = new URLSearchParams(window.location.search).get(VERSION_PARAM);
      const alreadyRequested =
        requested !== null && (requested === version || requested.startsWith(`${version}-`));
      // An automatic hop already happened in this document and the page is
      // still here (the reload was refused, e.g. by a beforeunload prompt):
      // stop auto-navigating and let the user decide instead of re-prompting.
      if (alreadyRequested || autoAttemptedRef.current === version) {
        setPendingVersion(version);
        return;
      }
      autoAttemptedRef.current = version;
      navigatingRef.current = true;
      // A beforeunload prompt can cancel `replace`; re-arm polling so a refused
      // navigation cannot silently disable updates for the rest of the session.
      window.setTimeout(() => {
        navigatingRef.current = false;
      }, NAVIGATION_GUARD_MS);
      goToVersion(version);
    } catch {
      // Offline, timed out, aborted, or malformed payload: keep the app as-is.
    } finally {
      window.clearTimeout(timeout);
      if (sequence === sequenceRef.current && controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void check();
    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onOnline = () => void check();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      activeRef.current = false;
      sequenceRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [check]);

  // Re-check as soon as the blocker clears, so a rollover held back during a
  // brew happens promptly instead of waiting for the next poll.
  const wasBlocked = useRef(autoBlocked);
  useEffect(() => {
    const released = wasBlocked.current && !autoBlocked;
    wasBlocked.current = autoBlocked;
    if (released) void check();
  }, [autoBlocked, check]);

  const refresh = useCallback(() => {
    if (!pendingVersion || refreshBlockedRef.current) return;
    // A fresh nonce per user click makes the document request a browser-cache
    // miss; GitHub Pages ignores query strings when caching at its own edge, so
    // a still-warm edge copy can serve the old HTML until its TTL expires.
    goToVersion(pendingVersion, Math.random().toString(36).slice(2, 8));
  }, [pendingVersion]);

  return { available: pendingVersion !== null, refresh };
}
