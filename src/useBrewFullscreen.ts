import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Fullscreen for the brew board.
 *
 * Uses the native Fullscreen API when the browser allows it. When it is
 * unavailable, blocked, or rejects the request, the same `active` state is
 * kept and CSS (`is-fullscreen`) fills the viewport instead. The panel is never
 * portalled or remounted, so the timer DOM and its state stay intact.
 */
type FullscreenMode = 'native' | 'fallback' | null;

const FALLBACK_NOTICE =
  '브라우저 전체화면을 시작하지 못해 앱 화면을 가득 채워 표시합니다. 주소 표시줄은 그대로 보입니다.';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert]'),
  );
}

export function useBrewFullscreen() {
  const panelRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState('');
  const modeRef = useRef<FullscreenMode>(null);
  const nativeElementRef = useRef<Element | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  /** Put focus on the toggle so keyboard users are inside the panel. */
  const focusEntry = useCallback(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  /** Leave either mode and give focus back to the button when exit dropped it. */
  const leave = useCallback(() => {
    requestRef.current += 1;
    modeRef.current = null;
    nativeElementRef.current = null;
    setActive(false);
    setNotice('');
    window.requestAnimationFrame(() => {
      const current = document.activeElement;
      const lost =
        !current ||
        current === document.body ||
        current === document.documentElement ||
        !current.isConnected;
      if (lost) focusEntry();
    });
  }, [focusEntry]);

  const enterNative = useCallback(() => {
    modeRef.current = 'native';
    nativeElementRef.current = document.fullscreenElement ?? panelRef.current;
    setActive(true);
    setNotice('');
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const current = document.activeElement;
      if (!panel || !(current instanceof HTMLElement) || !panel.contains(current)) focusEntry();
    });
  }, [focusEntry]);

  const enterFallback = useCallback(() => {
    modeRef.current = 'fallback';
    nativeElementRef.current = null;
    setActive(true);
    setNotice(FALLBACK_NOTICE);
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const current = document.activeElement;
      if (!panel || !(current instanceof HTMLElement) || !panel.contains(current)) focusEntry();
    });
  }, [focusEntry]);

  /**
   * Commit the fixed-viewport layout before the next paint. Used whenever the
   * native request cannot be honoured, so a click never ends on an unchanged
   * page. React would otherwise be free to defer the update to a later task.
   */
  const applyFallback = useCallback(() => {
    try {
      flushSync(enterFallback);
    } catch {
      // flushSync refuses to run during render/commit; this only guards that
      // unsupported call site. The update is still queued either way.
      enterFallback();
    }
  }, [enterFallback]);

  // Track the browser's fullscreen state: successful entry, Escape, and exits
  // started outside the app (browser UI, OS gesture) all converge here.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (panelRef.current && document.fullscreenElement === panelRef.current) {
        enterNative();
        return;
      }
      if (modeRef.current === 'native') leave();
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    // Reconcile with a document restored from bfcache already in fullscreen.
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [enterNative, leave]);

  // Lock page scrolling while the panel owns the viewport; restore whatever
  // inline styles were there before on exit and on unmount.
  useEffect(() => {
    if (!active) return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [active]);

  // Trap Tab inside the panel in both modes. Escape exits fallback mode here;
  // native Escape is performed by the browser and reported by fullscreenchange.
  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (modeRef.current === 'fallback') {
          event.preventDefault();
          event.stopPropagation();
          leave();
          return;
        }
        // Native fullscreen is normally exited by the browser itself. Doing it
        // here as well covers engines/hosts that deliver the key without the
        // browser's own handling (embedded views, automated input).
        if (modeRef.current === 'native' && nativeElementRef.current) {
          const element = nativeElementRef.current;
          if (document.fullscreenElement === element && typeof document.exitFullscreen === 'function') {
            try {
              void document.exitFullscreen().catch(() => {});
            } catch {
              // Nothing else to try; fullscreenchange reconciles the state.
            }
          }
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = getFocusable(panel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const inside = current instanceof HTMLElement && panel.contains(current);

      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, leave]);

  // Never leave the browser showing a fullscreen panel that no longer exists.
  useEffect(() => {
    return () => {
      requestRef.current += 1;
      const element = nativeElementRef.current;
      nativeElementRef.current = null;
      modeRef.current = null;
      if (
        element &&
        document.fullscreenElement === element &&
        typeof document.exitFullscreen === 'function'
      ) {
        try {
          void document.exitFullscreen().catch(() => {});
        } catch {
          // Older engines can throw synchronously; nothing left to clean up.
        }
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (busyRef.current) return;

    const panel = panelRef.current;
    if (!panel) return;

    if (modeRef.current === 'fallback') {
      leave();
      return;
    }

    if (modeRef.current === 'native') {
      busyRef.current = true;
      try {
        if (
          document.fullscreenElement === panel &&
          typeof document.exitFullscreen === 'function'
        ) {
          await document.exitFullscreen();
        }
      } catch {
        // Ignore: the state below is reconciled with the browser either way.
      } finally {
        busyRef.current = false;
      }
      if (modeRef.current === 'native' && document.fullscreenElement !== panel) leave();
      return;
    }

    const requestId = ++requestRef.current;
    busyRef.current = true;
    try {
      if (
        typeof panel.requestFullscreen !== 'function' ||
        document.fullscreenEnabled === false
      ) {
        applyFallback();
        return;
      }

      // Called synchronously inside the click handler, so the browser still
      // sees the user gesture.
      await panel.requestFullscreen({ navigationUI: 'hide' });

      if (requestRef.current !== requestId) return;
      // The fullscreenchange listener normally got here first.
      if (modeRef.current === null) {
        if (document.fullscreenElement === panel) enterNative();
        else applyFallback();
      }
    } catch {
      // Rejected (permissions policy, gesture rules, …) or unsupported:
      // switch to the fixed-viewport layout in the same gesture.
      if (requestRef.current !== requestId) return;
      if (modeRef.current === null) {
        if (document.fullscreenElement === panel) enterNative();
        else applyFallback();
      }
    } finally {
      busyRef.current = false;
    }
  }, [applyFallback, enterNative, leave]);

  return { panelRef, buttonRef, active, toggle, notice };
}
