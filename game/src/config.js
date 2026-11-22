// Shared constants, palette and small math helpers for The Marrowgate Heists.
// Pure logic: no DOM, no canvas here, so the world can be simulated headlessly.
export const TILE = 40;
export const COLS = 32;
export const ROWS = 18;
export const WIDTH = COLS * TILE; // 1280
export const HEIGHT = ROWS * TILE; // 720
export const STEP = 1 / 60;

export const PALETTE = {
  floorCold: '#232c3d',
  floorCold2: '#283044',
  floorWarm: '#2e2a33',
  wall: '#3a4358',
  wallTop: '#4a5470',
  wallEdge: '#1a2030',
  lampGlow: '#ffd27a',
  lampCore: '#ffe9a8',
  playerTeal: '#6ff0dd',
  playerTealDark: '#2ba88f',
  guardCoat: '#8f2f2a',
  guardCoatDark: '#5e1f1c',
  guardSkin: '#e8c39a',
  lootGold: '#ffd166',
  prizeGold: '#ffe066',
  exitGreen: '#3ddc84',
  exitGreenDark: '#1d7a45',
  conePatrol: 'rgba(255, 210, 122, 0.20)',
  coneSuspicious: 'rgba(255, 196, 66, 0.30)',
  coneSearch: 'rgba(255, 154, 46, 0.34)',
  coneAlert: 'rgba(231, 76, 60, 0.38)',
  cameraCone: 'rgba(231, 76, 60, 0.22)',
  laser: '#ff3b30',
  smoke: 'rgba(180, 190, 205, 0.55)',
  grass: '#2f5d3a',
  grassDark: '#24482e',
  water: '#1d3a4d',
  waterLine: '#2f6b8a',
  crate: '#6b4f2a',
  crateEdge: '#4a3519',
  pillar: '#565f78',
  shelf: '#5a4632',
  ink: '#e8e4d8',
  inkDim: '#9aa3b5',
  hudBar: '#141a26',
  hudEdge: '#2c3547',
};

// Gaits: sneak is silent, walk is quiet, sprint is fast and loud.
export const GAITS = {
  sneak: { speed: 62, noise: 0, label: 'SNEAK' },
  walk: { speed: 118, noise: 52, label: 'WALK' },
  sprint: { speed: 196, noise: 150, label: 'SPRINT' },
};

// Guard vision and suspicion tuning.
export const VISION = {
  fov: (70 * Math.PI) / 180, // full cone angle
  range: 252, // px
  nearRange: 96, // inside this, darkness does not hide you
  rays: 26, // raycast rays per cone
  riseFull: 0.85, // suspicion per second when fully seen
  riseDim: 0.34, // suspicion per second when seen in dim light
  decay: 0.22, // suspicion decay per second when unseen
  investigateAt: 0.55, // suspicion that sends a guard to investigate
  grace: 0.9, // seconds of full sight before suspicion starts rising
  litThreshold: 0.3, // light level at/above which you count as lit
  grassHideRange: 46, // guards see you in tall grass only closer than this
};

export const CAMERA = { range: 190, halfAngle: (22 * Math.PI) / 180, sweepSpeed: 0.45 };
export const LASER = { cycle: 4.0, onTime: 2.2 }; // lasers blink: on 2.2s, off 1.8s

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function angleLerp(a, b, t) { return a + angleDiff(a, b) * t; }
export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Deterministic RNG (mulberry32) so staged shots render the same frame every run.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
