(() => {
'use strict';
const app = document.getElementById('app');
const S = { me: null, team: null, fresh: null, off: false };

// ---------- helpers (all text goes through textContent – nothing from the server is ever parsed as HTML) ----------
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected', 'readOnly'].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};
async function api(method, path, body) {
  let r, data = null;
  try {
    r = await fetch('/api/aurex' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Aurex-Client': 'web' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    data = await r.json().catch(() => null);
  } catch (_) { throw Object.assign(new Error('Cannot reach the server. Check your connection.'), { status: 0 }); }
  if (!r.ok) { const e = (data && data.error) || {}; throw Object.assign(new Error(e.message || 'Something went wrong.'), { code: e.code, field: e.field, status: r.status }); }
  return data;
}
let toastT;
function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg); document.body.append(t);
  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 4200);
}
const logoUrl = t => `/api/aurex/teams/${t.id}/logo`;
const crest = (t, small) => h('img', { class: 'crest' + (small ? ' sm' : ''), alt: t.hasLogo ? t.name + ' logo' : '', src: t.hasLogo ? logoUrl(t) : 'aurex-logo-sm.png' });
const chip = s => h('span', { class: 'chip ' + s }, s[0].toUpperCase() + s.slice(1));
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

function makeForm(spec, submitLabel, onSubmit, extra) {
  const inputs = {}, errs = {};
  const rows = spec.map(f => {
    const input = h('input', { id: 'f-' + f.name, name: f.name, type: f.type || 'text', autocomplete: f.auto || 'off', value: f.value || '', readOnly: !!f.readonly, maxlength: f.max, accept: f.accept, autocapitalize: 'none', spellcheck: 'false' });
    inputs[f.name] = input; errs[f.name] = h('div', { class: 'err', role: 'alert' });
    return h('label', { class: 'field', for: 'f-' + f.name }, h('span', { class: 'lab' }, f.label), input, f.hint ? h('span', { class: 'hint' }, f.hint) : null, errs[f.name]);
  });
  const top = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const el = h('form', { class: 'form', novalidate: true, onsubmit: async ev => {
    ev.preventDefault(); Object.values(errs).forEach(x => { x.textContent = ''; }); top.textContent = ''; btn.disabled = true;
    try { const v = {}; for (const k in inputs) v[k] = inputs[k].value; await onSubmit(v); }
    catch (e) { (e.field && errs[e.field] ? errs[e.field] : top).textContent = e.message; }
    finally { btn.disabled = false; }
  } }, rows, extra, top, btn);
  return { el, inputs };
}
function ask({ title, text, fields = [], confirm = 'Confirm', danger }) {
  return new Promise(resolve => {
    const inputs = fields.map(f => h('input', { id: 'd-' + f.name, name: f.name, type: f.type || 'text', autocomplete: 'off', maxlength: f.max || 300 }));
    const dlg = h('dialog', { class: 'dlg' }, h('form', { method: 'dialog', class: 'form' },
      h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null,
      fields.map((f, i) => h('label', { class: 'field', for: 'd-' + f.name }, h('span', { class: 'lab' }, f.label), inputs[i])),
      h('div', { class: 'row spread' }, h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, 'Cancel'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), value: 'ok' }, confirm))));
    dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'ok'; const v = {}; fields.forEach((f, i) => { v[f.name] = inputs[i].value; }); dlg.remove(); resolve(ok ? v : null); });
    document.body.append(dlg); dlg.showModal(); (inputs[0] || dlg).focus();
  });
}
async function run(promise, okMsg, after) { try { const r = await promise; if (okMsg) toast(okMsg); if (after) await after(r); } catch (e) { toast(e.message, true); } }
async function fileToLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height);
  for (const size of [256, 192, 128]) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    let url = c.toDataURL('image/webp', 0.9); if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    if (url.length < 190000) return url;
  }
  throw new Error('That image is too detailed. Try a simpler one.');
}

// ---------- session ----------
async function loadMe() {
  try { const r = await api('GET', '/auth/me'); S.me = r.user; S.team = r.team; S.off = false; }
  catch (e) { S.off = e.status === 503 || e.status === 0 ? e.message : false; S.me = null; S.team = null; }
}
async function signOut() { await run(api('POST', '/auth/logout'), null); S.me = S.team = null; go('#/'); }

// ---------- views ----------
function authShell(card) {
  return h('main', { class: 'auth' },
    h('section', { class: 'hero' }, h('img', { src: 'aurex-logo.png', alt: 'AUREX crest' }), h('h1', null, 'AUREX Championship'),
      h('p', null, 'Two players. One team of seven on the pitch. Sign in to enter the tournament of PENALTY OUT.')),
    h('section', { class: 'panel' }, card));
}
function viewAuth(mode) {
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(mode === 'login'), onclick: () => go('#/') }, 'Sign in'),
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(mode === 'register'), onclick: () => go('#/register') }, 'Create account'));
  let form;
  if (mode === 'register') form = makeForm([
    { name: 'username', label: 'Username', auto: 'username', max: 20, hint: '3–20 letters, numbers or underscore.' },
    { name: 'password', label: 'Password', type: 'password', auto: 'new-password', max: 128, hint: 'At least 8 characters.' },
    { name: 'confirmPassword', label: 'Confirm Password', type: 'password', auto: 'new-password', max: 128 }],
    'Create account', async v => { const r = await api('POST', '/auth/register', v); S.fresh = r.recoveryCode; await loadMe(); go('#/recovery'); });
  else form = makeForm([
    { name: 'username', label: 'Username', auto: 'username', max: 20 },
    { name: 'password', label: 'Password', type: 'password', auto: 'current-password', max: 128 }],
    'Sign in', async v => { await api('POST', '/auth/login', v); await loadMe(); go('#/team'); },
    h('button', { class: 'linkbtn', type: 'button', onclick: () => go('#/recover') }, 'Forgot your password?'));
  app.replaceChildren(authShell([tabs, form.el]));
}
function viewRecover() {
  const f = makeForm([
    { name: 'username', label: 'Username', auto: 'username', max: 20 },
    { name: 'recoveryCode', label: 'Recovery code', max: 24, hint: 'The code you saved when you created the account.' },
    { name: 'newPassword', label: 'New password', type: 'password', auto: 'new-password', max: 128 },
    { name: 'confirmPassword', label: 'Confirm new password', type: 'password', auto: 'new-password', max: 128 }],
    'Reset password', async v => { const r = await api('POST', '/auth/recover', v); S.fresh = r.recoveryCode; toast('Password changed. Sign in with the new one.'); S.me = null; go('#/recovery'); });
  app.replaceChildren(authShell([h('h2', null, 'Reset your password'), h('p', { class: 'muted m8-18' }, 'A recovery code works once. You will get a fresh one afterwards.'), f.el,
    h('p', { class: 'mt14' }, h('button', { class: 'linkbtn', onclick: () => go('#/') }, 'Back to sign in'))]));
}
function viewRecovery() {
  if (!S.fresh) return go('#/');
  const code = S.fresh;
  const ok = h('input', { type: 'checkbox', id: 'saved' }), next = h('button', { class: 'btn primary', disabled: true, onclick: () => { S.fresh = null; go(S.me ? '#/team' : '#/'); } }, 'Continue');
  ok.addEventListener('change', () => { next.disabled = !ok.checked; });
  const save = () => { const a = h('a', { href: URL.createObjectURL(new Blob([`AUREX recovery code\n${code}\nKeep it private. It resets your password once.\n`], { type: 'text/plain' })), download: 'aurex-recovery-code.txt' }); document.body.append(a); a.click(); a.remove(); };
  app.replaceChildren(authShell([h('h2', null, 'Save your recovery code'),
    h('p', { class: 'muted m8-16' }, 'It is the only way to reset your password. We show it once and cannot show it again.'),
    h('div', { class: 'code-box' }, code),
    h('div', { class: 'row my14' }, h('button', { class: 'btn sm', onclick: () => navigator.clipboard && navigator.clipboard.writeText(code).then(() => toast('Copied'), () => toast('Copy failed – select the code manually', true)) }, 'Copy'), h('button', { class: 'btn sm', onclick: save }, 'Download .txt')),
    h('label', { class: 'row', for: 'saved' }, ok, 'I saved it somewhere safe.'), h('div', { class: 'mt16' }, next)]));
}

function shell(active, ...content) {
  const link = (hash, label, key) => h('a', { href: hash, 'aria-current': active === key ? 'page' : null }, label);
  app.replaceChildren(
    h('header', { class: 'top' },
      h('a', { class: 'brand', href: '#/team' }, h('img', { src: 'aurex-logo-sm.png', alt: '' }), 'AUREX'),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, link('#/team', 'My team', 'team'), link('#/teams', 'Teams', 'teams'), link('#/clubs', 'Football club', 'clubs'), S.me && S.me.role === 'OWNER' ? link('#/admin', 'Owner panel', 'admin') : null, link('#/account', 'Account', 'account')),
      h('div', { class: 'who' }, h('span', { class: 'name' }, S.me.username + (S.me.role === 'OWNER' ? ' · Owner' : '')), h('button', { class: 'btn sm', onclick: signOut }, 'Sign out'))),
    h('main', { class: 'page' }, content));
}

function teamForm() {
  let logo = null; const prev = h('img', { class: 'preview', alt: 'Logo preview', src: 'aurex-logo-sm.png' });
  const pick = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'logo' });
  const msg = h('div', { class: 'err', role: 'alert' });
  pick.addEventListener('change', async () => { msg.textContent = ''; logo = null; if (!pick.files[0]) return; try { logo = await fileToLogo(pick.files[0]); prev.src = logo; } catch (e) { msg.textContent = e.message; pick.value = ''; } });
  const f = makeForm([
    { name: 'name', label: 'Team Name', max: 24, hint: '3–24 characters.' },
    { name: 'teamPassword', label: 'Team Password', type: 'password', auto: 'new-password', max: 64, hint: 'Used to hand over the captaincy. Share it only with your teammate.' },
    { name: 'player1Username', label: 'Player 1 Username', value: S.me.username, readonly: true },
    { name: 'player2Username', label: 'Player 2 Username', max: 20, hint: 'Your teammate must already have an AUREX account.' }],
    'Submit for approval', async v => { const r = await api('POST', '/teams', { ...v, logo }); S.team = r.team; toast('Team submitted. The owner will review it.'); render(); },
    h('div', { class: 'field' }, h('label', { class: 'lab', for: 'logo' }, 'Team Logo (optional)'), h('div', { class: 'row' }, prev, pick), h('span', { class: 'hint' }, 'Square images look best. It is resized for you.'), msg));
  return f.el;
}
function squad(t) {
  const amCap = t.captainId === S.me.id && t.status !== 'rejected';
  return h('section', { class: 'panel' }, h('h3', null, 'Squad'),
    h('ul', { class: 'members' }, t.members.map(m => h('li', null, h('span', null, m.username, m.userId === S.me.id ? ' (you)' : ''), m.userId === t.captainId ? h('span', { class: 'cap' }, 'Captain') : h('span', { class: 'muted small' }, 'Player')))),
    amCap ? h('div', { class: 'mt14' }, h('button', { class: 'btn sm', onclick: async () => {
      const other = t.members.find(m => m.userId !== S.me.id); if (!other) return;
      const v = await ask({ title: 'Hand over the captaincy', text: `${other.username} becomes captain and manages the line-up from now on.`, fields: [{ name: 'teamPassword', label: 'Team Password', type: 'password', max: 64 }], confirm: 'Hand over' }); if (!v) return;
      run(api('POST', '/teams/mine/captain', { userId: other.userId, teamPassword: v.teamPassword }), 'Captain changed', async () => { await loadMe(); render(); });
    } }, 'Hand over captaincy')) : null);
}
function viewTeam() {
  const t = S.team, live = t && t.status !== 'rejected';
  if (!live) {
    return shell('team', t ? h('div', { class: 'banner bad' }, h('b', null, 'Your last team request was rejected. '), t.rejectReason || '', h('div', { class: 'muted small' }, `${t.name} – you can fix the details and apply again.`)) : null,
      h('section', { class: 'panel' }, h('h2', { class: 'mb6' }, 'Register your team'), h('p', { class: 'muted mb18' }, 'A team is two real players who share one squad of seven. The tournament owner approves every team before it can play.'), teamForm()));
  }
  const note = { pending: ['warn', 'Waiting for owner approval', 'You will get your Team ID as soon as the owner approves the team.'],
    approved: ['good', 'Approved', 'Your Team ID is issued. The owner activates the team before the first match.'],
    suspended: ['bad', 'Team suspended', t.suspendReason || 'Contact the tournament owner.'] }[t.status];
  shell('team',
    h('section', { class: 'panel teamhead' }, crest(t), h('div', null, h('h1', { class: 'title-xl' }, t.name),
      h('div', { class: 'row mt8' }, t.teamCode ? h('span', { class: 'chip code' }, t.teamCode) : h('span', { class: 'chip' }, 'Team ID pending'), chip(t.status)))),
    note ? h('div', { class: 'banner ' + note[0] }, h('b', null, note[1] + '. '), note[2]) : null,
    h('div', { class: 'grid2' }, squad(t),
      h('section', { class: 'panel' }, h('h3', null, 'Coming with match phase'), h('p', { class: 'muted small mt6' }, 'These need the match engine and league tables, which are built next. They are not available yet.'),
        h('div', { class: 'locked' }, ['Line-up (7)', 'Next match', 'League table', 'Results', 'Team stats', 'Player stats', 'Training', 'Match history', 'Trophy cabinet'].map(x => h('span', null, x))))));
}
async function viewClubs() {
  shell('clubs', h('h2', null, 'AUREX Football Club Selection'), h('p', {class:'muted mt8'}, 'One football club belongs to one AUREX team. Only the captain of an approved team can select.'));
  try {
    const data=await api('GET','/football-clubs'), clubs=data.clubs||[], mine=data.mine;
    const myClub=mine&&mine.club?mine.club.id:null, myTeam=mine&&mine.teamId;
    const cards=clubs.map(c=>{
      const own=myClub===c.id, taken=!!c.selectedByTeamId&&!own;
      const card=h('section',{class:'panel club-card'+(own?' club-own':'')},
        h('div',{class:'club-crest club-'+c.id},c.short),
        h('h3',{class:'mt10'},c.name),
        h('span',{class:'chip '+(own?'active':taken?'suspended':'approved')},own?'YOUR CLUB':taken?'UNAVAILABLE':'AVAILABLE'),
        taken?h('p',{class:'muted small mt8'},`Selected by ${c.selectedByTeamName||'another AUREX team'} · ${c.teamCode||''}`):h('p',{class:'muted small mt8'},c.source==='penalty_out_existing'?'Uses the existing PENALTY OUT squad.':'AUREX roster: 7 starters + 2 substitutes.'),
        own?h('button',{class:'btn sm',disabled:true},'Selected ✓'):taken?h('button',{class:'btn sm',disabled:true},'Already selected'):h('button',{class:'btn primary mt12',disabled:!S.team||S.team.captainId!==S.me.id||!['approved','active'].includes(S.team.status),onclick:()=>run(api('POST','/select-club',{footballClubId:c.id}),'Football club selected',()=>viewClubs())},'Select this club'));
      if(c.source!=='penalty_out_existing'){
        card.append(h('details',{class:'club-roster'},h('summary',null,'View squad'),h('div',{class:'small muted mt8'},'Starting XI'),h('ol',null,(c.startingXI||[]).map(p=>h('li',null,p.name+' · '+p.pos))),h('div',{class:'small muted mt8'},'Substitutes'),h('ul',null,(c.substitutes||[]).map(p=>h('li',null,p.name+' · '+p.pos)))));
      }
      return card;
    });
    const notice=!S.team?h('div',{class:'banner warn mt16'},'Register or join an AUREX team first.'):S.team.status==='pending'?h('div',{class:'banner warn mt16'},'Your team is awaiting OWNER approval.'):S.team.captainId!==S.me.id?h('div',{class:'banner warn mt16'},'Only your team captain can select the football club.'):null;
    shell('clubs',h('div',{class:'row spread mb16'},h('div',null,h('h2',null,'AUREX Football Club Selection'),h('p',{class:'muted mt8'},'Choose one club for your AUREX team.')),myClub?h('span',{class:'chip active'},'Selected: '+myClub):null),notice,h('div',{class:'club-grid'},cards),h('p',{class:'muted small mt16'},'Barcelona and Real Madrid reuse the squads already present in PENALTY OUT.'));
  }catch(e){shell('clubs',h('h2',null,'Football club selection'),h('div',{class:'banner bad mt16'},e.message));}
}
async function adminClubs(body) {
  const [{clubs},{teams}]=await Promise.all([api('GET','/admin/football-clubs'),api('GET','/admin/teams')]);
  const eligible=teams.filter(t=>['approved','active','suspended'].includes(t.status));
  body.replaceChildren(h('div',{class:'panel'},h('h3',null,'Football club reservations'),h('p',{class:'muted small mt8'},'Manage club selections. Suspended teams retain their selection.'),
    h('div',{class:'club-admin-list'},clubs.map(c=>{
      const select=h('select',{class:'mt8','aria-label':'Select AUREX team'},h('option',{value:''},'Choose AUREX team'),eligible.map(t=>h('option',{value:t.id},`${t.teamCode||'No ID'} · ${t.name} (${t.status})`)));
      const current=c.selectedByTeamId;
      return h('div',{class:'club-admin-row'},h('div',{class:'grow'},h('b',null,c.name),h('div',{class:'muted small'},current?`Reserved by ${c.selectedByTeamName} (${c.teamCode||current})`:'Available')),
        h('div',{class:'club-admin-actions'},select,h('button',{class:'btn sm',onclick:()=>{if(!select.value)return toast('Choose a team first',true);run(api('POST',`/admin/teams/${select.value}/football-club`,{footballClubId:c.id}),'Club assigned',()=>adminClubs(body));}},'Assign'),
        current?h('button',{class:'btn sm danger',onclick:()=>run(api('DELETE',`/admin/teams/${current}/football-club`),'Selection released',()=>adminClubs(body))},'Release'):null));
    }))));
}
async function viewTeams() {
  shell('teams', h('h2', null, 'Teams in the championship'), h('p', { class: 'muted' }, 'Loading…'));
  try {
    const { teams } = await api('GET', '/teams/public');
    shell('teams', h('h2', null, 'Teams in the championship'), teams.length ? h('div', { class: 'cards' }, teams.map(t => h('div', { class: 'tcard' }, crest(t, true), h('div', null, h('b', null, t.name), h('span', { class: 'muted small' }, `${t.teamCode} · ${t.members.map(m => m.username).join(' & ')}`))))) : h('p', { class: 'muted' }, 'No approved teams yet. Register yours from the My team page.'));
  } catch (e) { toast(e.message, true); }
}
function viewAccount() {
  const f = makeForm([
    { name: 'oldPassword', label: 'Current password', type: 'password', auto: 'current-password', max: 128 },
    { name: 'newPassword', label: 'New password', type: 'password', auto: 'new-password', max: 128 },
    { name: 'confirmPassword', label: 'Confirm new password', type: 'password', auto: 'new-password', max: 128 }],
    'Change password', async v => { await api('POST', '/auth/change-password', v); toast('Password changed. Other devices were signed out.'); render(); });
  shell('account', h('section', { class: 'panel w480' }, h('h2', { class: 'mb4' }, S.me.username), h('p', { class: 'muted mb16' }, S.me.role === 'OWNER' ? 'Tournament owner' : 'Player'), f.el),
    S.me.role === 'PLAYER' ? h('p', { class: 'muted small' }, h('a', { href: '#/owner-setup' }, 'Owner activation')) : null);
}
function viewOwnerSetup() {
  const f = makeForm([{ name: 'key', label: 'Owner activation key', type: 'password', max: 200, hint: 'The key stored in the server settings (AUREX_OWNER_KEY).' }], 'Activate owner role',
    async v => { await api('POST', '/owner/bootstrap', v); await loadMe(); toast('You are now the tournament owner.'); go('#/admin'); });
  shell('account', h('section', { class: 'panel w480' }, h('h2', { class: 'mb6' }, 'Owner activation'), h('p', { class: 'muted mb16' }, 'Works once. After the first owner exists this step closes permanently.'), f.el));
}

// ---------- owner panel ----------
const ADMIN = { tab: 'teams', sel: null, filter: '' };
async function viewAdmin(sub) {
  if (!S.me || S.me.role !== 'OWNER') return shell('admin', h('div', { class: 'banner bad' }, 'This area is for the tournament owner.'));
  ADMIN.tab = sub || 'teams';
  const tab = (key, label, off) => h('button', { class: 'tab', role: 'tab', disabled: !!off, title: off ? 'Arrives with the match phase' : null, 'aria-selected': String(ADMIN.tab === key), onclick: () => go('#/admin' + (key === 'teams' ? '' : '/' + key)) }, label);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('teams', 'Teams'), tab('players', 'Players'), tab('clubs', 'Club selection'), tab('audit', 'Activity log'), tab('m', 'Matches', true), tab('s', 'Seasons', true), tab('t', 'Tournament', true));
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  shell('admin', h('h2', null, 'Owner panel'), tabs, body);
  try {
    if (ADMIN.tab === 'teams') await adminTeams(body);
    else if (ADMIN.tab === 'players') await adminPlayers(body);
    else await adminAudit(body);
  } catch (e) { body.replaceChildren(h('div', { class: 'banner bad' }, e.message)); }
}
async function adminTeams(body) {
  const { teams } = await api('GET', '/admin/teams');
  const sel = teams.find(t => t.id === ADMIN.sel) || null;
  const filter = h('select', { 'aria-label': 'Filter by status', onchange: ev => { ADMIN.filter = ev.target.value; adminTeams(body); } },
    ['', 'pending', 'approved', 'active', 'suspended', 'rejected'].map(s => h('option', { value: s, selected: ADMIN.filter === s }, s ? s[0].toUpperCase() + s.slice(1) + ' (' + teams.filter(t => t.status === s).length + ')' : 'All teams (' + teams.length + ')')));
  const shown = teams.filter(t => !ADMIN.filter || t.status === ADMIN.filter);
  body.replaceChildren(h('div', { class: 'split' },
    h('div', { class: 'list' }, h('div', { class: 'mb6' }, filter),
      shown.length ? shown.map(t => h('button', { class: 'item', 'aria-pressed': String(ADMIN.sel === t.id), onclick: () => { ADMIN.sel = t.id; adminTeams(body); } }, crest(t, true), h('span', { class: 'grow' }, h('b', null, t.name), h('div', { class: 'muted small' }, t.members.map(m => m.username).join(' & '))), chip(t.status))) : h('p', { class: 'muted' }, 'No teams here.')),
    sel ? teamDetail(sel, () => adminTeams(body)) : h('div', { class: 'panel muted' }, 'Pick a team to review it.')));
}
function teamDetail(t, reload) {
  const act = (path, okMsg, body) => run(api('POST', `/admin/teams/${t.id}/${path}`, body || {}), okMsg, reload);
  const reasonAction = async (path, title, label, okMsg, confirm) => { const v = await ask({ title, fields: [{ name: 'reason', label }], confirm, danger: true }); if (v) act(path, okMsg, v); };
  const buttons = { pending: [h('button', { class: 'btn primary', onclick: () => act('approve', 'Approved and activated', { activate: true }) }, 'Approve and activate'), h('button', { class: 'btn', onclick: () => act('approve', 'Approved', { activate: false }) }, 'Approve only'), h('button', { class: 'btn danger', onclick: () => reasonAction('reject', 'Reject ' + t.name, 'Reason shown to the players', 'Rejected', 'Reject team') }, 'Reject')],
    approved: [h('button', { class: 'btn primary', onclick: () => act('activate', 'Team activated') }, 'Activate'), h('button', { class: 'btn danger', onclick: () => reasonAction('suspend', 'Suspend ' + t.name, 'Reason', 'Suspended', 'Suspend team') }, 'Suspend')],
    active: [h('button', { class: 'btn danger', onclick: () => reasonAction('suspend', 'Suspend ' + t.name, 'Reason', 'Suspended', 'Suspend team') }, 'Suspend')],
    suspended: [h('button', { class: 'btn primary', onclick: () => act('activate', 'Team reactivated') }, 'Reactivate')], rejected: [] }[t.status];
  const codeIn = h('input', { value: t.teamCode || '', maxlength: 9, 'aria-label': 'Team ID', class: 'w150' });
  return h('section', { class: 'panel' },
    h('div', { class: 'teamhead' }, crest(t), h('div', null, h('h3', null, t.name), h('div', { class: 'row mt6' }, chip(t.status), t.teamCode ? h('span', { class: 'chip code' }, t.teamCode) : null), h('p', { class: 'muted small mt6' }, 'Submitted ' + new Date(t.createdAt).toLocaleString()))),
    t.rejectReason && t.status === 'rejected' ? h('p', { class: 'banner bad mt14' }, 'Rejected: ' + t.rejectReason) : null,
    t.suspendReason && t.status === 'suspended' ? h('p', { class: 'banner bad mt14' }, 'Suspended: ' + t.suspendReason) : null,
    h('h3', { class: 'm18-4' }, 'Members'),
    h('ul', { class: 'members' }, t.members.map(m => h('li', null, h('span', null, m.username), m.userId === t.captainId ? h('span', { class: 'cap' }, 'Captain') : (t.status !== 'rejected' ? h('button', { class: 'btn sm', onclick: () => act('captain', 'Captain changed', { userId: m.userId }) }, 'Make captain') : null)))),
    t.teamCode ? h('div', { class: 'row mt16' }, h('span', { class: 'lab' }, 'Team ID'), codeIn, h('button', { class: 'btn sm', onclick: () => act('team-id', 'Team ID updated', { teamCode: codeIn.value }) }, 'Save')) : null,
    buttons.length ? h('div', { class: 'row mt20' }, buttons) : null);
}
async function adminPlayers(body) {
  const { players } = await api('GET', '/admin/players'), reload = () => adminPlayers(body);
  body.replaceChildren(h('div', { class: 'panel scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Username', 'Role', 'Status', 'Team', ''].map(x => h('th', null, x)))),
    h('tbody', null, players.map(p => h('tr', null, h('td', null, p.username), h('td', null, p.role), h('td', null, chip(p.status)), h('td', null, p.team ? `${p.team.name} (${p.team.status})` : '–'),
      h('td', { class: 'row' }, p.id === S.me.id ? h('span', { class: 'muted small' }, 'You') : [
        p.role === 'OWNER' ? null : (p.status === 'active'
          ? h('button', { class: 'btn sm danger', onclick: async () => { const v = await ask({ title: 'Suspend ' + p.username, text: 'They are signed out everywhere and cannot sign in.', fields: [{ name: 'reason', label: 'Reason' }], confirm: 'Suspend', danger: true }); if (v) run(api('POST', `/admin/players/${p.id}/suspend`, v), 'Suspended', reload); } }, 'Suspend')
          : h('button', { class: 'btn sm', onclick: () => run(api('POST', `/admin/players/${p.id}/unsuspend`, {}), 'Account restored', reload) }, 'Unsuspend')),
        p.status === 'active' ? h('button', { class: 'btn sm', onclick: async () => { const to = p.role === 'OWNER' ? 'PLAYER' : 'OWNER'; const v = await ask({ title: `Make ${p.username} ${to === 'OWNER' ? 'an owner' : 'a player'}`, text: 'Confirm with your own password.', fields: [{ name: 'password', label: 'Your password', type: 'password', max: 128 }], confirm: 'Change role' }); if (v) run(api('POST', `/admin/players/${p.id}/role`, { role: to, password: v.password }), 'Role updated', reload); } }, p.role === 'OWNER' ? 'Make player' : 'Make owner') : null])))))));
}
async function adminAudit(body) {
  const { entries } = await api('GET', '/admin/audit');
  body.replaceChildren(h('div', { class: 'panel scroll' }, entries.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Owner', 'Action', 'Target', 'Details'].map(x => h('th', null, x)))),
    h('tbody', null, entries.map(e => h('tr', null, h('td', null, new Date(e.createdAt).toLocaleString()), h('td', null, e.actor || '–'), h('td', null, e.action), h('td', null, e.targetType ? `${e.targetType} #${e.targetId}` : '–'), h('td', { class: 'muted small' }, e.detail ? JSON.stringify(e.detail) : ''))))) : h('p', { class: 'muted' }, 'Nothing logged yet.')));
}

// ---------- router ----------
function render() {
  if (S.off) return app.replaceChildren(authShell([h('h2', null, 'AUREX is offline'), h('p', { class: 'muted mt8' }, S.off)]));
  const path = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const r = path[0];
  if (r === 'recover') return viewRecover();
  if (r === 'recovery') return viewRecovery();
  if (!S.me) return viewAuth(r === 'register' ? 'register' : 'login');
  if (r === '' || r === 'team') return viewTeam();
  if (r === 'teams') return viewTeams();
  if (r === 'clubs') return viewClubs();
  if (r === 'account') return viewAccount();
  if (r === 'owner-setup') return viewOwnerSetup();
  if (r === 'admin') return viewAdmin(path[1]);
  go('#/team');
}
window.addEventListener('hashchange', render);
loadMe().then(render);
})();
