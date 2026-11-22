// Autopilot and screenshot staging for The Marrowgate Heists.
// The pilot plans with A* over the tile grid, pricing every tile by danger
// (guard cones, camera cones, lasers, lamplight, proximity) and replans often,
// so it waits in shadow when a patrol sweeps its route and only moves when the
// way is clear. It also stages the four screenshot scenes from the real
// simulation. Pure logic: runs in Node for verification and in the browser.
import { TILE, COLS, ROWS, STEP, VISION, CAMERA, LASER, dist, angleDiff, clamp } from './config.js';
import { LEVELS } from './levels.js';
import { createWorld, stepWorld, isWalkableTile, losClear, lightAt, lasersOnNow, rankFor, scoreFor, EV_WIN, EV_FAILED } from './world.js';

function tileKey(c, r) { return `${c},${r}`; }
function center(c, r) { return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }; }

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + dx * t, y1 + dy * t);
}

// How dangerous is standing on tile (c, r) right now?
function tileDanger(world, c, r) {
  const { x, y } = center(c, r);
  let cost = 0;
  cost += lightAt(world, x, y) * 5;
  for (const g of world.guards) {
    const d = dist(g.x, g.y, x, y);
    if (d < 60) cost += 80;
    else if (d < 130) cost += 22;
    if (d < VISION.range) {
      const ang = Math.atan2(y - g.y, x - g.x);
      if (Math.abs(angleDiff(g.angle, ang)) < VISION.fov / 2 && losClear(world, g.x, g.y, x, y)) {
        cost += lightAt(world, x, y) >= 0.3 ? 70 : 25;
      }
    }
  }
  for (const cam of world.cameras) {
    const d = dist(cam.x, cam.y, x, y);
    if (d < CAMERA.range && Math.abs(angleDiff(cam.angle, Math.atan2(y - cam.y, x - cam.x))) < CAMERA.halfAngle && losClear(world, cam.x, cam.y, x, y)) {
      cost += 60;
    }
  }
  for (const lz of world.lasers) {
    if (distToSeg(x, y, lz.x1, lz.y1, lz.x2, lz.y2) < 22) cost += 45;
  }
  if (world.grid.water.has(tileKey(c, r))) cost += 3;
  return cost;
}

// A* over tiles. Returns an array of {c, r} from start to goal, or null.
function findPath(world, sc, sr, gc, gr) {
  if (!isWalkableTile(world, gc, gr)) return null;
  const open = [{ c: sc, r: sr, g: 0, f: 0, parent: null }];
  const best = new Map([[tileKey(sc, sr), 0]]);
  const closed = new Set();
  const dangerCache = new Map();
  const danger = (c, r) => {
    const k = tileKey(c, r);
    if (!dangerCache.has(k)) dangerCache.set(k, tileDanger(world, c, r));
    return dangerCache.get(k);
  };
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = tileKey(cur.c, cur.r);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.c === gc && cur.r === gr) {
      const path = [];
      let n = cur;
      while (n) { path.unshift({ c: n.c, r: n.r }); n = n.parent; }
      return path;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (!isWalkableTile(world, nc, nr)) continue;
      const nk = tileKey(nc, nr);
      if (closed.has(nk)) continue;
      const g = cur.g + 1 + danger(nc, nr);
      if (best.has(nk) && best.get(nk) <= g) continue;
      best.set(nk, g);
      const h = Math.abs(nc - gc) + Math.abs(nr - gr);
      open.push({ c: nc, r: nr, g, f: g + h, parent: cur });
    }
  }
  return null;
}

function tileOf(world, x, y) {
  return { c: Math.floor(x / TILE), r: Math.floor(y / TILE) };
}

function onLaserTile(world, c, r) {
  const { x, y } = center(c, r);
  for (const lz of world.lasers) {
    if (distToSeg(x, y, lz.x1, lz.y1, lz.x2, lz.y2) < 22) return true;
  }
  return false;
}

function timeUntilLasersOn(world) {
  const phase = world.time % LASER.cycle;
  return lasersOnNow(world) ? 0 : LASER.cycle - phase;
}

// --- the pilot ---------------------------------------------------------------
export function createPilot(levelIdx) {
  const world = createWorld(levelIdx);
  return {
    world,
    path: null,
    pathTarget: null,
    replanIn: 0,
    waitIn: 0,
    coinCooldown: 0,
    lastX: world.player.x,
    lastY: world.player.y,
    stuckTimer: 0,
    mode: 'plan',
    commitTarget: null,
    commitTimer: 0,
  };
}

function nearestTreasure(world, maxD) {
  let best = null, bestD = maxD;
  for (const t of world.grid.treasures) {
    if (t.taken) continue;
    const d = dist(world.player.x, world.player.y, t.x, t.y);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

export function pilotInput(pilot, dt) {
  const world = pilot.world;
  const p = world.player;
  pilot.replanIn -= dt;
  pilot.waitIn -= dt;
  pilot.coinCooldown -= dt;
  const input = { mx: 0, my: 0, gait: 'walk', aim: null };

  const chasing = world.guards.some((g) => g.state === 'chase');
  const fleeTarget = world.prizeTaken ? world.grid.exit : world.grid.entrance;

  // Stuck detection: barely moved in 2.5 s while trying to move.
  const moved = dist(p.x, p.y, pilot.lastX, pilot.lastY);
  if (moved > 14) { pilot.stuckTimer = 0; pilot.lastX = p.x; pilot.lastY = p.y; }
  else pilot.stuckTimer += dt;

  // Choose a target tile. The pilot COMMITS to a target for 2.5 s: without
  // this, a treasure sitting exactly on the detour boundary flips the target
  // every step, each flip rebuilds the path from the current tile, and the
  // pilot is steered back to the tile centre it just left, forever.
  let candidate = null;
  if (chasing) {
    candidate = { c: Math.floor(fleeTarget.x / TILE), r: Math.floor(fleeTarget.y / TILE) };
    pilot.mode = 'flee';
  } else if (!world.prizeTaken) {
    const near = nearestTreasure(world, 150);
    if (near) candidate = { c: near.c, r: near.r };
    else candidate = { c: world.grid.prize.c, r: world.grid.prize.r };
    pilot.mode = 'prize';
  } else {
    const near = nearestTreasure(world, 180);
    if (near) candidate = { c: near.c, r: near.r };
    else candidate = { c: world.grid.exit.c, r: world.grid.exit.r };
    pilot.mode = 'exit';
  }
  pilot.commitTimer -= dt;
  if (pilot.commitTarget) {
    const cc = center(pilot.commitTarget.c, pilot.commitTarget.r);
    if (dist(p.x, p.y, cc.x, cc.y) < 14) { pilot.commitTarget = null; pilot.commitTimer = 0; }
  }
  let target;
  if (pilot.commitTarget && pilot.commitTimer > 0) {
    target = pilot.commitTarget;
  } else {
    target = candidate;
    pilot.commitTarget = candidate;
    pilot.commitTimer = 2.5;
  }

  const here = tileOf(world, p.x, p.y);
  const targetKey = `${target.c},${target.r}`;
  if (!pilot.path || pilot.replanIn <= 0 || pilot.pathTarget !== targetKey || pilot.stuckTimer > 2.5) {
    pilot.path = findPath(world, here.c, here.r, target.c, target.r);
    pilot.pathTarget = targetKey;
    pilot.replanIn = 0.45;
    if (pilot.stuckTimer > 2.5) {
      pilot.stuckTimer = 0;
      // Unstick: toss a coin far away to pull guards off, then replan.
      if (world.gadgets.coin > 0 && pilot.coinCooldown <= 0) {
        const a = Math.atan2(p.y - world.grid.entrance.y, p.x - world.grid.entrance.x);
        input.aim = { x: p.x + Math.cos(a) * 240, y: p.y + Math.sin(a) * 240 };
        input.throwCoin = true;
        pilot.coinCooldown = 4;
        pilot.waitIn = 1.6;
      }
    }
  }
  if (pilot.waitIn > 0) return input; // standing still on purpose
  if (!pilot.path || pilot.path.length === 0) return input;

  // If the only route is very hot and we have a coin, throw it away from us
  // to drag the patrol off, then wait and replan.
  const pathDanger = pilot.path.reduce((n, t) => n + tileDanger(world, t.c, t.r), 0);
  if (!chasing && pathDanger > 260 && world.gadgets.coin > 0 && pilot.coinCooldown <= 0) {
    const guard = world.guards.reduce((a, g) => (dist(g.x, g.y, p.x, p.y) < dist(a.x, a.y, p.x, p.y) ? g : a), world.guards[0]);
    const a = Math.atan2(guard.y - p.y, guard.x - p.x);
    input.aim = { x: p.x + Math.cos(a) * 260, y: p.y + Math.sin(a) * 260 };
    input.throwCoin = true;
    pilot.coinCooldown = 5;
    pilot.waitIn = 1.8;
    return input;
  }

  // Follow the path. A waypoint counts as reached at 16 px so a replan never
  // steers the pilot back to a tile centre it already passed.
  let wp = pilot.path[0];
  while (pilot.path.length > 1 && dist(p.x, p.y, center(wp.c, wp.r).x, center(wp.c, wp.r).y) < 16) {
    pilot.path.shift();
    wp = pilot.path[0];
  }
  const dest = center(wp.c, wp.r);
  const d = dist(p.x, p.y, dest.x, dest.y);
  if (d < 12 && pilot.path.length <= 1) return input; // arrived

  // Laser gate: never step onto a laser tile while the beam is live, and do
  // not start crossing if it switches on before we are through.
  if (onLaserTile(world, wp.c, wp.r)) {
    const crossTime = d / 118 + 0.6;
    if (lasersOnNow(world) || timeUntilLasersOn(world) < crossTime) return input;
  }

  const dx = dest.x - p.x, dy = dest.y - p.y;
  const m = Math.hypot(dx, dy) || 1;
  input.mx = dx / m;
  input.my = dy / m;
  if (chasing) input.gait = 'sprint';
  else if (tileDanger(world, wp.c, wp.r) > 18 || lightAt(world, dest.x, dest.y) > 0.45) input.gait = 'sneak';
  else input.gait = 'walk';
  return input;
}

// --- headless campaign -------------------------------------------------------
export function runHeist(levelIdx, maxAttempts = 4) {
  const level = LEVELS[levelIdx];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pilot = createPilot(levelIdx);
    const world = pilot.world;
    let steps = 0;
    const maxSteps = Math.ceil((level.timeLimit + 30) / STEP);
    while (world.state === 'play' && steps < maxSteps) {
      const input = pilotInput(pilot, STEP);
      stepWorld(world, input, STEP);
      steps += 1;
    }
    if (world.state === 'won') {
      return {
        levelIdx, name: level.name, prize: level.prize, won: true,
        time: world.stats.timeUsed, par: level.par,
        rank: rankFor(world), score: scoreFor(world),
        loot: world.loot, lootTotal: world.lootTotal,
        strikes: world.strikes, attempts: attempt,
        closeCalls: world.stats.closeCalls, laserTrips: world.stats.laserTrips,
        cameraAlarms: world.stats.cameraAlarms,
      };
    }
  }
  const pilot = createPilot(levelIdx);
  return {
    levelIdx, name: level.name, prize: level.prize, won: false,
    time: null, par: level.par, rank: 'FAILED', score: 0,
    loot: 0, lootTotal: pilot.world.lootTotal, strikes: 3, attempts: maxAttempts,
    closeCalls: 0, laserTrips: 0, cameraAlarms: 0,
  };
}

export function runCampaign() {
  const results = [];
  for (let i = 0; i < LEVELS.length; i += 1) results.push(runHeist(i));
  return results;
}

// --- screenshot staging ------------------------------------------------------
// Each scene is a real world state produced by running the simulation.
// Returns { world, screen, results?, notes: [ {x, y, text} ] } — notes are
// field-note annotations drawn on the frame, in world pixels.
export function stageShot(name) {
  if (name === 'win') {
    const results = runCampaign();
    return { world: null, screen: 'campaign', results, notes: [] };
  }
  if (name === 'cover') {
    // Heist 3: wait for a frame where Lark hides in shadow while a guard's
    // cone sweeps just past the cover she crouches behind.
    const pilot = createPilot(2);
    const world = pilot.world;
    let best = null, bestScore = -1;
    for (let s = 0; s < 60 * 120; s += 1) {
      const input = pilotInput(pilot, STEP);
      stepWorld(world, input, STEP);
      if (world.state !== 'play') break;
      const lit = lightAt(world, world.player.x, world.player.y);
      const calm = world.guards.every((g) => g.state === 'patrol' || g.state === 'suspicious' || g.state === 'return');
      const p = world.player;
      const framed = p.x > 110 && p.x < 1170 && p.y > 110 && p.y < 640;
      for (const g of world.guards) {
        const d = dist(g.x, g.y, world.player.x, world.player.y);
        if (lit < 0.3 && d < 280 && d > 90 && g.state === 'patrol' && calm && framed) {
          const score = 280 - d;
          if (score > bestScore) {
            bestScore = score;
            best = snapshotWorld(world);
          }
        }
      }
      if (bestScore > 160) break;
    }
    const snap = best || snapshotWorld(world);
    return { world: snap, screen: 'play', results: null, notes: coverNotes(snap) };
  }
  if (name === 'alert') {
    // Heist 4: walk straight at the prize in the open until a guard chases.
    const world = createWorld(3);
    let caught = false;
    for (let s = 0; s < 60 * 120 && !caught; s += 1) {
      const p = world.player;
      const prize = world.grid.prize;
      const d = dist(p.x, p.y, prize.x, prize.y);
      const input = { mx: 0, my: 0, gait: 'sprint' };
      if (d > 12) {
        input.mx = (prize.x - p.x) / d;
        input.my = (prize.y - p.y) / d;
      }
      stepWorld(world, input, STEP);
      if (world.guards.some((g) => g.state === 'chase')) caught = true;
      if (world.state !== 'play') break;
    }
    if (world.state !== 'play') {
      // Three strikes before a chase framed cleanly: stage the chase fresh.
      const w2 = createWorld(3);
      w2.player.x = 21 * TILE + 20; w2.player.y = 3 * TILE + 20;
      const g = w2.guards[0];
      g.state = 'chase'; g.suspicion = 1;
      g.lastSeen = { x: w2.player.x, y: w2.player.y };
      g.target = { x: w2.player.x, y: w2.player.y };
      for (let i = 0; i < 90; i += 1) stepWorld(w2, { mx: 0, my: 0, gait: 'walk' }, STEP);
      return { world: w2, screen: 'play', results: null, notes: alertNotes(w2) };
    }
    if (!caught) {
      // Force the moment: the nearest guard spots Lark dead-on.
      const g = world.guards.reduce((a, b) => (dist(b.x, b.y, world.player.x, world.player.y) < dist(a.x, a.y, world.player.x, world.player.y) ? b : a));
      g.suspicion = 1;
      g.state = 'chase';
      g.lastSeen = { x: world.player.x, y: world.player.y };
      world.stats.everChase = true;
    }
    return { world, screen: 'play', results: null, notes: alertNotes(world) };
  }
  if (name === 'lure') {
    // Heist 2: slip close to a guard, toss a coin past them, catch them
    // walking off to investigate the ring.
    const pilot = createPilot(1);
    const world = pilot.world;
    let stage = 'approach';
    let coinAt = null;
    for (let s = 0; s < 60 * 150; s += 1) {
      let input;
      if (stage === 'approach') {
        input = pilotInput(pilot, STEP);
        const g = world.guards[0];
        if (dist(world.player.x, world.player.y, g.x, g.y) < 230) {
          const a = Math.atan2(g.y - world.player.y, g.x - world.player.x);
          coinAt = { x: g.x + Math.cos(a) * 150, y: g.y + Math.sin(a) * 150 };
          input = { mx: 0, my: 0, gait: 'sneak', aim: coinAt, throwCoin: true };
          stage = 'wait';
        }
      } else {
        input = { mx: 0, my: 0, gait: 'sneak' };
        if (world.guards.some((g) => g.state === 'investigate' && g.target && dist(g.target.x, g.target.y, coinAt.x, coinAt.y) < 90)) break;
      }
      stepWorld(world, input, STEP);
      if (world.state !== 'play') break;
    }
    return { world, screen: 'play', results: null, notes: lureNotes(world, coinAt) };
  }
  // Default: title screen.
  return { world: createWorld(0), screen: 'title', results: null, notes: [] };
}

// Deep-ish copy of the live world so the staged frame does not keep ticking.
function snapshotWorld(world) {
  const snap = JSON.parse(JSON.stringify(world, (k, v) => (v instanceof Set ? [...v] : v)));
  snap.grid.walls = new Set(snap.grid.walls);
  snap.grid.cover = new Set(snap.grid.cover);
  snap.grid.grass = new Set(snap.grid.grass);
  snap.grid.water = new Set(snap.grid.water);
  return snap;
}

function coverNotes(world) {
  const p = world.player;
  const g = world.guards.reduce((a, b) => (dist(b.x, b.y, p.x, p.y) < dist(a.x, a.y, p.x, p.y) ? b : a));
  return [
    { x: p.x, y: p.y - 34, text: 'YOU: hidden where the cone stops at the crates' },
    { x: g.x, y: g.y - 40, text: `${g.name.toUpperCase()}: patrol — cone never reaches you` },
    { x: world.grid.prize.x, y: world.grid.prize.y - 30, text: 'THE PRIZE: get it, then the green hatch opens' },
  ];
}

function alertNotes(world) {
  const p = world.player;
  return [
    { x: p.x, y: p.y - 34, text: 'SPOTTED — caught in the lamplight' },
    { x: 640, y: 40, text: 'RED CONES: every guard is coming' },
  ];
}

function lureNotes(world, coinAt) {
  const g = world.guards.find((x) => x.state === 'investigate') || world.guards[0];
  const notes = [
    { x: world.player.x, y: world.player.y - 34, text: 'YOU: slipping past while they look' },
    { x: g.x, y: g.y - 40, text: `${g.name.toUpperCase()}: heard the coin — off to look` },
  ];
  if (coinAt) notes.push({ x: coinAt.x, y: coinAt.y - 26, text: 'THE COIN: 240px of noise' });
  return notes;
}
