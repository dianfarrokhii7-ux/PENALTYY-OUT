/* PENALTY OUT — advanced line-up editor (browser only).
 *
 *   const ed = LineupEditor.create(element, { onChange(value) { … } });
 *   ed.setTeam('BAR');   // loads that squad and resets the line-up
 *   ed.value();          // { form, order } | { form: 'custom', pos, order }  (the format the server validates)
 *
 * Features: formation presets, free drag-and-drop system on a pitch, swap / substitute by tapping,
 * AUTO best XI by role, mirror left/right, three save slots per team, live team ratings, bench sorted by overall. */
(function (root) {
  'use strict';
  const { SQUADS, FORMS, DEF_FORM, ovr } = root.POF;
  const NS = 6, STORE = 'pof_lineups_v1', SNAP = .05;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clone = a => a.map(p => p.slice());
  const zoneOf = f => f[0] < -.3 ? 'def' : f[0] > .3 ? 'fwd' : 'mid';
  const posLabel = f => f[0] < -.8 ? 'GK' : ({ def: 'DEF', mid: 'MID', fwd: 'FWD' }[zoneOf(f)] + (Math.abs(f[1]) > .3 ? (f[1] < 0 ? ' L' : ' R') : ''));
  const shapeOf = pos => { const c = { def: 0, mid: 0, fwd: 0 }; pos.slice(1).forEach(f => c[zoneOf(f)]++); return `${c.def}-${c.mid}-${c.fwd}`; };
  const roleScore = (q, z) => z === 'def' ? q.def * .6 + q.pac * .2 + q.pas * .2 : z === 'mid' ? q.pas * .4 + q.dri * .3 + q.pac * .15 + q.def * .15 : q.sho * .4 + q.pac * .3 + q.dri * .3;
  const shortName = n => { const w = n.split(' '), s = w.length > 1 ? w[w.length - 1] : n; return s.length > 9 ? s.slice(0, 8) + '…' : s; };
  const bar = (label, v) => `<i title="${label} ${v}"><u style="width:${clamp(v, 0, 99)}%"></u></i>`;

  const store = {
    read() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } },
    write(d) { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) { /* private mode: ignore */ } }
  };

  function create(el, opts) {
    const st = { team: 'BAR', form: DEF_FORM, pos: clone(FORMS[DEF_FORM]), order: Array.from({ length: NS }, (_, k) => k) };
    const ui = { sel: null, saving: false };
    let drag = null;
    el.classList.add('le');
    el.innerHTML = '<div class="le-forms"></div><div class="le-pitch"></div><div class="le-sum"></div>' +
      '<div class="le-tools"><button data-a="auto">AUTO XI</button><button data-a="mirror">MIRROR</button><button data-a="reset">RESET</button><button data-a="mode"></button></div>' +
      '<div class="le-saves"></div><h4>Bench <small>sorted by overall</small></h4><div class="le-bench"></div>';
    const $ = s => el.querySelector(s), pitch = $('.le-pitch');
    const squad = () => SQUADS[st.team].r;

    const value = () => st.form === 'custom'
      ? { form: 'custom', pos: st.pos.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), order: st.order.slice() }
      : { form: st.form, order: st.order.slice() };
    const emit = () => opts.onChange && opts.onChange(value());

    function renderForms() {
      $('.le-forms').innerHTML = Object.keys(FORMS).concat('custom').map(f =>
        `<button data-f="${f}" class="${f === st.form ? 'sel' : ''}">${f === 'custom' ? 'CUSTOM ' + shapeOf(st.pos) : f}</button>`).join('');
    }
    function renderPitch() {
      const sq = squad();
      pitch.innerHTML = '<span class="le-line"></span>' + st.pos.map((f, s) => {
        const q = sq[st.order[s]], on = ui.sel && ui.sel.k === 's' && ui.sel.i === s;
        return `<div class="tok${s ? '' : ' gk'}${on ? ' sel' : ''}" data-s="${s}" style="left:${(f[0] + 1) * 50}%;top:${(f[1] + 1) * 50}%" title="${posLabel(f)}"><b>${ovr(q)}</b><span>${esc(shortName(q.n))}</span></div>`;
      }).join('');
    }
    function renderSummary() {
      const sq = squad(), xi = st.order.map(i => sq[i]), zones = st.pos.map(zoneOf);
      const avg = (a, f) => a.length ? Math.round(a.reduce((t, q) => t + f(q), 0) / a.length) : 0;
      const front = xi.filter((_, i) => i && zones[i] !== 'def'), back = xi.filter((_, i) => i && zones[i] === 'def');
      const rows = [['OVR', avg(xi, ovr)], ['ATT', avg(front.length ? front : xi, q => q.sho * .5 + q.dri * .3 + q.pac * .2)],
        ['DEF', avg(back.concat(xi[0]), q => q.gk ? q.gk : q.def)], ['PACE', avg(xi.slice(1), q => q.pac)], ['PASS', avg(xi.slice(1), q => q.pas)]];
      $('.le-sum').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b>${bar(k, v)}</div>`).join('');
    }
    function renderBench() {
      const sq = squad(), used = new Set(st.order);
      const list = sq.map((q, i) => ({ q, i })).filter(o => o.i && !used.has(o.i)).sort((a, b) => ovr(b.q) - ovr(a.q));
      $('.le-bench').innerHTML = list.map(({ q, i }) => `<button data-b="${i}" class="${ui.sel && ui.sel.k === 'b' && ui.sel.i === i ? 'sel' : ''}"><span>${esc(q.n)} <small>#${q.num}</small></span><b>${ovr(q)}</b>` +
        `<em>${bar('PAC', q.pac)}${bar('SHO', q.sho)}${bar('PAS', q.pas)}${bar('DRI', q.dri)}${bar('DEF', q.def)}</em></button>`).join('') || '<p class="sub">No bench players</p>';
    }
    function renderSaves() {
      const mine = store.read()[st.team] || [];
      $('.le-saves').innerHTML = [0, 1, 2].map(n => `<button data-slot="${n}" class="${ui.saving ? 'sv' : ''}">${n + 1}<small>${mine[n] ? (mine[n].form === 'custom' ? 'C ' + shapeOf(mine[n].pos) : mine[n].form) : 'empty'}</small></button>`).join('');
      $('[data-a=mode]').textContent = ui.saving ? 'TAP A SLOT TO SAVE' : 'SAVE…';
      $('[data-a=mode]').classList.toggle('sel', ui.saving);
    }
    function render() { renderForms(); renderPitch(); renderSummary(); renderBench(); renderSaves(); }

    function reset() { st.form = DEF_FORM; st.pos = clone(FORMS[DEF_FORM]); st.order = Array.from({ length: NS }, (_, k) => k); ui.sel = null; }
    function tap(k, i) {            // tap a slot / bench player, then another: swap two slots or bring a bench player on
      if (k === 's' && i === 0) return;
      const s = ui.sel;
      if (!s || (s.k === 'b' && k === 'b') || (s.k === 's' && k === 's' && s.i === i)) { ui.sel = s && s.i === i && s.k === k ? null : { k, i }; return render(); }
      if (s.k === 's' && k === 's') { const o = st.order; [o[s.i], o[i]] = [o[i], o[s.i]]; }
      else { const si = k === 's' ? i : s.i, bi = k === 'b' ? i : s.i; st.order[si] = bi; }
      ui.sel = null; emit(); render();
    }
    function auto() {                // best XI for the current system: strikers first, then midfield, then defence
      const sq = squad(), rank = { fwd: 0, mid: 1, def: 2 }, pool = sq.map((_, i) => i).filter(i => i), order = [0, 0, 0, 0, 0, 0];
      st.pos.map((f, s) => s).slice(1).sort((a, b) => rank[zoneOf(st.pos[a])] - rank[zoneOf(st.pos[b])]).forEach(s => {
        let best = -1, bs = -1; pool.forEach(i => { const sc = roleScore(sq[i], zoneOf(st.pos[s])); if (sc > bs) { bs = sc; best = i; } });
        order[s] = best; pool.splice(pool.indexOf(best), 1);
      });
      st.order = order; ui.sel = null; emit(); render();
    }
    function load(d) {               // validate a saved line-up before using it (squads may have changed)
      const n = squad().length, o = d && d.order;
      if (!Array.isArray(o) || o.length !== NS || o[0] !== 0 || new Set(o).size !== NS || o.some(i => !(i >= 0 && i < n))) return false;
      if (d.form === 'custom') { if (!Array.isArray(d.pos) || d.pos.length !== NS) return false; st.pos = clone(d.pos); st.form = 'custom'; }
      else if (FORMS[d.form]) { st.pos = clone(FORMS[d.form]); st.form = d.form; } else return false;
      st.order = o.slice(); return true;
    }

    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
      if (b.dataset.f) { if (b.dataset.f !== 'custom') { st.form = b.dataset.f; st.pos = clone(FORMS[st.form]); } else st.form = 'custom'; ui.sel = null; emit(); render(); }
      else if (b.dataset.b) tap('b', +b.dataset.b);
      else if (b.dataset.slot !== undefined) {
        const all = store.read(), mine = all[st.team] || [null, null, null], n = +b.dataset.slot;
        if (ui.saving) { mine[n] = value(); all[st.team] = mine; store.write(all); ui.saving = false; }
        else if (mine[n] && load(mine[n])) emit();
        ui.sel = null; render();
      } else if (b.dataset.a === 'auto') auto();
      else if (b.dataset.a === 'mirror') { st.pos = st.pos.map((f, i) => i ? [f[0], -f[1]] : f); if (st.form !== 'custom') st.form = 'custom'; emit(); render(); }
      else if (b.dataset.a === 'reset') { reset(); emit(); render(); }
      else if (b.dataset.a === 'mode') { ui.saving = !ui.saving; renderSaves(); }
    });
    /* drag & drop on the pitch (a move under 6 px counts as a tap) */
    pitch.addEventListener('pointerdown', e => {
      const t = e.target.closest('.tok'); if (!t) return;
      drag = { s: +t.dataset.s, x: e.clientX, y: e.clientY, moved: false, el: t }; try { t.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    pitch.addEventListener('pointermove', e => {
      if (!drag || drag.s === 0) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true; const r = pitch.getBoundingClientRect();
      const fx = clamp(Math.round(((e.clientX - r.left) / r.width * 2 - 1) / SNAP) * SNAP, -.8, .7), fz = clamp(Math.round(((e.clientY - r.top) / r.height * 2 - 1) / SNAP) * SNAP, -.8, .8);
      st.pos[drag.s] = [fx, fz]; st.form = 'custom'; drag.el.style.left = (fx + 1) * 50 + '%'; drag.el.style.top = (fz + 1) * 50 + '%';
    });
    const end = () => { if (!drag) return; const d = drag; drag = null; if (d.moved) { ui.sel = null; emit(); render(); } else tap('s', d.s); };
    pitch.addEventListener('pointerup', end); pitch.addEventListener('pointercancel', () => { drag = null; render(); });

    return { setTeam(team) { st.team = team; reset(); ui.saving = false; render(); emit(); }, value, render };
  }
  root.LineupEditor = { create };
})(window);
