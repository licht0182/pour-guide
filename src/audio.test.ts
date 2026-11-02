import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrewChime } from './audio';

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 10;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return new FakeGain();
  }
}

const originalAudioContext = globalThis.AudioContext;

function installFakeAudio(): void {
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
}

afterEach(() => {
  if (originalAudioContext) {
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

describe('brew chime', () => {
  it('resumes a suspended context before scheduling a cue', async () => {
    installFakeAudio();
    const chime = new BrewChime();
    const played = await chime.play();
    const context = FakeAudioContext.instances[0];
    expect(played).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].start).toHaveBeenCalledOnce();
  });

  it('recreates and resumes after the context was closed', async () => {
    installFakeAudio();
    const chime = new BrewChime();
    await chime.play();
    const first = FakeAudioContext.instances[0];
    chime.dispose();
    expect(first.state).toBe('closed');

    const played = await chime.play(true);
    const second = FakeAudioContext.instances[1];
    expect(played).toBe(true);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second.resume).toHaveBeenCalledOnce();
    expect(second.oscillators).toHaveLength(1);
  });

  it('reuses the same running context for successive cues', async () => {
    installFakeAudio();
    const chime = new BrewChime();
    await chime.play();
    await chime.play();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(2);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
  });

  it('reports failure instead of throwing when audio is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'AudioContext');
    const chime = new BrewChime();
    await expect(chime.play()).resolves.toBe(false);
  });
});
