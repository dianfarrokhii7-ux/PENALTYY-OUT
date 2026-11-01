/* Gamepad support (PS4 / PS5 / Xbox / any Bluetooth or USB pad using the browser's "standard" mapping).
 * The pad is translated into the same keyboard events the game already listens to, so no game logic changes.
 * Browsers only expose a pad after you press a button on it once. */
(() => {
  'use strict';
  const friendly = !!document.getElementById('fpad');
  const DEAD = .3, held = new Set();
  const press = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  const btn = (g, i) => !!(g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > .5));
  const ax = (g, i) => (g.axes[i] && Math.abs(g.axes[i]) > DEAD ? g.axes[i] : 0);

  function wanted(g) {
    const w = new Set(), lx = ax(g, 0), ly = ax(g, 1), rx = ax(g, 2), ry = ax(g, 3);
    const L = lx < 0 || btn(g, 14), R = lx > 0 || btn(g, 15), U = ly < 0 || btn(g, 12), D = ly > 0 || btn(g, 13);
    if (friendly) {
      // Move: left stick / D-pad.  Cross/A pass · Circle/B shoot (hold) · Square/X cross · Triangle/Y dribble
      // L1/LB switch · R1/RB or R2/RT sprint · L2/LT tackle · Start subs
      if (L) w.add('KeyA'); if (R) w.add('KeyD'); if (U) w.add('KeyW'); if (D) w.add('KeyS');
      if (btn(g, 0)) w.add('KeyF'); if (btn(g, 1)) w.add('Space'); if (btn(g, 2)) w.add('KeyE'); if (btn(g, 3)) w.add('KeyR');
      if (btn(g, 4)) w.add('KeyV'); if (btn(g, 5) || btn(g, 7)) w.add('ShiftLeft'); if (btn(g, 6)) w.add('KeyC'); if (btn(g, 9)) w.add('KeyB');
    } else {
      const pad = document.getElementById('padAim'), keeper = !!pad && pad.classList.contains('hide');
      if (!keeper) {
        // Shooter: left stick / D-pad aims, any face button or R2 = hold to charge, release to shoot
        if (L) w.add('ArrowLeft'); if (R) w.add('ArrowRight'); if (U) w.add('ArrowUp'); if (D) w.add('ArrowDown');
        if (btn(g, 0) || btn(g, 1) || btn(g, 2) || btn(g, 3) || btn(g, 7)) w.add('Space');
      } else {
        // Keeper: left stick / D-pad moves; right stick or L1/R1 dives left/right (up / Triangle = high); Cross = jump
        if (L) w.add('KeyA'); if (R) w.add('KeyD');
        if (rx < 0 || btn(g, 4) || btn(g, 2)) w.add('ArrowLeft'); if (rx > 0 || btn(g, 5) || btn(g, 1)) w.add('ArrowRight');
        if (ry < -.5 || btn(g, 3)) w.add('ArrowUp'); if (btn(g, 0)) w.add('Space');
      }
    }
    return w;
  }
  function releaseAll() { for (const c of held) press(c, false); held.clear(); }
  function poll() {
    requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [], g = Array.from(pads || []).find(p => p && p.connected);
    if (!g || document.hidden) { if (held.size) releaseAll(); return; }
    const w = wanted(g);
    for (const c of held) if (!w.has(c)) { held.delete(c); press(c, false); }
    for (const c of w) if (!held.has(c)) { held.add(c); press(c, true); }
  }
  addEventListener('gamepaddisconnected', releaseAll);
  addEventListener('blur', releaseAll);
  requestAnimationFrame(poll);
})();
