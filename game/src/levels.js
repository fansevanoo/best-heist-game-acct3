// Level data for The Marrowgate Heists — all maps written from scratch for this entry.
// Legend: # wall | . floor | , tall grass (hiding) | C crate | P pillar | S shelf
//         L lamp | ~ water (noisy) | E exit hatch | T side treasure | * named prize | D entrance
// Guards, cameras and lasers are defined per level below the maps.
// Every row is 32 chars, every map 18 rows (checked by /tmp/validate-maps-acct3.mjs).
import { TILE } from './config.js';

function level(name, prize, par, timeLimit, map, guards, cameras, lasers) {
  return { name, prize, par, timeLimit, map, guards, cameras: cameras || [], lasers: lasers || [] };
}

export const LEVELS = [
  level(
    "The Tollhouse",
    "Tollmaster's Seal",
    75, 240,
    [
      '################################',
      '#D......,....#......#....T.....#',
      '#......,.....#..T...#..........#',
      '#..C.........#......#.....C....#',
      '#......,.....#......#..........#',
      '#......,............#....T.....#',
      '#..L.........#..L...#....L.....#',
      '#......,.....#......#..........#',
      '#......,.......................#',
      '#..T...C.....#..*...#.....C....#',
      '#......,.....#......#..........#',
      '#..L.........#..L...#....L.....#',
      '#......,.....#...........T.....#',
      '#......,.....#......#..........#',
      '#..C.........#..T...#.....T....#',
      '#......,.....#......#..........#',
      '#......,.....#......#........E.#',
      '################################',
    ],
    [
      { name: 'Dunstan', waypoints: [[4, 2], [9, 2], [9, 6], [4, 6]], pause: 1.2 },
      { name: 'Mirelle', waypoints: [[23, 3], [28, 3], [28, 13], [23, 13]], pause: 1.2 },
    ],
  ),
  level(
    "The Candlewright's Hall",
    'Gilded Wreath',
    90, 240,
    [
      '################################',
      '#D......#......T......#........#',
      '#.......#.............#...T....#',
      '#..P....#..C..........#........#',
      '#.....................#........#',
      '#..T....#.....L.......#....C...#',
      '########..#############..#######',
      '#......,............T..........#',
      '#......,..........T............#',
      '#..L...,............L..........#',
      '#......,............T..........#',
      '#..C...,..........*........T...#',
      '#......,.......................#',
      '########..#############..#######',
      '#......#......T.......#....L...#',
      '#..T..................#........#',
      '#......#..C...........#....E...#',
      '################################',
    ],
    [
      { name: 'Osric', waypoints: [[3, 2], [6, 2], [6, 4], [3, 4]], pause: 1.4 },
      { name: 'Fenwick', waypoints: [[12, 8], [20, 8], [20, 11], [12, 11]], pause: 1.2 },
      { name: 'Tilda', waypoints: [[25, 2], [29, 2], [29, 5], [25, 5]], pause: 1.6 },
    ],
  ),
  level(
    'The Tidewater Bank',
    'Harbor Bond',
    120, 260,
    [
      '################################',
      '#D................T............#',
      '#..........C................T..#',
      '#..L................L..........#',
      '#...........####.###...........#',
      '#...........#......#........T..#',
      '#..C........#......#......T....#',
      '#...........#......#...........#',
      '#...........#..*...#...........#',
      '#...........#......#...........#',
      '#...........#......#.T.........#',
      '#...........#......#...........#',
      '#...........#......#........L..#',
      '#...........####.###...........#',
      '#..T...........................#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '#..L......................T..E.#',
      '################################',
    ],
    [
      { name: 'Bram', waypoints: [[4, 2], [10, 2], [10, 3], [4, 3]], pause: 1.2 },
      { name: 'Anselm', waypoints: [[24, 2], [29, 2], [29, 10], [24, 10]], pause: 1.4 },
      { name: 'Corin', waypoints: [[14, 6], [17, 6], [17, 11], [14, 11]], pause: 1.0 },
      { name: 'Hester', waypoints: [[5, 14], [12, 14], [12, 16], [5, 16]], pause: 1.2 },
    ],
    [{ x: 16, y: 3, angle: Math.PI / 2, sweep: 0.5 }],
  ),
  level(
    'The Opera of Masks',
    'Harlequin Locket',
    135, 260,
    [
      '################################',
      '#....................#....T....#',
      '#....................#....*....#',
      '#..L.................#.........#',
      '#....................#......C..#',
      '#....................####.######',
      '#.........................T....#',
      '#..P.......P.......P.......P...#',
      '#..T...........................#',
      '#..C................L..........#',
      '#.........................T....#',
      '#..P.......P.......P.......P...#',
      '#..T...........................#',
      '#..L................L..........#',
      '#..........C..............T....#',
      '#..............................#',
      '#D...........................E.#',
      '################################',
    ],
    [
      { name: 'Jory', waypoints: [[4, 2], [10, 2], [10, 4], [4, 4]], pause: 1.2 },
      { name: 'Marek', waypoints: [[24, 2], [29, 2], [29, 4], [24, 4]], pause: 1.0 },
      { name: 'Mabel', waypoints: [[8, 8], [16, 8], [16, 10], [8, 10]], pause: 1.4 },
      { name: 'Roderick', waypoints: [[6, 14], [14, 14], [14, 15], [6, 15]], pause: 1.2 },
    ],
    [
      { x: 15, y: 6, angle: Math.PI / 2, sweep: 0.55 },
      { x: 25, y: 12, angle: Math.PI, sweep: 0.5 },
    ],
  ),
  level(
    'The Spire of Bells',
    "Bellwright's Heart",
    160, 280,
    [
      '################################',
      '#D................T............#',
      '#.......#.............#........#',
      '#..L....#.............#....T...#',
      '#.......#.............#........#',
      '#..T....#.............#........#',
      '#.....................#........#',
      '#.......#....##.###............#',
      '#.......#....#....#............#',
      '#.......#....#..*.#............#',
      '#.......#....###.##............#',
      '#.......#.............#...T....#',
      '#.....................#........#',
      '#.......#.............#....T...#',
      '#..L....#......................#',
      '#.......#.............#........#',
      '#..T....#.............#......E.#',
      '################################',
    ],
    [
      { name: 'Wystan', waypoints: [[3, 2], [6, 2], [6, 5], [3, 5]], pause: 1.2 },
      { name: 'Edwina', waypoints: [[11, 2], [18, 2], [18, 4], [11, 4]], pause: 1.0 },
      { name: 'Halvor', waypoints: [[14, 8], [17, 8], [17, 9], [14, 9]], pause: 0.8 },
      { name: 'Petronel', waypoints: [[11, 13], [18, 13], [18, 15], [11, 15]], pause: 1.2 },
      { name: 'Casimir', waypoints: [[25, 3], [29, 3], [29, 10], [25, 10]], pause: 1.4 },
    ],
    [
      { x: 15, y: 6, angle: Math.PI / 2, sweep: 0.5 },
      { x: 25, y: 8, angle: Math.PI, sweep: 0.55 },
    ],
    [
      { x1: 11, y1: 5, x2: 11, y2: 12 },
      { x1: 21, y1: 5, x2: 21, y2: 12 },
    ],
  ),
];

// Gadget stock per heist.
export const GADGET_STOCK = { coin: 3, smoke: 2, douse: 2, cricket: 1 };

// Parse one ASCII map into grids and entity lists.
export function parseMap(map) {
  const walls = new Set();
  const cover = new Set(); // blocks sight: crates, pillars, shelves
  const grass = new Set();
  const water = new Set();
  const lamps = [];
  const treasures = [];
  let prize = null;
  let entrance = null;
  let exit = null;
  for (let r = 0; r < map.length; r += 1) {
    const row = map[r];
    for (let c = 0; c < row.length; c += 1) {
      const ch = row[c];
      const key = `${c},${r}`;
      const px = c * TILE + TILE / 2;
      const py = r * TILE + TILE / 2;
      if (ch === '#') walls.add(key);
      else if (ch === 'C' || ch === 'P' || ch === 'S') { cover.add(key); }
      else if (ch === ',') grass.add(key);
      else if (ch === '~') water.add(key);
      else if (ch === 'L') lamps.push({ c, r, x: px, y: py, out: false });
      else if (ch === 'T') treasures.push({ c, r, x: px, y: py, taken: false });
      else if (ch === '*') prize = { c, r, x: px, y: py, taken: false };
      else if (ch === 'D') entrance = { c, r, x: px, y: py };
      else if (ch === 'E') exit = { c, r, x: px, y: py, open: false };
    }
  }
  return { walls, cover, grass, water, lamps, treasures, prize, entrance, exit };
}

export function totalGuards() { return LEVELS.reduce((n, l) => n + l.guards.length, 0); }
export function totalTreasures() {
  return LEVELS.reduce((n, l) => n + l.map.join('').split('').filter((ch) => ch === 'T').length, 0);
}
