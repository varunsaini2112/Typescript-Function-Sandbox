/**
 * Small synthesised cues. Generated with WebAudio rather than shipped as audio
 * files, so there is nothing to load and nothing to cache.
 *
 * The rules that keep this pleasant rather than irritating: only ever on the
 * completion of something you asked for, never per keystroke; short; and quiet
 * enough to sit under a conversation.
 */

export type Cue = 'pass' | 'fail' | 'error' | 'celebrate' | 'tick';

export type CueSet = 'chime' | 'marimba' | 'minimal';

export const CUE_SETS: { value: CueSet; label: string; hint: string }[] = [
  { value: 'chime', label: 'Chime', hint: 'Clear sine tones' },
  { value: 'marimba', label: 'Marimba', hint: 'Warmer, wooden, shorter' },
  { value: 'minimal', label: 'Minimal', hint: 'Single quiet notes' },
];

interface Note {
  /** Hertz */
  freq: number;
  /** Seconds from the start of the cue */
  at: number;
  /** Seconds */
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const CHIME: Record<Cue, Note[]> = {
  // Rising major third — resolved and warm, not a chirp.
  pass: [
    { freq: 587.33, at: 0, dur: 0.11 },
    { freq: 880.0, at: 0.075, dur: 0.16 },
  ],
  // Falling, softened with a triangle so it reads as "not yet" rather than an alarm.
  fail: [
    { freq: 349.23, at: 0, dur: 0.14, type: 'triangle' },
    { freq: 261.63, at: 0.1, dur: 0.22, type: 'triangle' },
  ],
  // Duller and lower — "this did not run" is a different event from "this ran and was wrong".
  error: [{ freq: 174.61, at: 0, dur: 0.3, type: 'sawtooth', gain: 0.035 }],
  celebrate: [
    { freq: 523.25, at: 0, dur: 0.12 },
    { freq: 659.25, at: 0.08, dur: 0.12 },
    { freq: 783.99, at: 0.16, dur: 0.12 },
    { freq: 1046.5, at: 0.24, dur: 0.34 },
  ],
  tick: [{ freq: 1174.66, at: 0, dur: 0.035, gain: 0.025 }],
};

const MARIMBA: Record<Cue, Note[]> = {
  pass: [
    { freq: 523.25, at: 0, dur: 0.08, type: 'triangle', gain: 0.075 },
    { freq: 783.99, at: 0.06, dur: 0.13, type: 'triangle', gain: 0.07 },
  ],
  fail: [
    { freq: 311.13, at: 0, dur: 0.1, type: 'triangle', gain: 0.07 },
    { freq: 233.08, at: 0.08, dur: 0.16, type: 'triangle', gain: 0.06 },
  ],
  error: [{ freq: 155.56, at: 0, dur: 0.26, type: 'triangle', gain: 0.05 }],
  celebrate: [
    { freq: 523.25, at: 0, dur: 0.09, type: 'triangle', gain: 0.07 },
    { freq: 698.46, at: 0.07, dur: 0.09, type: 'triangle', gain: 0.07 },
    { freq: 880.0, at: 0.14, dur: 0.09, type: 'triangle', gain: 0.07 },
    { freq: 1174.66, at: 0.21, dur: 0.26, type: 'triangle', gain: 0.06 },
  ],
  tick: [{ freq: 987.77, at: 0, dur: 0.03, type: 'triangle', gain: 0.022 }],
};

const MINIMAL: Record<Cue, Note[]> = {
  pass: [{ freq: 880.0, at: 0, dur: 0.09, gain: 0.04 }],
  fail: [{ freq: 293.66, at: 0, dur: 0.14, type: 'triangle', gain: 0.04 }],
  error: [{ freq: 196.0, at: 0, dur: 0.2, type: 'triangle', gain: 0.035 }],
  celebrate: [
    { freq: 880.0, at: 0, dur: 0.09, gain: 0.04 },
    { freq: 1318.51, at: 0.1, dur: 0.18, gain: 0.04 },
  ],
  tick: [{ freq: 1046.5, at: 0, dur: 0.025, gain: 0.018 }],
};

const SETS: Record<CueSet, Record<Cue, Note[]>> = {
  chime: CHIME,
  marimba: MARIMBA,
  minimal: MINIMAL,
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    // Browsers start the context suspended until a gesture; every cue here
    // follows a click, so resuming at play time is enough.
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

export function playCue(cue: Cue, enabled: boolean, set: CueSet = 'chime'): void {
  if (!enabled) return;

  const ctx = audioContext();
  if (!ctx) return;

  const start = ctx.currentTime + 0.01;

  for (const note of (SETS[set] ?? CHIME)[cue]) {
    const oscillator = ctx.createOscillator();
    const amp = ctx.createGain();

    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.value = note.freq;

    // A quick fade in and out: a square-edged envelope clicks audibly.
    const peak = note.gain ?? 0.06;
    const from = start + note.at;
    const to = from + note.dur;

    amp.gain.setValueAtTime(0.0001, from);
    amp.gain.exponentialRampToValueAtTime(peak, from + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, to);

    oscillator.connect(amp).connect(ctx.destination);
    oscillator.start(from);
    oscillator.stop(to + 0.02);
  }
}
