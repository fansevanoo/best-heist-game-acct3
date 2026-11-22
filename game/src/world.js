// World simulation for The Marrowgate Heists — pure logic, no DOM or canvas.
// Guards patrol with raycast vision cones, suspicion meters and five states;
// light and shadow decide what they can see; gadgets, cameras and lasers add
// pressure. The autopilot and the screenshot stager run this same code.
import { TILE, COLS, ROWS, GAITS, VISION, CAMERA, LASER, clamp, dist, angleDiff, angleLerp, normalizeAngle } from './config.js';
import { LEVELS, GADGET_STOCK, parseMap } from './levels.js';

export const EV_NONE = 0;
export const EV_PRIZE = 1;
export const EV_LOOT = 2;
export const EV_CAUGHT = 4;
export const EV_WIN = 8;
export const EV_FAILED = 16;
export const EV_ALARM = 32;

const PLAYER_R = 13;
const GUARD_R = 13;
const LAMP_RADIUS = 118;

// --- tile helpers ------------------------------------------------------------
function key(c, r) { return `${c},${r}`; }
function tileAt(world, x, y) {
  return { c: Math.floor(x / TILE), r: Math.floor(y / TILE) };
}
export function isSolidTile(world, c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
  const k = key(c, r);
  return world.grid.walls.has(k) || world.grid.cover.has(k);
}
export function isWalkableTile(world, c, r) { return !isSolidTile(world, c, r); }

// Line of sight: DDA through solid tiles. Cover (crates/pillars) blocks sight.
export function losClear(world, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const { c, r } = tileAt(world, x1 + dx * t, y1 + dy * t);
    if (isSolidTile(world, c, r)) return false;
  }
  return true;
}

// Light level 0..1 at a point: lamp pools (a doused lamp gives none).
export function lightAt(world, x, y) {
  let lit = 0;
  for (const lamp of world.grid.lamps) {
    if (lamp.out) continue;
    const d = dist(x, y, lamp.x, lamp.y);
    if (d < LAMP_RADIUS) lit = Math.max(lit, 1 - d / LAMP_RADIUS);
  }
  return lit;
}

function inSmoke(world, x, y) {
  for (const s of world.smoke) if (dist(x, y, s.x, s.y) < s.r) return true;
  return false;
}

function playerTileKind(world) {
  const { c, r } = tileAt(world, world.player.x, world.player.y);
  const k = key(c, r);
  if (world.grid.grass.has(k)) return 'grass';
  if (world.grid.water.has(k)) return 'water';
  return 'floor';
}

// --- world construction ------------------------------------------------------
export function createWorld(levelIdx) {
  const level = LEVELS[levelIdx];
  const grid = parseMap(level.map);
  const world = {
    levelIdx, level, grid,
    time: 0,
    timeLeft: level.timeLimit,
    state: 'play', // play | won | failed
    strikes: 0,
    loot: 0,
    lootTotal: grid.treasures.length,
    prizeTaken: false,
    events: EV_NONE,
    stats: { maxSuspicion: 0, everChase: false, everInvestigate: false, laserTrips: 0, cameraAlarms: 0, closeCalls: 0, timeUsed: 0 },
    gadgets: { ...GADGET_STOCK },
    smoke: [],
    coins: [], // flying coins
    rings: [], // coin landing rings (visible while the noise lasts)
    crickets: [], // placed noisemakers
    noiseLog: [], // {x, y, r} recent noises, consumed by guards
    player: {
      x: grid.entrance.x, y: grid.entrance.y, dir: 0, gait: 'walk',
      moving: false, stepTimer: 0, caughtFlash: 0,
    },
    guards: level.guards.map((g) => ({
      name: g.name,
      waypoints: g.waypoints.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 })),
      pause: g.pause,
      x: g.waypoints[0][0] * TILE + TILE / 2,
      y: g.waypoints[0][1] * TILE + TILE / 2,
      angle: 0, wp: 0, wait: 0,
      state: 'patrol', // patrol | suspicious | investigate | search | chase | return
      suspicion: 0, grace: 0, lastSeen: null, lostTimer: 0, searchTimer: 0,
      target: null, speed: 55,
    })),
    cameras: (level.cameras || []).map((c) => ({
      x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2,
      base: c.angle, sweep: c.sweep, angle: c.angle, alarm: 0, cooldown: 0,
    })),
    lasers: (level.lasers || []).map((l) => ({
      x1: l.x1 * TILE + TILE / 2, y1: l.y1 * TILE + TILE / 2,
      x2: l.x2 * TILE + TILE / 2, y2: l.y2 * TILE + TILE / 2,
      tripped: false,
    })),
    message: '',
    messageTimer: 0,
  };
  return world;
}

// --- guard vision ------------------------------------------------------------
function guardSeesPlayer(world, g) {
  const p = world.player;
  const d = dist(g.x, g.y, p.x, p.y);
  if (d > VISION.range) return 0;
  const toPlayer = Math.atan2(p.y - g.y, p.x - g.x);
  if (Math.abs(angleDiff(g.angle, toPlayer)) > VISION.fov / 2) return 0;
  if (!losClear(world, g.x, g.y, p.x, p.y)) return 0;
  if (inSmoke(world, (g.x + p.x) / 2, (g.y + p.y) / 2) || inSmoke(world, p.x, p.y)) return 0;
  const lit = lightAt(world, p.x, p.y);
  const kind = playerTileKind(world);
  if (kind === 'grass' && d > VISION.grassHideRange) return 0;
  if (lit < VISION.litThreshold && d > VISION.nearRange) return 0;
  // Sneaking in dim light is harder to spot than walking in the open.
  const gaitFactor = p.gait === 'sneak' ? 0.55 : p.gait === 'sprint' ? 1.25 : 1;
  return clamp((lit < VISION.litThreshold ? VISION.riseDim : VISION.riseFull) * gaitFactor, 0, 1.2);
}

function cameraSeesPlayer(world, cam) {
  const p = world.player;
  const d = dist(cam.x, cam.y, p.x, p.y);
  if (d > CAMERA.range) return false;
  if (Math.abs(angleDiff(cam.angle, Math.atan2(p.y - cam.y, p.x - cam.x))) > CAMERA.halfAngle) return false;
  if (!losClear(world, cam.x, cam.y, p.x, p.y)) return false;
  if (inSmoke(world, p.x, p.y)) return false;
  if (lightAt(world, p.x, p.y) < VISION.litThreshold && d > VISION.nearRange) return false;
  return true;
}

// --- movement with collision -------------------------------------------------
function moveCircle(world, ent, dx, dy, radius) {
  // X then Y so the entity slides along walls.
  let nx = ent.x + dx;
  if (!circleHitsSolid(world, nx, ent.y, radius)) ent.x = nx;
  let ny = ent.y + dy;
  if (!circleHitsSolid(world, ent.x, ny, radius)) ent.y = ny;
}

function circleHitsSolid(world, x, y, radius) {
  const c0 = Math.floor((x - radius) / TILE), c1 = Math.floor((x + radius) / TILE);
  const r0 = Math.floor((y - radius) / TILE), r1 = Math.floor((y + radius) / TILE);
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      if (!isSolidTile(world, c, r)) continue;
      const cx = clamp(x, c * TILE, c * TILE + TILE);
      const cy = clamp(y, r * TILE, r * TILE + TILE);
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < radius * radius) return true;
    }
  }
  return false;
}

function moveToward(world, ent, tx, ty, speed, dt, radius) {
  const d = dist(ent.x, ent.y, tx, ty);
  if (d < 2) return true;
  const vx = ((tx - ent.x) / d) * speed * dt;
  const vy = ((ty - ent.y) / d) * speed * dt;
  ent.angle = Math.atan2(ty - ent.y, tx - ent.x);
  moveCircle(world, ent, vx, vy, radius);
  return d < speed * dt + 2;
}

// --- noise --------------------------------------------------------------------
function emitNoise(world, x, y, r) {
  world.noiseLog.push({ x, y, r });
  for (const g of world.guards) {
    if (g.state === 'chase') continue;
    if (dist(g.x, g.y, x, y) <= r) {
      if (g.suspicion < VISION.investigateAt) g.suspicion = VISION.investigateAt;
      g.state = 'investigate';
      g.target = { x, y };
      g.lastSeen = { x, y };
      world.stats.everInvestigate = true;
    }
  }
}

// --- the step ------------------------------------------------------------------
export function stepWorld(world, input, dt) {
  world.events = EV_NONE;
  if (world.state !== 'play') return world.events;
  world.time += dt;
  world.timeLeft -= dt;
  if (world.timeLeft <= 0) {
    world.state = 'failed';
    world.events |= EV_FAILED;
    return world.events;
  }
  if (world.messageTimer > 0) world.messageTimer -= dt;

  const p = world.player;
  // --- player movement ---
  const gait = input.gait || 'walk';
  p.gait = gait;
  const speed = GAITS[gait].speed;
  const mx = input.mx || 0, my = input.my || 0;
  const mag = Math.hypot(mx, my);
  p.moving = mag > 0.1;
  if (p.moving) {
    const nx = (mx / Math.max(1, mag)) * speed * dt;
    const ny = (my / Math.max(1, mag)) * speed * dt;
    p.dir = Math.atan2(ny, nx);
    moveCircle(world, p, nx, ny, PLAYER_R);
    // Footsteps: walk and sprint make noise, more on water.
    p.stepTimer -= dt;
    const noiseR = GAITS[gait].noise + (playerTileKind(world) === 'water' ? 60 : 0);
    if (p.stepTimer <= 0 && noiseR > 0) {
      p.stepTimer = 0.38;
      emitNoise(world, p.x, p.y, noiseR);
    }
  }

  // --- gadgets ---
  if (input.throwCoin && world.gadgets.coin > 0 && input.aim) {
    world.gadgets.coin -= 1;
    world.coins.push({ x: p.x, y: p.y, tx: input.aim.x, ty: input.aim.y, t: 0, dur: 0.38 });
  }
  if (input.throwSmoke && world.gadgets.smoke > 0 && input.aim) {
    world.gadgets.smoke -= 1;
    const d = Math.min(dist(p.x, p.y, input.aim.x, input.aim.y), 260);
    const a = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);
    world.smoke.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 74, ttl: 6 });
  }
  if (input.placeCricket && world.gadgets.cricket > 0) {
    world.gadgets.cricket -= 1;
    world.crickets.push({ x: p.x, y: p.y, ttl: 8, chirp: 0 });
  }
  if (input.douse && world.gadgets.douse > 0) {
    let best = null, bestD = 130;
    for (const lamp of world.grid.lamps) {
      if (lamp.out) continue;
      const d = dist(p.x, p.y, lamp.x, lamp.y);
      if (d < bestD) { best = lamp; bestD = d; }
    }
    if (best) { best.out = true; world.gadgets.douse -= 1; world.message = 'Lamp doused — the dark is yours.'; world.messageTimer = 2.5; }
  }
  // Flying coins land and ring.
  for (let i = world.coins.length - 1; i >= 0; i -= 1) {
    const c = world.coins[i];
    c.t += dt;
    if (c.t >= c.dur) {
      world.coins.splice(i, 1);
      world.rings.push({ x: c.tx, y: c.ty, t: 0 });
      emitNoise(world, c.tx, c.ty, 240);
    }
  }
  // Landing rings fade out over two seconds.
  for (let i = world.rings.length - 1; i >= 0; i -= 1) {
    world.rings[i].t += dt;
    if (world.rings[i].t > 2) world.rings.splice(i, 1);
  }
  // Crickets chirp and draw guards.
  for (let i = world.crickets.length - 1; i >= 0; i -= 1) {
    const c = world.crickets[i];
    c.ttl -= dt;
    c.chirp -= dt;
    if (c.chirp <= 0) { c.chirp = 1.2; emitNoise(world, c.x, c.y, 200); }
    if (c.ttl <= 0) world.crickets.splice(i, 1);
  }
  for (let i = world.smoke.length - 1; i >= 0; i -= 1) {
    world.smoke[i].ttl -= dt;
    if (world.smoke[i].ttl <= 0) world.smoke.splice(i, 1);
  }
  world.noiseLog.length = 0;

  // --- pickups ---
  for (const t of world.grid.treasures) {
    if (!t.taken && dist(p.x, p.y, t.x, t.y) < 26) {
      t.taken = true;
      world.loot += 1;
      world.events |= EV_LOOT;
    }
  }
  const prize = world.grid.prize;
  if (prize && !prize.taken && dist(p.x, p.y, prize.x, prize.y) < 28) {
    prize.taken = true;
    world.prizeTaken = true;
    world.grid.exit.open = true;
    world.events |= EV_PRIZE;
    world.message = `${world.level.prize} taken — reach the green hatch!`;
    world.messageTimer = 3;
  }

  // --- exit ---
  const exit = world.grid.exit;
  if (exit && exit.open && dist(p.x, p.y, exit.x, exit.y) < 28) {
    world.state = 'won';
    world.stats.timeUsed = world.time;
    world.events |= EV_WIN;
    return world.events;
  }

  // --- cameras ---
  for (const cam of world.cameras) {
    cam.angle = cam.base + Math.sin(world.time * CAMERA.sweepSpeed) * cam.sweep;
    if (cam.cooldown > 0) { cam.cooldown -= dt; continue; }
    if (cameraSeesPlayer(world, cam)) {
      cam.alarm += dt / 1.6;
      if (cam.alarm >= 1) {
        cam.alarm = 0;
        cam.cooldown = 5;
        world.stats.cameraAlarms += 1;
        world.events |= EV_ALARM;
        world.message = 'Camera alarm! Guards are coming to look.';
        world.messageTimer = 2.5;
        for (const g of world.guards) {
          if (g.state !== 'chase') {
            g.state = 'investigate';
            g.target = { x: p.x, y: p.y };
            g.lastSeen = { x: p.x, y: p.y };
            if (g.suspicion < VISION.investigateAt) g.suspicion = VISION.investigateAt;
          }
        }
      }
    } else {
      cam.alarm = Math.max(0, cam.alarm - dt * 0.4);
    }
  }

  // --- lasers ---
  const phase = world.time % LASER.cycle;
  const lasersOn = phase < LASER.onTime;
  for (const lz of world.lasers) {
    if (!lasersOn) { lz.tripped = false; continue; }
    if (lz.tripped) continue;
    const d = distToSegment(p.x, p.y, lz.x1, lz.y1, lz.x2, lz.y2);
    if (d < 15) {
      lz.tripped = true;
      world.stats.laserTrips += 1;
      world.strikes += 1;
      world.events |= EV_ALARM;
      world.message = 'Laser tripped! One strike.';
      world.messageTimer = 2.5;
      for (const g of world.guards) {
        if (g.state !== 'chase') {
          g.state = 'investigate';
          g.target = { x: p.x, y: p.y };
          g.lastSeen = { x: p.x, y: p.y };
          if (g.suspicion < VISION.investigateAt) g.suspicion = VISION.investigateAt;
        }
      }
      if (world.strikes >= 3) {
        world.state = 'failed';
        world.events |= EV_FAILED;
        return world.events;
      }
    }
  }

  // --- guards ---
  for (const g of world.guards) {
    const seen = guardSeesPlayer(world, g);
    const wasSuspicion = g.suspicion;
    if (seen > 0) {
      if (g.grace > 0) { g.grace -= dt; }
      else {
        g.suspicion = clamp(g.suspicion + seen * dt, 0, 1);
        g.lastSeen = { x: p.x, y: p.y };
      }
      if (g.suspicion >= 1 && g.state !== 'chase') {
        g.state = 'chase';
        world.stats.everChase = true;
        world.message = `${g.name} has you! Run!`;
        world.messageTimer = 2;
      } else if (g.suspicion >= VISION.investigateAt && g.state === 'patrol') {
        g.state = 'investigate';
        g.target = { ...g.lastSeen };
        world.stats.everInvestigate = true;
      }
    } else {
      g.grace = VISION.grace;
      g.suspicion = Math.max(0, g.suspicion - VISION.decay * dt);
      if (g.state === 'chase') {
        g.lostTimer += dt;
        if (g.lostTimer > 3) {
          g.state = 'search';
          g.searchTimer = 4;
          g.target = g.lastSeen ? { ...g.lastSeen } : { x: g.x, y: g.y };
          g.lostTimer = 0;
        }
      }
    }
    if (g.suspicion > world.stats.maxSuspicion) world.stats.maxSuspicion = g.suspicion;
    if (wasSuspicion < VISION.investigateAt && g.suspicion >= VISION.investigateAt && g.state !== 'chase') {
      world.stats.closeCalls += 1;
    }

    // State movement.
    if (g.state === 'patrol') {
      const wp = g.waypoints[g.wp];
      if (g.wait > 0) {
        g.wait -= dt;
        // Look around while paused at a waypoint.
        g.angle += Math.sin(world.time * 1.4 + g.waypoints.length) * 0.012;
      } else if (moveToward(world, g, wp.x, wp.y, 55, dt, GUARD_R)) {
        g.wait = g.pause;
        g.wp = (g.wp + 1) % g.waypoints.length;
      }
    } else if (g.state === 'suspicious') {
      g.angle = angleLerp(g.angle, Math.atan2(p.y - g.y, p.x - g.x), dt * 3);
      if (g.suspicion < 0.3) g.state = 'patrol';
    } else if (g.state === 'investigate' && g.target) {
      if (moveToward(world, g, g.target.x, g.target.y, 88, dt, GUARD_R)) {
        g.state = 'search';
        g.searchTimer = 4;
      }
    } else if (g.state === 'search') {
      g.searchTimer -= dt;
      g.angle += dt * 1.6; // sweep the room
      if (g.searchTimer <= 0) {
        g.state = 'return';
        g.target = null;
      }
    } else if (g.state === 'chase') {
      const tx = g.lastSeen ? g.lastSeen.x : p.x;
      const ty = g.lastSeen ? g.lastSeen.y : p.y;
      moveToward(world, g, tx, ty, 152, dt, GUARD_R);
      if (dist(g.x, g.y, p.x, p.y) < 26) {
        world.strikes += 1;
        world.events |= EV_CAUGHT;
        world.message = `Caught by ${g.name}! Strike ${world.strikes} of 3.`;
        world.messageTimer = 3;
        if (world.strikes >= 3) {
          world.state = 'failed';
          world.events |= EV_FAILED;
          return world.events;
        }
        // Dragged back to the entrance; guards stand down.
        p.x = world.grid.entrance.x;
        p.y = world.grid.entrance.y;
        for (const gg of world.guards) {
          gg.state = 'patrol';
          gg.suspicion = 0;
          gg.lastSeen = null;
          gg.target = null;
          gg.lostTimer = 0;
        }
        for (const cam of world.cameras) cam.alarm = 0;
      }
    } else if (g.state === 'return') {
      // Walk back to the nearest waypoint, then resume patrol.
      let best = null, bestD = Infinity;
      for (let i = 0; i < g.waypoints.length; i += 1) {
        const d = dist(g.x, g.y, g.waypoints[i].x, g.waypoints[i].y);
        if (d < bestD) { bestD = d; best = i; }
      }
      const wp = g.waypoints[best];
      if (moveToward(world, g, wp.x, wp.y, 70, dt, GUARD_R)) {
        g.wp = best;
        g.state = 'patrol';
        g.suspicion = 0;
      }
    }
    if (g.state !== 'chase' && g.state !== 'investigate') {
      // Face movement direction when patrolling; handled by moveToward.
    }
  }

  return world.events;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + dx * t, y1 + dy * t);
}

// --- scoring -------------------------------------------------------------------
export function rankFor(world) {
  const s = world.stats;
  const underPar = world.stats.timeUsed <= world.level.par;
  if (!s.everInvestigate && !s.everChase && s.laserTrips === 0 && s.cameraAlarms === 0 && underPar) return 'GHOST';
  if (!s.everChase && underPar) return 'SHADOW';
  if (world.strikes <= 1) return 'CUTPURSE';
  return 'RUCKUS';
}

export function scoreFor(world) {
  const s = world.stats;
  const timeBonus = Math.max(0, Math.round((world.level.par - s.timeUsed) * 10));
  const ghostBonus = rankFor(world) === 'GHOST' ? 500 : 0;
  return 1000 + world.loot * 150 + timeBonus + ghostBonus;
}

export function lasersOnNow(world) {
  return (world.time % LASER.cycle) < LASER.onTime;
}
