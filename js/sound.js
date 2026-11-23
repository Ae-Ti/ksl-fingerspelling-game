// 효과음: 파일 없이 Web Audio로 짧은 음을 만든다.
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

export function isSoundEnabled() {
  return enabled;
}

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.12 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** 버튼을 누를 때 한 번 불러 오디오를 깨운다(브라우저 자동 재생 제한) */
  unlock() {
    if (enabled) audio();
  },
  correct(combo = 1) {
    if (!enabled) return;
    const lift = Math.min(combo - 1, 6) * 40;
    tone(660 + lift, 0, 0.12, { type: 'triangle' });
    tone(990 + lift, 0.08, 0.16, { type: 'triangle' });
  },
  wrong() {
    if (!enabled) return;
    tone(220, 0, 0.14, { type: 'square', gain: 0.05 });
  },
  tick() {
    if (!enabled) return;
    tone(880, 0, 0.06, { type: 'sine', gain: 0.08 });
  },
  go() {
    if (!enabled) return;
    tone(1320, 0, 0.18, { type: 'sine', gain: 0.1 });
  },
  end() {
    if (!enabled) return;
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.2, { type: 'triangle' }));
  },
};
