// Keyboard + mouse input for The Marrowgate Heists.
// Movement is WASD/arrows; Shift sprints, C sneaks; a mouse click throws a
// coin at the cursor; 2 smoke, 3 cricket, R douse, M mute, P/Esc pause.
// Action keys are edge-triggered: readInput() consumes them once.
const keys = new Set();
let mouseX = 640, mouseY = 360;
let mouseClicked = false;
let pressedOnce = new Set();

export function bindInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) pressedOnce.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = ((e.clientX - r.left) / r.width) * canvas.width;
    mouseY = ((e.clientY - r.top) / r.height) * canvas.height;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseClicked = true;
  });
}

export function wasPressed(code) {
  return pressedOnce.has(code);
}

export function endFrame() {
  pressedOnce = new Set();
  mouseClicked = false;
}

export function readInput() {
  let mx = 0, my = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
  const gait = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 'sprint'
    : keys.has('KeyC') ? 'sneak' : 'walk';
  const input = {
    mx, my, gait,
    aim: { x: mouseX, y: mouseY },
    throwCoin: mouseClicked || wasPressed('Digit1'),
    throwSmoke: wasPressed('Digit2'),
    placeCricket: wasPressed('Digit3'),
    douse: wasPressed('KeyR'),
  };
  return input;
}
