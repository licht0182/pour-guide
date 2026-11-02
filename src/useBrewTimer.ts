import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recipe, TimerState } from './types';
import { getElapsedMs, getTimerSnapshot, initialTimer, pauseTimer, startTimer } from './timer';

export function useBrewTimer(recipe: Recipe, sound: boolean) {
  const [state, setState] = useState<TimerState>(initialTimer);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const lastCue = useRef(-1);
  const snapshot = getTimerSnapshot(recipe, getElapsedMs(state, now));

  const cue = useCallback(() => {
    const context = audio.current;
    if (!sound || !context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.23);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, [sound]);

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
      cue();
      lastCue.current = cueIndex;
    }
    if (snapshot.completed) {
      setState({ status: 'completed', elapsedMs: snapshot.totalDuration * 1000, startedAt: null });
    }
  }, [state.status, snapshot.completed, snapshot.stepIndex, snapshot.totalDuration, recipe.steps.length, cue]);

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

  useEffect(() => () => { void audio.current?.close(); }, []);

  const prepareSound = useCallback(() => {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => setNotice('이 브라우저에서 소리를 재생하지 못했습니다. 화면 안내를 확인해 주세요.'));
    } catch {
      setNotice('이 브라우저는 소리 알림을 지원하지 않습니다. 화면 안내는 계속 사용할 수 있습니다.');
    }
  }, []);

  const start = useCallback(() => {
    if (sound) prepareSound();
    if (lastCue.current < 0) lastCue.current = 0;
    const time = Date.now();
    setNow(time);
    setState(previous => startTimer(previous, time));
  }, [prepareSound, sound]);

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
    if (sound) prepareSound();
    lastCue.current = 0;
    const time = Date.now();
    setNow(time);
    setState(startTimer(initialTimer(), time));
  }, [prepareSound, sound]);

  return { status: state.status, snapshot, start, pause, restart, reset, notice, prepareSound };
}
