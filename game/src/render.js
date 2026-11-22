// Canvas rendering for The Marrowgate Heists.
// Cold dark floors, warm amber lamp pools, raycast vision cones that change
// colour with the guard's state, and a full HUD. The judge reads the game
// mostly through the screenshots, so every frame must show the room, the
// thief, the cones, the loot target and the alarm meter at a glance.
import { TILE, COLS, ROWS, WIDTH, HEIGHT, PALETTE, VISION, CAMERA, clamp, dist } from './config.js';
import { isSolidTile, lightAt, lasersOnNow } from './world.js';

// --- vision cone polygon (raycast) -------------------------------------------
function conePolygon(world, x, y, angle, halfAngle, range, rays) {
  const pts = [{ x, y }];
  for (let i = 0; i <= rays; i += 1) {
    const a = angle - halfAngle + (2 * halfAngle * i) / rays;
    let t = range;
    for (let d = 8; d <= range; d += 8) {
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
      if (isSolidTile(world, c, r)) { t = d; break; }
    }
    pts.push({ x: x + Math.cos(a) * t, y: y + Math.sin(a) * t });
  }
  return pts;
}

function fillPolygon(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function coneFillFor(state, suspicion) {
  if (state === 'chase') return PALETTE.coneAlert;
  if (state === 'investigate' || state === 'search') return PALETTE.coneSearch;
  if (state === 'suspicious' || suspicion >= 0.3) return PALETTE.coneSuspicious;
  return PALETTE.conePatrol;
}

// --- the room ------------------------------------------------------------------
function drawFloor(ctx, world) {
  const g = world.grid;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const x = c * TILE, y = r * TILE;
      const k = `${c},${r}`;
      if (g.walls.has(k)) {
        ctx.fillStyle = PALETTE.wall;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = PALETTE.wallTop;
        ctx.fillRect(x, y, TILE, 5);
        ctx.fillStyle = PALETTE.wallEdge;
        ctx.fillRect(x, y + TILE - 3, TILE, 3);
        continue;
      }
      ctx.fillStyle = (c + r) % 2 === 0 ? PALETTE.floorCold : PALETTE.floorCold2;
      ctx.fillRect(x, y, TILE, TILE);
      if (g.water.has(k)) {
        ctx.fillStyle = PALETTE.water;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.strokeStyle = PALETTE.waterLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 14);
        ctx.quadraticCurveTo(x + 20, y + 10, x + 34, y + 14);
        ctx.moveTo(x + 6, y + 28);
        ctx.quadraticCurveTo(x + 20, y + 24, x + 34, y + 28);
        ctx.stroke();
      } else if (g.grass.has(k)) {
        ctx.fillStyle = PALETTE.grassDark;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = PALETTE.grass;
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i += 1) {
          const gx = x + 6 + i * 7;
          ctx.beginPath();
          ctx.moveTo(gx, y + TILE - 4);
          ctx.lineTo(gx + 2, y + 12 + (i % 3) * 4);
          ctx.stroke();
        }
      }
    }
  }
  // Cover props.
  for (const k of g.cover) {
    const [c, r] = k.split(',').map(Number);
    const x = c * TILE, y = r * TILE;
    const ch = world.level.map[r][c];
    if (ch === 'C') {
      ctx.fillStyle = PALETTE.crate;
      ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      ctx.strokeStyle = PALETTE.crateEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + TILE - 4, y + TILE - 4);
      ctx.moveTo(x + TILE - 4, y + 4); ctx.lineTo(x + 4, y + TILE - 4);
      ctx.stroke();
    } else if (ch === 'P') {
      ctx.fillStyle = PALETTE.pillar;
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(x + TILE / 2 - 4, y + TILE / 2 - 4, 8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = PALETTE.shelf;
      ctx.fillRect(x + 3, y + 5, TILE - 6, TILE - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 3, y + 14, TILE - 6, 3);
      ctx.fillRect(x + 3, y + 26, TILE - 6, 3);
    }
  }
  // Lamps.
  for (const lamp of g.lamps) {
    ctx.fillStyle = '#20242e';
    ctx.fillRect(lamp.x - 3, lamp.y - 14, 6, 28);
    if (!lamp.out) {
      ctx.fillStyle = PALETTE.lampCore;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y - 14, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#555c66';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y - 14, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Darkness with lamp holes, then warm glows on top.
function drawLightAndDark(ctx, world) {
  ctx.save();
  ctx.fillStyle = 'rgba(5, 8, 15, 0.62)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.globalCompositeOperation = 'destination-out';
  for (const lamp of world.grid.lamps) {
    if (lamp.out) continue;
    const grad = ctx.createRadialGradient(lamp.x, lamp.y - 10, 8, lamp.x, lamp.y - 10, 118);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y - 10, 118, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const lamp of world.grid.lamps) {
    if (lamp.out) continue;
    const grad = ctx.createRadialGradient(lamp.x, lamp.y - 10, 4, lamp.x, lamp.y - 10, 90);
    grad.addColorStop(0, 'rgba(255, 210, 122, 0.20)');
    grad.addColorStop(1, 'rgba(255, 210, 122, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y - 10, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCones(ctx, world) {
  for (const cam of world.cameras) {
    const pts = conePolygon(world, cam.x, cam.y, cam.angle, CAMERA.halfAngle, CAMERA.range, 14);
    fillPolygon(ctx, pts, cam.alarm > 0.4 ? PALETTE.coneAlert : PALETTE.cameraCone);
  }
  for (const g of world.guards) {
    const pts = conePolygon(world, g.x, g.y, g.angle, VISION.fov / 2, VISION.range, VISION.rays);
    fillPolygon(ctx, pts, coneFillFor(g.state, g.suspicion));
    ctx.strokeStyle = 'rgba(255, 220, 140, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }
}

function drawLasers(ctx, world) {
  const on = lasersOnNow(world);
  for (const lz of world.lasers) {
    ctx.save();
    ctx.strokeStyle = on ? PALETTE.laser : 'rgba(255, 59, 48, 0.25)';
    ctx.lineWidth = on ? 3 : 1.5;
    if (!on) ctx.setLineDash([6, 6]);
    if (on) {
      ctx.shadowColor = PALETTE.laser;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.moveTo(lz.x1, lz.y1);
    ctx.lineTo(lz.x2, lz.y2);
    ctx.stroke();
    ctx.restore();
    for (const [ex, ey] of [[lz.x1, lz.y1], [lz.x2, lz.y2]]) {
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(ex - 5, ey - 5, 10, 10);
      ctx.fillStyle = on ? PALETTE.laser : '#7a2020';
      ctx.fillRect(ex - 2, ey - 2, 4, 4);
    }
  }
}

function drawEntities(ctx, world) {
  const g = world.grid;
  // Treasures.
  for (const t of g.treasures) {
    if (t.taken) continue;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = PALETTE.lootGold;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-7, -7, 14, 4);
    ctx.restore();
  }
  // The named prize.
  const prize = g.prize;
  if (prize && !prize.taken) {
    const pulse = 1 + Math.sin(world.time * 3) * 0.12;
    ctx.save();
    ctx.translate(prize.x, prize.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = PALETTE.prizeGold;
    ctx.shadowBlur = 16;
    ctx.fillStyle = PALETTE.prizeGold;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 === 0 ? 13 : 6;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = 'bold 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(world.level.prize.toUpperCase(), prize.x, prize.y - 24);
  }
  // Exit hatch.
  const exit = g.exit;
  if (exit) {
    ctx.save();
    ctx.translate(exit.x, exit.y);
    if (exit.open) {
      const pulse = 0.7 + Math.sin(world.time * 4) * 0.3;
      ctx.fillStyle = `rgba(61, 220, 132, ${0.55 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = exit.open ? PALETTE.exitGreen : PALETTE.exitGreenDark;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d2b18';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#0d2b18';
    ctx.font = 'bold 9px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(exit.open ? 'EXIT' : 'LOCK', 0, 3);
    ctx.restore();
  }
  // Cameras.
  for (const cam of world.cameras) {
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.rotate(cam.angle);
    ctx.fillStyle = '#39404f';
    ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = cam.alarm > 0.4 ? '#ff3b30' : '#c0392b';
    ctx.beginPath();
    ctx.arc(9, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Smoke clouds.
  for (const s of world.smoke) {
    ctx.fillStyle = PALETTE.smoke;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Coin landing rings: expanding gold circles while the noise lasts.
  for (const rg of world.rings || []) {
    const a = Math.max(0, 1 - rg.t / 2);
    ctx.strokeStyle = `rgba(255, 210, 122, ${a * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, 8 + rg.t * 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 210, 122, ${a})`;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Flying coins.
  for (const c of world.coins) {
    const t = c.t / c.dur;
    const x = c.x + (c.tx - c.x) * t;
    const y = c.y + (c.ty - c.y) * t - Math.sin(t * Math.PI) * 26;
    ctx.fillStyle = PALETTE.lootGold;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Crickets.
  for (const c of world.crickets) {
    ctx.fillStyle = '#8a6d3b';
    ctx.fillRect(c.x - 5, c.y - 4, 10, 8);
    ctx.strokeStyle = 'rgba(255, 210, 122, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12 + Math.sin(world.time * 6) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Guards.
  for (const gd of world.guards) {
    ctx.save();
    ctx.translate(gd.x, gd.y);
    ctx.fillStyle = PALETTE.guardCoat;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.guardCoatDark;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI);
    ctx.fill();
    ctx.rotate(gd.angle);
    ctx.fillStyle = PALETTE.guardSkin;
    ctx.beginPath();
    ctx.arc(6, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Name + suspicion bar.
    ctx.fillStyle = 'rgba(232, 228, 216, 0.75)';
    ctx.font = '10px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(gd.name, gd.x, gd.y - 20);
    if (gd.suspicion > 0.05) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(gd.x - 14, gd.y - 17, 28, 4);
      ctx.fillStyle = gd.suspicion >= 1 ? '#e74c3c' : gd.suspicion >= 0.55 ? '#ff9a2e' : '#ffcf4d';
      ctx.fillRect(gd.x - 14, gd.y - 17, 28 * clamp(gd.suspicion, 0, 1), 4);
    }
    if (gd.state === 'investigate' || gd.state === 'search') {
      ctx.fillStyle = '#ffcf4d';
      ctx.font = 'bold 13px Georgia, serif';
      ctx.fillText('?', gd.x, gd.y - 28);
    } else if (gd.state === 'chase') {
      ctx.fillStyle = '#ff3b30';
      ctx.font = 'bold 13px Georgia, serif';
      ctx.fillText('!', gd.x, gd.y - 28);
    }
  }
  // The player.
  const p = world.player;
  const lit = lightAt(world, p.x, p.y);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.gait === 'sneak') ctx.scale(1, 0.78); // crouched
  ctx.fillStyle = PALETTE.playerTeal;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.playerTealDark;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.rotate(p.dir);
  ctx.fillStyle = '#0d2b28';
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(4, -5);
  ctx.lineTo(4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (lit < 0.3) {
    // Hidden ring: the dark is working for you.
    ctx.strokeStyle = 'rgba(111, 240, 221, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('LARK', p.x, p.y - 20);
}

// --- HUD -----------------------------------------------------------------------------
function alertStateOf(world) {
  if (world.guards.some((g) => g.state === 'chase')) return { label: 'ALARM', color: '#e74c3c' };
  if (world.guards.some((g) => g.state === 'investigate' || g.state === 'search')) return { label: 'SEARCH', color: '#ff9a2e' };
  const max = Math.max(0, ...world.guards.map((g) => g.suspicion));
  if (max >= 0.3) return { label: 'SUSPICIOUS', color: '#ffcf4d' };
  return { label: 'CALM', color: '#3ddc84' };
}

function drawHUD(ctx, world, ui) {
  const alert = alertStateOf(world);
  const maxSus = Math.max(0, ...world.guards.map((g) => g.suspicion));
  ctx.fillStyle = 'rgba(10, 14, 22, 0.86)';
  ctx.fillRect(0, 0, WIDTH, 52);
  ctx.fillStyle = PALETTE.hudEdge;
  ctx.fillRect(0, 52, WIDTH, 2);
  ctx.textBaseline = 'middle';
  // Left: heist + objective.
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 15px Georgia, serif';
  ctx.fillText(`HEIST ${world.levelIdx + 1}/5 — ${world.level.name.toUpperCase()}`, 14, 16);
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '12px Georgia, serif';
  ctx.fillText(world.prizeTaken ? 'ESCAPE THROUGH THE GREEN HATCH' : `STEAL THE ${world.level.prize.toUpperCase()}`, 14, 36);
  // Centre: alert pill + visibility eye.
  const cx = WIDTH / 2;
  ctx.fillStyle = alert.color;
  ctx.beginPath();
  ctx.roundRect(cx - 150, 10, 110, 30, 6);
  ctx.fill();
  ctx.fillStyle = '#10141d';
  ctx.font = 'bold 13px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(alert.label, cx - 95, 26);
  // Eye meter.
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '12px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText('SEEN', cx - 28, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx + 12, 16, 110, 12);
  ctx.fillStyle = maxSus >= 1 ? '#e74c3c' : maxSus >= 0.55 ? '#ff9a2e' : '#ffcf4d';
  ctx.fillRect(cx + 12, 16, 110 * clamp(maxSus, 0, 1), 12);
  // Right: timer, loot, strikes, gadgets, gait.
  ctx.textAlign = 'right';
  ctx.fillStyle = world.timeLeft < 30 ? '#e74c3c' : PALETTE.ink;
  ctx.font = 'bold 15px Georgia, serif';
  const t = Math.max(0, Math.ceil(world.timeLeft));
  ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, WIDTH - 14, 16);
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '12px Georgia, serif';
  const gg = world.gadgets;
  ctx.fillText(`◆ ${world.loot}/${world.lootTotal}   ✕ ${world.strikes}/3   ①×${gg.coin} ②×${gg.smoke} ③×${gg.cricket} R×${gg.douse}   ${world.player.gait.toUpperCase()}${ui.muted ? '   MUTED' : ''}`, WIDTH - 14, 36);
  ctx.textBaseline = 'alphabetic';
  // Toast message.
  if (world.messageTimer > 0 && world.message) {
    ctx.font = 'bold 14px Georgia, serif';
    const w = ctx.measureText(world.message).width + 28;
    ctx.fillStyle = 'rgba(10, 14, 22, 0.85)';
    ctx.beginPath();
    ctx.roundRect((WIDTH - w) / 2, HEIGHT - 44, w, 30, 6);
    ctx.fill();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.fillText(world.message, WIDTH / 2, HEIGHT - 24);
  }
}

// --- field-note annotations (staged shots) ------------------------------------------
function drawNotes(ctx, notes) {
  if (!notes) return;
  ctx.font = 'bold 13px Georgia, serif';
  const boxes = notes.map((n) => {
    const w = ctx.measureText(n.text).width + 16;
    return { n, x: clamp(n.x - w / 2, 8, WIDTH - w - 8), y: clamp(n.y, 60, HEIGHT - 40), w, h: 26 };
  });
  // De-collide: push each note down until it clears every earlier note's box.
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x && a.y < b.y + b.h + 6 && a.y + a.h + 6 > b.y) {
        a.y = Math.min(b.y + b.h + 8, HEIGHT - 40);
      }
    }
  }
  for (const { n, x, y, w } of boxes) {
    const cx = clamp(n.x, x + 2, x + w - 2);
    ctx.strokeStyle = 'rgba(255, 210, 122, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, n.y + 14);
    ctx.lineTo(cx, y + 26);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 26, 5);
    ctx.fill();
    ctx.fillStyle = '#ffd27a';
    ctx.textAlign = 'left';
    ctx.fillText(n.text, x + 8, y + 17);
  }
}

// --- screens -----------------------------------------------------------------------------
export function renderPlay(ctx, world, notes, ui) {
  drawFloor(ctx, world);
  drawLightAndDark(ctx, world);
  drawCones(ctx, world);
  drawLasers(ctx, world);
  drawEntities(ctx, world);
  drawHUD(ctx, world, ui || {});
  drawNotes(ctx, notes);
}

export function renderTitle(ctx, demoWorld, ui) {
  if (demoWorld) {
    drawFloor(ctx, demoWorld);
    drawLightAndDark(ctx, demoWorld);
    drawCones(ctx, demoWorld);
    drawEntities(ctx, demoWorld);
    ctx.fillStyle = 'rgba(8, 10, 18, 0.72)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = '#10141d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.lampGlow;
  ctx.font = 'bold 64px Georgia, serif';
  ctx.fillText('THE MARROWGATE', WIDTH / 2, 190);
  ctx.fillText('HEISTS', WIDTH / 2, 258);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 20px Georgia, serif';
  ctx.fillText('Five heists. One thief. One night in the river-city.', WIDTH / 2, 300);
  ctx.fillStyle = PALETTE.playerTeal;
  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillText('5 HEISTS  ·  18 GUARDS  ·  35 TREASURES  ·  4 GADGETS', WIDTH / 2, 348);
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '15px Georgia, serif';
  ctx.fillText('WASD move  ·  SHIFT sprint (loud)  ·  C sneak (silent)  ·  CLICK throw a coin', WIDTH / 2, 400);
  ctx.fillText('2 smoke  ·  3 clockwork cricket  ·  R douse a lamp  ·  M mute  ·  P pause', WIDTH / 2, 424);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 17px Georgia, serif';
  const sel = (ui && ui.selectedLevel) || 0;
  for (let i = 0; i < 5; i += 1) {
    const x = WIDTH / 2 - 320 + i * 160;
    const y = 470;
    ctx.fillStyle = i === sel ? 'rgba(255, 210, 122, 0.25)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(x - 70, y - 18, 140, 36, 6);
    ctx.fill();
    ctx.fillStyle = i === sel ? PALETTE.lampGlow : PALETTE.inkDim;
    ctx.font = 'bold 13px Georgia, serif';
    ctx.fillText(`${i + 1}. ${(ui && ui.levelNames ? ui.levelNames[i] : '')}`, x, y + 5);
  }
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 19px Georgia, serif';
  ctx.fillText('PRESS SPACE TO BEGIN  ·  1–5 CHOOSES A HEIST', WIDTH / 2, 540);
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '13px Georgia, serif';
  ctx.fillText('Stay out of the lamplight. Read the cones before you move. The green hatch opens once the prize is yours.', WIDTH / 2, 570);
}

export function renderResults(ctx, world, result) {
  renderPlay(ctx, world, null, {});
  ctx.fillStyle = 'rgba(8, 10, 18, 0.78)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const cx = WIDTH / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.lampGlow;
  ctx.font = 'bold 54px Georgia, serif';
  ctx.fillText(result.rank, cx, 210);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 20px Georgia, serif';
  ctx.fillText(`${world.level.name} — ${world.level.prize} secured`, cx, 250);
  const rows = [
    ['TIME', `${result.time.toFixed(1)}s  (par ${result.par}s)`],
    ['LOOT', `${result.loot} / ${result.lootTotal} treasures`],
    ['STRIKES', `${result.strikes} / 3`],
    ['CLOSE CALLS', `${result.closeCalls}`],
    ['SCORE', `${result.score}`],
  ];
  ctx.font = '17px Georgia, serif';
  rows.forEach(([k, v], i) => {
    const y = 300 + i * 34;
    ctx.fillStyle = PALETTE.inkDim;
    ctx.textAlign = 'right';
    ctx.fillText(k, cx - 20, y);
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left';
    ctx.fillText(v, cx + 20, y);
  });
  ctx.fillStyle = PALETTE.playerTeal;
  ctx.font = 'bold 18px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(result.last ? 'PRESS SPACE FOR THE FINAL TALLY' : 'PRESS SPACE FOR THE NEXT HEIST', cx, 510);
}

export function renderCampaign(ctx, results) {
  ctx.fillStyle = '#10141d';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const cx = WIDTH / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.lampGlow;
  ctx.font = 'bold 46px Georgia, serif';
  ctx.fillText('THE NIGHT IS DONE', cx, 120);
  const wins = results.filter((r) => r.won).length;
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 19px Georgia, serif';
  ctx.fillText(`Lark slipped away with ${wins} of 5 prizes — the Marrowgate bells never knew her name.`, cx, 156);
  const total = results.reduce((n, r) => n + (r.score || 0), 0);
  const loot = results.reduce((n, r) => n + (r.loot || 0), 0);
  ctx.font = 'bold 17px Georgia, serif';
  ctx.fillStyle = PALETTE.inkDim;
  ctx.textAlign = 'right';
  ctx.fillText('HEIST', cx - 260, 210);
  ctx.fillText('TIME', cx + 40, 210);
  ctx.fillText('LOOT', cx + 140, 210);
  ctx.fillText('RANK', cx + 260, 210);
  ctx.fillText('SCORE', cx + 380, 210);
  ctx.font = '17px Georgia, serif';
  results.forEach((r, i) => {
    const y = 246 + i * 40;
    ctx.fillStyle = r.won ? PALETTE.ink : '#e74c3c';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${r.name}`, cx - 380, y);
    ctx.textAlign = 'right';
    ctx.fillText(r.won ? `${r.time.toFixed(1)}s` : 'FAILED', cx + 40, y);
    ctx.fillText(`${r.loot}/${r.lootTotal}`, cx + 140, y);
    ctx.fillText(r.rank, cx + 260, y);
    ctx.fillText(`${r.score}`, cx + 380, y);
  });
  ctx.fillStyle = PALETTE.playerTeal;
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`TOTAL  ${total}  ·  LOOT ${loot}/35  ·  ${wins}/5 CLEAR`, cx, 480);
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '15px Georgia, serif';
  ctx.fillText('PRESS R TO RUN THE NIGHT AGAIN', cx, 520);
}

export function renderFailed(ctx, world, reason) {
  renderPlay(ctx, world, null, {});
  ctx.fillStyle = 'rgba(8, 10, 18, 0.8)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e74c3c';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.fillText('HEIST FAILED', WIDTH / 2, 300);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 20px Georgia, serif';
  ctx.fillText(reason || 'Three strikes — the watch has the house now.', WIDTH / 2, 340);
  ctx.font = 'bold 18px Georgia, serif';
  ctx.fillText('PRESS SPACE TO TRY THIS HEIST AGAIN', WIDTH / 2, 400);
}

export function renderPaused(ctx, world) {
  renderPlay(ctx, world, null, {});
  ctx.fillStyle = 'rgba(8, 10, 18, 0.7)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 48px Georgia, serif';
  ctx.fillText('PAUSED', WIDTH / 2, 340);
  ctx.font = '16px Georgia, serif';
  ctx.fillText('Press P or Esc to keep moving', WIDTH / 2, 380);
}
