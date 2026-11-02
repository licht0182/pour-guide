const CUE_FREQUENCY = 740;
const CONFIRM_FREQUENCY = 620;

/**
 * Owns the Web Audio context. Browsers suspend contexts (and React can remount
 * effects), so every play resumes/recreates instead of trusting a cached state.
 */
export class BrewChime {
  private context: AudioContext | null = null;

  async play(confirmation = false): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended' || context.state === 'interrupted') {
        await context.resume();
      }
      if (context.state !== 'running') return false;
      const start = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(confirmation ? CONFIRM_FREQUENCY : CUE_FREQUENCY, start);
      oscillator.connect(gain);
      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close();
  }

  private ensureContext(): AudioContext | null {
    if (this.context?.state === 'closed') this.context = null;
    if (this.context) return this.context;
    if (typeof AudioContext === 'undefined') return null;
    try {
      this.context = new AudioContext();
      return this.context;
    } catch {
      return null;
    }
  }
}
