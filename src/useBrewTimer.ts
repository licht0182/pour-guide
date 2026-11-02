import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recipe, TimerState } from './types';
import { getElapsedMs, getTimerSnapshot, initialTimer, pauseTimer, startTimer } from './timer';
import { BrewChime } from './audio';

export function useBrewTimer(recipe: Recipe, sound: boolean) {
  const [state, setState] = useState<TimerState>(initialTimer);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState('');
  const chime = useRef<BrewChime | null>(null);
  const soundRef = useRef(sound);
  const lastCue = useRef(-1);
  const snapshot = getTimerSnapshot(recipe, getElapsedMs(state, now));
  soundRef.current = sound;

  const playCue = useCallback(async (confirmation = false) => {
    chime.current ??= new BrewChime();
    const played = await chime.current.play(confirmation);
    if (!played) {
      setNotice('이 브라우저에서 알림음을 재생하지 못했습니다. 화면 안내를 확인해 주세요.');
    } else {
      setNotice('');
    }
    return played;
  }, []);

  /** Called from the sound toggle so the browser sees a user gesture. */
  const previewSound = useCallback(async () => {
    chime.current ??= new BrewChime();
    const played = await chime.current.play(true);
    setNotice(played ? '' : '이 브라우저에서 알림음을 재생하지 못했습니다. 화면 안내를 확인해 주세요.');
    return played;
  }, []);

  useEffect(() => {
    if (state.status !== 'running') return;
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 80);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'running') return;
    const cueIndex = snapshot.completed ? recipe.steps.length : snapshot.stepIndex;
    if (lastCue.current !== cueIndex) {
      lastCue.current = cueIndex;
      if (soundRef.current) void playCue();
    }
    if (snapshot.completed) {
      setState({ status: 'completed', elapsedMs: snapshot.totalDuration * 1000, startedAt: null });
    }
  }, [state.status, snapshot.completed, snapshot.stepIndex, snapshot.totalDuration, recipe.steps.length, playCue]);

  useEffect(() => {
    if (state.status !== 'running' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock.request('screen').then(lock => {
      if (cancelled) void lock.release();
      else sentinel = lock;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      void sentinel?.release();
    };
  }, [state.status]);

  useEffect(() => () => {
    chime.current?.dispose();
    chime.current = null;
  }, []);

  const start = useCallback(() => {
    if (soundRef.current) void playCue();
    else setNotice('');
    if (lastCue.current < 0) lastCue.current = 0;
    const time = Date.now();
    setNow(time);
    setState(previous => startTimer(previous, time));
  }, [playCue]);

  const pause = useCallback(() => {
    const time = Date.now();
    setNow(time);
    setState(previous => {
      const paused = pauseTimer(previous, time);
      const current = getTimerSnapshot(recipe, paused.elapsedMs);
      return current.completed
        ? { status: 'completed', elapsedMs: current.totalDuration * 1000, startedAt: null }
        : paused;
    });
  }, [recipe]);

  const reset = useCallback(() => {
    lastCue.current = -1;
    setNow(Date.now());
    setState(initialTimer());
  }, []);

  const restart = useCallback(() => {
    if (soundRef.current) void playCue();
    lastCue.current = 0;
    const time = Date.now();
    setNow(time);
    setState(startTimer(initialTimer(), time));
  }, [playCue]);

  return {
    status: state.status,
    snapshot,
    start,
    pause,
    restart,
    reset,
    notice,
    previewSound,
  };
}
