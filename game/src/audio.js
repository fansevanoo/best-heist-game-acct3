// Synthesised WebAudio for The Marrowgate Heists — no audio files, no network.
// A low drone under everything, tension that rises with the guards' suspicion,
// and short blips for coins, pickups, alarms and catches. Safe to call before
// any user gesture: it stays silent until init() runs on first input.
let ctx = null;
let master = null;
let drone = null;
let tensionGain = null;
let tensionOsc = null;
let muted = false;

function ensure() {
  if (ctx) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    // Ambient drone: two detuned low sines through a lowpass.
    drone = ctx.createGain();
    drone.gain.value = 0.045;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 220;
    for (const f of [55, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(filt);
      o.start();
    }
    filt.connect(drone);
    drone.connect(master);
    // Tension pulse: a soft square that quickens as suspicion rises.
    tensionGain = ctx.createGain();
    tensionGain.gain.value = 0;
    tensionOsc = ctx.createOscillator();
    tensionOsc.type = 'triangle';
    tensionOsc.frequency.value = 110;
    tensionOsc.connect(tensionGain);
    tensionGain.connect(master);
    tensionOsc.start();
    return true;
  } catch {
    return false;
  }
}

function blip(freq, dur, type, vol, when = 0) {
  if (!ctx || muted) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
    o.connect(g);
    g.connect(master);
    o.start(ctx.currentTime + when);
    o.stop(ctx.currentTime + when + dur + 0.02);
  } catch { /* audio is decoration, never fatal */ }
}

export const AudioSys = {
  init() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
  get muted() { return muted; },
  toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    return muted;
  },
  setTension(v) {
    if (!ctx || !tensionGain) return;
    const t = Math.max(0, Math.min(1, v));
    tensionGain.gain.setTargetAtTime(t * 0.05, ctx.currentTime, 0.4);
    tensionOsc.frequency.setTargetAtTime(110 + t * 90, ctx.currentTime, 0.4);
  },
  click() { blip(660, 0.06, 'sine', 0.08); },
  coin() { blip(1320, 0.09, 'sine', 0.12); blip(1760, 0.12, 'sine', 0.08, 0.05); },
  pickup() { blip(880, 0.1, 'sine', 0.1); blip(1174, 0.14, 'sine', 0.1, 0.07); },
  prize() { [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.22, 'triangle', 0.12, i * 0.09)); },
  caught() { blip(220, 0.4, 'sawtooth', 0.14); blip(233, 0.4, 'sawtooth', 0.14); },
  alarm() { blip(740, 0.16, 'square', 0.07); blip(554, 0.16, 'square', 0.07, 0.18); },
  win() { [392, 523, 659, 784, 1046].forEach((f, i) => blip(f, 0.3, 'triangle', 0.1, i * 0.1)); },
  laser() { blip(180, 0.2, 'sawtooth', 0.1); },
};
