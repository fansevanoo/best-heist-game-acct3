// Boot and game loop for The Marrowgate Heists.
// Screens: title -> play -> results -> ... -> campaign. ?shot= stages one
// screenshot scene from the real simulation; ?autopilot=1 plays the whole
// night by itself. Pause when the tab hides; M mutes.
import { STEP, WIDTH, HEIGHT } from './config.js';
import { LEVELS } from './levels.js';
import { createWorld, stepWorld, rankFor, scoreFor, EV_WIN, EV_FAILED, EV_CAUGHT, EV_LOOT, EV_PRIZE, EV_ALARM } from './world.js';
import { createPilot, pilotInput, stageShot, runCampaign } from './autopilot.js';
import { renderTitle, renderPlay, renderResults, renderCampaign, renderFailed, renderPaused } from './render.js';
import { AudioSys } from './audio.js';
import { bindInput, readInput, wasPressed, endFrame } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(window.location.search);

const levelNames = LEVELS.map((l) => l.name.toUpperCase());
let unlocked = 0;
try { unlocked = Number(window.localStorage.getItem('marrowgate-unlocked') || 0) || 0; } catch { unlocked = 0; }
function saveUnlocked() {
  try { window.localStorage.setItem('marrowgate-unlocked', String(unlocked)); } catch { /* private mode */ }
}

let screen = 'title';
let selectedLevel = 0;
let world = null;
let pilot = null;
let demoWorld = createWorld(0);
let result = null;
let resultTimer = 0; // autopilot lingers on the results card, then advances
let campaignResults = [];
let failReason = '';
let autopilotMode = params.get('autopilot') === '1';
let muted = false;
let lastTime = 0;
let acc = 0;

function startHeist(idx) {
  world = createWorld(idx);
  pilot = autopilotMode ? createPilot(idx) : null;
  // The pilot owns its own world; in autopilot mode play through it.
  if (autopilotMode) world = pilot.world;
  result = null;
  screen = 'play';
  AudioSys.init();
}

function finishHeist() {
  const r = {
    levelIdx: world.levelIdx,
    name: world.level.name,
    prize: world.level.prize,
    won: true,
    time: world.stats.timeUsed,
    par: world.level.par,
    rank: rankFor(world),
    score: scoreFor(world),
    loot: world.loot,
    lootTotal: world.lootTotal,
    strikes: world.strikes,
    closeCalls: world.stats.closeCalls,
    laserTrips: world.stats.laserTrips,
    cameraAlarms: world.stats.cameraAlarms,
  };
  campaignResults[world.levelIdx] = r;
  result = r;
  unlocked = Math.max(unlocked, Math.min(4, world.levelIdx + 1));
  saveUnlocked();
  AudioSys.win();
  result.last = world.levelIdx === LEVELS.length - 1;
  resultTimer = 0;
  screen = 'results';
}

function failHeist(reason) {
  campaignResults[world.levelIdx] = {
    levelIdx: world.levelIdx,
    name: world.level.name,
    prize: world.level.prize,
    won: false,
    time: null,
    par: world.level.par,
    rank: 'FAILED',
    score: 0,
    loot: world.loot,
    lootTotal: world.lootTotal,
    strikes: world.strikes,
    closeCalls: world.stats.closeCalls,
    laserTrips: 0,
    cameraAlarms: 0,
  };
  failReason = reason;
  screen = 'failed';
}

function nextAfterResults() {
  if (world.levelIdx >= LEVELS.length - 1) {
    screen = 'campaign';
    if (autopilotMode) window.__autopilotResult = campaignResults;
  } else {
    startHeist(world.levelIdx + 1);
  }
}

function stepPlay(dt) {
  const input = autopilotMode ? pilotInput(pilot, dt) : readInput();
  const ev = stepWorld(world, input, dt);
  const maxSus = Math.max(0, ...world.guards.map((g) => g.suspicion));
  AudioSys.setTension(maxSus);
  if (ev & EV_LOOT) AudioSys.pickup();
  if (ev & EV_PRIZE) AudioSys.prize();
  if (ev & EV_CAUGHT) AudioSys.caught();
  if (ev & EV_ALARM) AudioSys.alarm();
  if (ev & EV_WIN) { finishHeist(); return; }
  if (ev & EV_FAILED) {
    if (autopilotMode) {
      // The pilot retries a failed heist from scratch (fresh world).
      pilot = createPilot(world.levelIdx);
      world = pilot.world;
      return;
    }
    failHeist(world.strikes >= 3 ? 'Three strikes — the watch has the house now.' : "Time's up — the bells rang and the night is over.");
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const dtMs = lastTime ? t - lastTime : 16;
  lastTime = t;
  const dt = Math.min(0.1, dtMs / 1000);
  if (screen === 'title') {
    stepWorld(demoWorld, { mx: 0, my: 0, gait: 'walk' }, dt);
    if (demoWorld.state !== 'play') demoWorld = createWorld(0);
    if (wasPressed('Space') || wasPressed('Enter')) { AudioSys.init(); AudioSys.click(); startHeist(selectedLevel); }
    for (let i = 0; i < 5; i += 1) {
      if (wasPressed(`Digit${i + 1}`) && i <= unlocked) { selectedLevel = i; AudioSys.click(); }
    }
    if (screen === 'title') renderTitle(ctx, demoWorld, { selectedLevel, levelNames });
  } else if (screen === 'play') {
    if (wasPressed('KeyM')) { muted = AudioSys.toggleMute(); }
    if (wasPressed('KeyP') || wasPressed('Escape')) { screen = 'paused'; }
    else {
      acc += dt;
      while (acc >= STEP) { stepPlay(STEP); acc -= STEP; if (screen !== 'play') break; }
      if (screen === 'play') renderPlay(ctx, world, null, { muted });
    }
  } else if (screen === 'paused') {
    if (wasPressed('KeyP') || wasPressed('Escape')) screen = 'play';
    if (screen === 'paused') renderPaused(ctx, world);
  } else if (screen === 'results') {
    if (autopilotMode) {
      resultTimer += dt;
      if (resultTimer > 1.2) { resultTimer = 0; AudioSys.click(); nextAfterResults(); }
    } else if (wasPressed('Space') || wasPressed('Enter')) { AudioSys.click(); nextAfterResults(); }
    if (screen === 'results') renderResults(ctx, world, result);
  } else if (screen === 'failed') {
    if (wasPressed('Space') || wasPressed('Enter')) { AudioSys.click(); startHeist(world.levelIdx); }
    if (screen === 'failed') renderFailed(ctx, world, failReason);
  } else if (screen === 'campaign') {
    if (wasPressed('KeyR')) { campaignResults = []; startHeist(0); }
    if (screen === 'campaign') renderCampaign(ctx, campaignResults);
  }
  endFrame();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play') screen = 'paused';
});
window.addEventListener('keydown', () => AudioSys.init(), { once: true });
window.addEventListener('mousedown', () => AudioSys.init(), { once: true });
bindInput(canvas);

// --- screenshot staging: one frozen frame from the real simulation -----------
const shot = params.get('shot');
if (shot) {
  const staged = stageShot(shot);
  if (staged.screen === 'campaign') {
    renderCampaign(ctx, staged.results);
  } else if (staged.screen === 'title') {
    renderTitle(ctx, staged.world, { selectedLevel: 0, levelNames });
  } else {
    renderPlay(ctx, staged.world, staged.notes, { muted: true });
  }
  window.__shotReady = true;
  window.__shotName = shot;
} else if (autopilotMode) {
  campaignResults = [];
  startHeist(0);
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(frame);
}
