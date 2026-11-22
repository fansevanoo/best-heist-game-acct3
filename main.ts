// The Marrowgate Heists — entry program (Node 22, standard library only).
//
// The game is the game/ folder beside this file: plain static files that a
// desktop browser loads offline — game/index.html plus its ES modules, no
// library, no network request. Five top-down stealth heists, one thief
// (Lark), raycast guard cones, cameras, lasers, gadgets, and an autopilot
// that clears the whole night.
//
// The program hands the game in. It copies game/ and screenshots/ into the
// output directory the grader reads (/output, or $MAKEFUN_OUTPUT_DIR when
// run outside the grader) and writes dossier.json there with the vendored
// make.fun library — the summary the judge reads. Before writing the
// dossier it checks the screenshots are really there and inside the
// scorer's size cap, so a broken hand-in fails loudly here instead of
// silently at the judge.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Where the entry lives, and where the grader expects it.
const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, mirrored from the kit's reference/gate.json:
// only text_max_bytes shapes the bytes — the rest refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more
// than 993 files in game/ or 48 MiB of game files in all, or a path under
// game/ over 1000 bytes).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

// The four staged frames must be real renders of the running game, each a
// JPEG inside the 256 KiB cap. Anything else is a broken hand-in.
function checkScreenshots(dir) {
  if (!existsSync(dir)) throw new Error(`screenshots/ is missing: ${dir}`);
  const shots = readdirSync(dir)
    .filter((f) => ['.jpg', '.jpeg'].includes(extname(f).toLowerCase()))
    .sort();
  if (shots.length < 3 || shots.length > 4) {
    throw new Error(`expected 3 or 4 screenshots, found ${shots.length}: ${shots.join(', ')}`);
  }
  for (const shot of shots) {
    const size = statSync(join(dir, shot)).size;
    if (size > DOSSIER_CAPS.screenshots.max_bytes) {
      throw new Error(`${shot} is ${size} bytes, over the 256 KiB cap`);
    }
  }
  return shots;
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

function main() {
  if (!existsSync(join(root, 'game', 'index.html'))) {
    throw new Error('game/index.html is missing — the game cannot load');
  }
  mkdirSync(outDir, { recursive: true });
  copyTree(join(root, 'game'), join(outDir, 'game'));
  copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
  const shots = checkScreenshots(join(outDir, 'screenshots'));
  const gameFiles = countFiles(join(outDir, 'game'));
  const dossierPath = join(outDir, 'dossier.json');
  writeFileSync(dossierPath, buildDossier(outDir, DOSSIER_CAPS));
  const dossierBytes = statSync(dossierPath).size;
  console.log(`handed in: ${gameFiles} game files + ${shots.length} screenshots (${shots.join(', ')}) -> ${outDir}`);
  console.log(`dossier.json written (${dossierBytes} bytes) — The Marrowgate Heists is ready for the judge.`);
}

main();
