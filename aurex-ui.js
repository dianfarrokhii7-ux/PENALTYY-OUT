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
      h('nav', { class: 'nav', 'aria-label': 'Main' }, link('#/team', 'My team', 'team'), link('#/teams', 'Teams', 'teams'), link('#/clubs', 'Football club', 'clubs'), link('#/cup', 'Penalty cup', 'cup'), h('a', { href: '/aurex-pen?mode=reporter', title: 'Watch running matches live' }, '📺 Reporter'), S.me && S.me.role === 'OWNER' ? link('#/admin', 'Owner panel', 'admin') : null, link('#/account', 'Account', 'account')),
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
      h('div', { class: 'row mt8' }, t.teamCode ? h('span', { class: 'chip code' }, t.teamCode) : h('span', { class: 'chip' }, 'Team ID pending'), chip(t.status), ['approved', 'active'].includes(t.status) ? h('a', { class: 'btn sm', href: '#/teams/' + t.id }, 'View team profile') : null))),
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
    shell('teams', h('h2', null, 'Teams in the championship'), teams.length ? h('div', { class: 'cards' }, teams.map(t => h('a', { class: 'tcard tlink', href: '#/teams/' + t.id, 'aria-label': 'Open the profile of ' + t.name }, crest(t, true), h('div', null, h('b', null, t.name), h('span', { class: 'muted small' }, `${t.teamCode} · ${t.members.map(m => m.username).join(' & ')}`))))) : h('p', { class: 'muted' }, 'No approved teams yet. Register yours from the My team page.'));
  } catch (e) { toast(e.message, true); }
}
// ---------- team profile (public): logo, name, captain, squad, club, record, form, next match, results ----------
const ordinal = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
const teamLink = (t, ...kids) => h('a', { class: 'tlink inline', href: '#/teams/' + t.id }, kids.length ? kids : t.name);
const statTile = (label, value, cls) => h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('b', null, value == null ? '–' : value), h('span', null, label));
const STATUS_TEXT = { approved: 'Approved', active: 'Active', suspended: 'Suspended', pending: 'Pending', rejected: 'Rejected' };
async function viewTeamProfile(id) {
  shell('teams', h('p', { class: 'muted' }, 'Loading…'));
  let d;
  try { d = await api('GET', `/teams/${id}/profile`); }
  catch (e) { return shell('teams', h('a', { class: 'back', href: '#/teams' }, '← All teams'), h('div', { class: 'banner bad' }, e.message)); }
  if (location.hash.replace(/^#\/?/, '').split('/')[1] !== String(id)) return;      // the person already went somewhere else
  const t = d.team, o = d.overall, L = d.league, row = L.row;
  const clubId = d.club && /^[a-z0-9_-]{1,30}$/.test(d.club.id) ? d.club.id : null;
  const hero = h('section', { class: 'panel profile-hero' + (t.isChampion ? ' champ' : '') },
    crest({ id: t.id, name: t.name, hasLogo: t.hasLogo }),
    h('div', { class: 'grow' },
      h('div', { class: 'row' }, t.isChampion ? h('span', { class: 'chip gold' }, '🏆 Champions') : null, t.teamCode ? h('span', { class: 'chip code' }, t.teamCode) : null, h('span', { class: 'chip ' + t.status }, STATUS_TEXT[t.status] || t.status), row ? h('span', { class: 'chip approved' }, ordinal(row.rank) + ' of ' + L.teamCount) : null),
      h('h1', { class: 'title-xl mt8' }, t.name),
      h('div', { class: 'row mt8 muted' },
        d.captain ? h('span', null, 'Captain: ', h('b', { class: 'cap' }, d.captain.username)) : null,
        h('span', null, 'Squad: ', d.members.length, d.members.length === 1 ? ' player' : ' players'),
        t.createdAt ? h('span', null, 'Registered ' + new Date(t.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })) : null)),
    clubId ? h('div', { class: 'profile-club' }, h('div', { class: 'club-crest sm club-' + clubId }, d.club.short), h('div', null, h('span', { class: 'muted small' }, 'Football club'), h('b', null, d.club.name))) : null);

  const squadCard = m => h('li', { class: 'pl' + (m.role === 'Captain' ? ' cap' : '') },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, m.username.slice(0, 1).toUpperCase()),
    h('div', { class: 'grow' }, h('b', null, m.username, S.me && m.userId === S.me.id ? ' (you)' : ''), h('div', { class: 'muted small' }, m.role === 'Captain' ? 'Team captain' : 'Player')),
    m.role === 'Captain' ? h('span', { class: 'chip gold' }, 'C') : null);
  const squadPanel = h('section', { class: 'panel' }, h('h3', null, 'Squad'), h('ul', { class: 'squadlist' }, [...d.members].sort((a, b) => (b.role === 'Captain') - (a.role === 'Captain')).map(squadCard)));

  const nextPanel = d.next ? h('section', { class: 'panel' }, h('h3', null, 'Next match'),
    h('div', { class: 'row mt8' }, h('span', { class: 'chip ' + (d.next.stage === 'league' ? 'approved' : 'active') }, STAGE_NAME[d.next.stage] || 'Match'), d.next.open ? h('span', { class: 'chip active' }, 'Open now') : null),
    h('div', { class: 'row mt8' }, d.next.opponent ? [h('span', { class: 'muted' }, 'vs'), teamLink(d.next.opponent, crest(d.next.opponent, true), h('b', null, d.next.opponent.name))] : null),
    h('p', { class: 'muted mt8' }, fmtWhen(d.next.scheduledAt))) : null;

  const recordPanel = h('section', { class: 'panel' }, h('h3', null, 'Penalty record'),
    o.played ? [h('div', { class: 'statgrid mt14' }, statTile('Played', o.played), statTile('Won', o.won, 'w'), statTile('Drawn', o.drawn, 'd'), statTile('Lost', o.lost, 'l'),
      statTile('Goals for', o.gf), statTile('Goals against', o.ga), statTile('Goal diff.', (o.gd > 0 ? '+' : '') + o.gd), statTile('Win rate', o.winRate + '%')),
      h('div', { class: 'wl', role: 'img', 'aria-label': `${o.won} wins, ${o.drawn} draws, ${o.lost} losses` }, o.won ? h('i', { class: 'w', style: `flex:${o.won}` }) : null, o.drawn ? h('i', { class: 'd', style: `flex:${o.drawn}` }) : null, o.lost ? h('i', { class: 'l', style: `flex:${o.lost}` }) : null),
      d.form.length ? h('div', { class: 'row mt14' }, h('span', { class: 'muted small' }, 'Form'), d.form.map(f => h('span', { class: 'chip ' + f }, f))) : null,
      o.friendlies ? h('p', { class: 'muted small mt8' }, `Includes ${o.friendlies} friendly ${o.friendlies === 1 ? 'duel' : 'duels'}. Only announced league matches count for the table.`) : null]
      : h('p', { class: 'muted mt8' }, 'No penalty duels played yet.'));

  const leaguePanel = L.inLeague && row ? h('section', { class: 'panel' }, h('h3', null, 'League table'),
    h('div', { class: 'statgrid mt14' }, statTile('Position', ordinal(row.rank), 'gold'), statTile('Points', row.points, 'gold'), statTile('Played', row.played), statTile('Won', row.won, 'w'), statTile('Drawn', row.drawn, 'd'), statTile('Lost', row.lost, 'l'), statTile('Goals for', row.gf), statTile('Goals against', row.ga))) : null;

  const results = d.recent.length ? h('div', { class: 'panel scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Opponent', 'Score', '', 'Type', 'Note'].map(x => h('th', null, x)))),
    h('tbody', null, d.recent.map(m => h('tr', null,
      h('td', null, new Date(m.finishedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })),
      h('td', null, teamLink(m.opponent, crest(m.opponent, true), m.opponent.name)),
      h('td', null, h('b', null, `${m.gf} – ${m.ga}`)), h('td', null, h('span', { class: 'chip ' + m.result }, m.result)),
      h('td', null, h('span', { class: 'chip ' + (m.stage === 'friendly' ? 'D' : 'approved') }, STAGE_NAME[m.stage] || 'Friendly')),
      h('td', { class: 'muted' }, RES_LABEL[m.reason] || '–'))))))
    : h('p', { class: 'muted' }, 'No results yet.');

  shell('teams', h('a', { class: 'back', href: '#/teams' }, '← All teams'), hero,
    t.status === 'suspended' ? h('div', { class: 'banner bad' }, 'This team is currently suspended.') : null,
    h('div', { class: 'grid2' }, squadPanel, nextPanel || leaguePanel || recordPanel),
    nextPanel && leaguePanel ? leaguePanel : null, nextPanel || leaguePanel ? recordPanel : null,
    h('h3', null, 'Recent results'), results,
    d.isMine ? h('p', { class: 'muted small' }, h('a', { href: '#/team' }, 'Manage your team'), ' · ', h('a', { href: '#/clubs' }, 'Choose your football club')) : null);
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
const ADMIN = { tab: 'teams', sel: null, filter: '', checked: new Set() };
async function viewAdmin(sub) {
  if (!S.me || S.me.role !== 'OWNER') return shell('admin', h('div', { class: 'banner bad' }, 'This area is for the tournament owner.'));
  ADMIN.tab = sub || 'teams';
  const tab = (key, label, off) => h('button', { class: 'tab', role: 'tab', disabled: !!off, title: off ? 'Arrives with the match phase' : null, 'aria-selected': String(ADMIN.tab === key), onclick: () => go('#/admin' + (key === 'teams' ? '' : '/' + key)) }, label);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('teams', 'Teams'), tab('players', 'Players'), tab('clubs', 'Club selection'), tab('league', 'Penalty league'), tab('audit', 'Activity log'), tab('m', 'Matches', true), tab('s', 'Seasons', true), tab('t', 'Tournament', true));
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  shell('admin', h('h2', null, 'Owner panel'), tabs, body);
  try {
    if (ADMIN.tab === 'teams') await adminTeams(body);
    else if (ADMIN.tab === 'players') await adminPlayers(body);
    else if (ADMIN.tab === 'league') await adminLeague(body);
    else await adminAudit(body);
  } catch (e) { body.replaceChildren(h('div', { class: 'banner bad' }, e.message)); }
}
/** Deletes teams for good (owner). Asks for DELETE; if the league is running it asks a second time because the league gets reset. */
async function deleteTeamsFlow(ids, label, reload) {
  const v = await ask({ title: 'Delete ' + label, text: 'Everything of the team(s) is removed for good: place in the table, penalty matches, announced fixtures, logo, club and the link to their players. The players keep their accounts and can register a new team. This cannot be undone.', fields: [{ name: 'confirm', label: 'Type DELETE to confirm' }], confirm: 'Delete', danger: true });
  if (!v) return;
  const go = reset => api('POST', '/admin/teams/delete', { ids, confirm: v.confirm.trim(), resetLeague: reset });
  try {
    let r;
    try { r = await go(false); }
    catch (e) {
      if (e.code !== 'LEAGUE_RESET_REQUIRED') throw e;
      const ok = await ask({ title: 'Reset the league?', text: e.message, confirm: 'Delete and reset league', danger: true }); if (!ok) return;
      r = await go(true);
    }
    ids.forEach(id => ADMIN.checked.delete(id)); if (ids.includes(ADMIN.sel)) ADMIN.sel = null;
    toast(r.deleted + (r.deleted === 1 ? ' team deleted' : ' teams deleted') + (r.leagueReset ? ' · league reset' : '')); await reload();
  } catch (e) { toast(e.message, true); }
}
async function adminTeams(body) {
  const { teams } = await api('GET', '/admin/teams');
  const sel = teams.find(t => t.id === ADMIN.sel) || null;
  const filter = h('select', { 'aria-label': 'Filter by status', onchange: ev => { ADMIN.filter = ev.target.value; adminTeams(body); } },
    ['', 'pending', 'approved', 'active', 'suspended', 'rejected'].map(s => h('option', { value: s, selected: ADMIN.filter === s }, s ? s[0].toUpperCase() + s.slice(1) + ' (' + teams.filter(t => t.status === s).length + ')' : 'All teams (' + teams.length + ')')));
  const shown = teams.filter(t => !ADMIN.filter || t.status === ADMIN.filter);
  body.replaceChildren(h('div', { class: 'split' },
    h('div', { class: 'list' }, h('div', { class: 'mb6' }, filter),
      shown.length ? h('div', { class: 'row mb6' },
        h('label', { class: 'row' }, h('input', { type: 'checkbox', 'aria-label': 'Select all shown teams', checked: shown.every(t => ADMIN.checked.has(t.id)), onchange: ev => { shown.forEach(t => (ev.target.checked ? ADMIN.checked.add(t.id) : ADMIN.checked.delete(t.id))); adminTeams(body); } }), h('span', { class: 'muted small' }, 'Select all')),
        ADMIN.checked.size ? h('button', { class: 'btn sm danger', onclick: () => deleteTeamsFlow([...ADMIN.checked], ADMIN.checked.size + (ADMIN.checked.size === 1 ? ' team' : ' teams'), () => adminTeams(body)) }, 'Delete selected (' + ADMIN.checked.size + ')') : null) : null,
      shown.length ? shown.map(t => h('div', { class: 'row nowrap' }, h('input', { type: 'checkbox', 'aria-label': 'Select ' + t.name, checked: ADMIN.checked.has(t.id), onchange: ev => { ev.target.checked ? ADMIN.checked.add(t.id) : ADMIN.checked.delete(t.id); adminTeams(body); } }), h('button', { class: 'item', 'aria-pressed': String(ADMIN.sel === t.id), onclick: () => { ADMIN.sel = t.id; adminTeams(body); } }, crest(t, true), h('span', { class: 'grow' }, h('b', null, t.name), h('div', { class: 'muted small' }, t.members.map(m => m.username).join(' & '))), chip(t.status)))) : h('p', { class: 'muted' }, 'No teams here.')),
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
    buttons.length ? h('div', { class: 'row mt20' }, buttons) : null,
    h('div', { class: 'row mt20' }, h('button', { class: 'btn danger', onclick: () => deleteTeamsFlow([t.id], t.name, reload) }, 'Delete team completely')));
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


// ---------- penalty league: table, announced matches, play-offs (the match itself lives on /aurex-pen) ----------
let cupTimer = null;
const RES_LABEL = { normal: '', sudden_death: 'sudden death', cap_draw: 'draw after 10 kicks each', forfeit: 'forfeit', walkover: 'walkover' };
const STAGE_NAME = { league: 'League', semi: 'Semi-final', final: 'Final', friendly: 'Friendly' };
const fmtWhen = iso => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time to be announced');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = v => (v ? new Date(v).toISOString() : null);
function formatNote(n) {
  return n === 4 ? '4 teams: everybody plays everybody once. The team on top of the table is the champion.'
    : n === 6 ? '6 teams: everybody plays everybody once. The top 3 go through: 2nd and 3rd play the semi-final, the winner meets the 1st-placed team in the final.'
    : n === 8 ? '8 teams: everybody plays everybody once. The top 4 go through: 1st v 4th and 2nd v 3rd in the semi-finals, the winners meet in the final.'
    : 'The league is played with 4, 6 or 8 teams: everybody plays everybody once, then the best teams go on to the play-offs.';
}
function cupTable(rows, started) {
  const cols = ['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'Form'];
  return h('div', { class: 'panel scroll' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map(c => h('th', null, c)))),
    h('tbody', null, rows.map(r => h('tr', null,
      h('td', null, started || r.played ? r.rank : '–'),
      h('td', null, h('div', { class: 'row' }, crest({ id: r.teamId, name: r.name, hasLogo: r.hasLogo }, true), h('a', { class: 'tlink inline', href: '#/teams/' + r.teamId }, h('b', null, r.name)))),
      ...[r.played, r.won, r.drawn, r.lost, r.gf, r.ga, (r.gd > 0 ? '+' : '') + r.gd].map(v => h('td', null, v)),
      h('td', null, h('b', null, r.points)),
      h('td', null, (r.form || []).map(f => h('span', { class: 'chip ' + f }, f))))))));
}
function cupResults(list) {
  if (!list.length) return h('p', { class: 'muted' }, 'No penalty matches have been played yet.');
  return h('div', { class: 'panel scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Match', 'Score', 'Type', 'Note'].map(x => h('th', null, x)))),
    h('tbody', null, list.map(m => h('tr', null,
      h('td', null, new Date(m.finishedAt).toLocaleString()),
      h('td', null, `${m.teamA} (${m.playerA}) vs ${m.teamB} (${m.playerB})`),
      h('td', null, h('b', null, `${m.goalsA} – ${m.goalsB}`)),
      h('td', null, h('span', { class: 'chip ' + (m.stage === 'friendly' ? 'D' : 'W') }, STAGE_NAME[m.stage] || (m.league ? 'League' : 'Friendly'))),
      h('td', { class: 'muted' }, [RES_LABEL[m.reason] || '', m.varCount ? `VAR ×${m.varCount}` : ''].filter(Boolean).join(' · ') || '–'))))));
}
const fxTeam = (t, win) => h('span', { class: 'row' }, crest(t, true), h('a', { class: 'tlink inline', href: '#/teams/' + t.id }, win ? h('b', null, t.name) : t.name));
function fxStatus(f) {
  if (f.played) {
    const sc = f.score ? `${f.score.a} – ${f.score.b}` : '', why = f.score && RES_LABEL[f.score.reason] ? ` (${RES_LABEL[f.score.reason]})` : '';
    const adv = f.stage !== 'league' && f.winnerTeamId ? ` · ${(f.winnerTeamId === f.teamA.id ? f.teamA : f.teamB).name} through${f.drawn ? ' (higher seed)' : ''}` : '';
    return h('span', null, h('b', null, sc), h('span', { class: 'muted small' }, why + adv));
  }
  return f.open ? h('span', { class: 'chip active' }, 'Open now') : f.scheduledAt ? h('span', { class: 'chip approved' }, 'Scheduled') : h('span', { class: 'chip pending' }, 'Time not announced');
}
/** One table for every announced match (league, semi-finals, final). admin = owner controls, otherwise the "Enter match" button for the player's own team. */
function fixtureTable(list, admin, reload) {
  if (!list.length) return h('p', { class: 'muted' }, admin ? 'No matches announced yet. Add them above.' : 'The owner has not announced any match yet.');
  const heads = admin ? ['Stage', 'Match', 'When', 'Room code', 'Status', ''] : ['Stage', 'Match', 'When', 'Status', ''];
  const rows = list.map(f => {
    const win = id => f.played && f.winnerTeamId === id;
    const stageCell = h('td', null, h('span', { class: 'chip ' + (f.stage === 'league' ? 'approved' : 'active') }, STAGE_NAME[f.stage]));
    const matchCell = h('td', null, h('div', { class: 'row' }, fxTeam(f.teamA, win(f.teamA.id)), h('span', { class: 'muted' }, 'vs'), fxTeam(f.teamB, win(f.teamB.id))));
    if (!admin) {
      const act = f.mine && !f.played ? h('div', { class: 'row' }, f.roomCode ? h('span', { class: 'chip code' }, f.roomCode) : null,
        h('a', { class: 'btn sm primary' + (f.open ? '' : ' disabled'), href: f.open ? '/aurex-pen?room=' + encodeURIComponent(f.roomCode) : null, 'aria-disabled': f.open ? null : 'true' }, f.open ? 'Enter match' : 'Opens at the announced time')) : null;
      const share = f.played && f.score && window.AurexShare ? h('button', { class: 'btn sm', type: 'button', onclick: () => shareFixture(f) }, 'Share card') : null;
      return h('tr', null, stageCell, matchCell, h('td', null, f.scheduledAt ? fmtWhen(f.scheduledAt) : h('span', { class: 'muted' }, 'To be announced')), h('td', null, fxStatus(f)), h('td', null, act || share));
    }
    const when = h('input', { type: 'datetime-local', value: toLocalInput(f.scheduledAt), 'aria-label': 'Match time', disabled: f.played });
    const save = h('button', { class: 'btn sm', disabled: f.played, onclick: () => run(api('POST', `/admin/pen/fixtures/${f.id}/schedule`, { scheduledAt: fromLocalInput(when.value) }), 'Time saved', reload) }, 'Save');
    const walk = t => h('button', { class: 'btn sm danger', onclick: async () => { const v = await ask({ title: `Award ${t.name} a 3–0 walkover`, text: 'Use this when the other team did not show up. It is recorded as the result of this match and cannot be undone.', confirm: 'Award walkover', danger: true }); if (v) run(api('POST', `/admin/pen/fixtures/${f.id}/walkover`, { winnerTeamId: t.id }), 'Walkover recorded', reload); } }, `${t.name} wins 3–0`);
    const del = f.stage === 'league' ? h('button', { class: 'btn sm danger', onclick: async () => { const v = await ask({ title: 'Delete this match', text: `${f.teamA.name} v ${f.teamB.name} and its room code are removed. You can announce the pairing again.`, confirm: 'Delete', danger: true }); if (v) run(api('DELETE', `/admin/pen/fixtures/${f.id}`), 'Match deleted', reload); } }, 'Delete') : null;
    return h('tr', null, stageCell, matchCell,
      h('td', null, f.played ? fmtWhen(f.scheduledAt) : h('div', { class: 'row' }, when, save)),
      h('td', null, h('span', { class: 'chip code' }, f.roomCode)), h('td', null, fxStatus(f)),
      h('td', null, f.played ? null : h('div', { class: 'row' }, walk(f.teamA), walk(f.teamB), del)));
  });
  return h('div', { class: 'panel scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, heads.map(x => h('th', null, x)))), h('tbody', null, rows)));
}
function leagueBanner(d) {
  const L = d.league, p = d.progress;
  if (L.phase === 'finished' && L.champion) return h('div', { class: 'banner good mb14 row' }, h('span', { class: 'grow' }, h('b', null, 'CHAMPION: ' + L.champion.name + '. '), 'The AUREX Penalty League is finished.'), h('button', { class: 'btn sm', type: 'button', onclick: () => showCeremony(d) }, 'Replay ceremony'));
  if (L.phase === 'playoffs') return h('div', { class: 'banner good mb14' }, h('b', null, 'Play-offs. '), 'The round robin is over. Semi-finals and final are announced below. ', formatNote(L.teamCount));
  if (L.phase === 'league') return h('div', { class: 'banner good mb14' }, h('b', null, `The league is LIVE — ${p.leaguePlayed} of ${p.leagueTotal} league matches played. `), 'Win 3 · draw 1 · loss 0. Only the matches the owner announces count; room matches stay friendlies. ', formatNote(L.teamCount));
  return h('div', { class: 'banner warn mb14' }, 'The league has not started yet. Penalty duels from the lobby are friendlies and never count. ' + formatNote(0));
}

const nameSlug = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function shareFixture(f) {
  try {
    const win = f.winnerTeamId == null || f.drawn ? null : f.winnerTeamId === f.teamA.id ? 0 : 1, adv = f.stage !== 'league' && f.winnerTeamId ? (f.winnerTeamId === f.teamA.id ? f.teamA : f.teamB).name + ' go through' + (f.drawn ? ' (higher seed)' : '') : '';
    const note = [adv, RES_LABEL[f.score.reason] ? RES_LABEL[f.score.reason][0].toUpperCase() + RES_LABEL[f.score.reason].slice(1) : ''].filter(Boolean).join(' · ');
    const card = await AurexShare.matchCard({ teamA: f.teamA, teamB: f.teamB, goalsA: f.score.a, goalsB: f.score.b, stage: f.stage, winnerSide: win, note, when: f.scheduledAt ? new Date(f.scheduledAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : undefined });
    const r = await AurexShare.share(card, 'aurex-' + nameSlug(f.teamA.name + '-vs-' + f.teamB.name), `${f.teamA.name} ${f.score.a}–${f.score.b} ${f.teamB.name} · AUREX Penalty Cup`);
    if (r === 'downloaded') toast('Card saved as an image'); else if (r === 'shared') toast('Shared');
  } catch (e) { toast('Could not create the card', true); }
}

// ---------- next match card with a live countdown ----------
const pad2 = n => String(n).padStart(2, '0');
function fmtCountdown(ms) { const t = Math.max(0, Math.floor(ms / 1000)), dd = Math.floor(t / 86400), hh = Math.floor(t % 86400 / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return (dd ? dd + 'd ' : '') + pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss); }
function nextMatchCard(d, onOpen) {
  const open = d.fixtures.filter(f => !f.played), mine = open.filter(f => f.mine), pool = mine.length ? mine : open.filter(f => f.scheduledAt);
  const f = pool.slice().sort((a, b) => (a.scheduledAt ? +new Date(a.scheduledAt) : Infinity) - (b.scheduledAt ? +new Date(b.scheduledAt) : Infinity))[0]; if (!f) return null;
  const off = Date.parse(d.serverNow) - Date.now(), when = f.scheduledAt ? +new Date(f.scheduledAt) : null, isMine = !!f.mine;
  const cd = h('div', { class: 'nc-cd', role: 'timer' }), label = h('div', { class: 'nc-label muted' });
  const enter = isMine ? h('a', { class: 'btn primary nc-enter disabled', 'aria-disabled': 'true' }, 'Enter match') : null;
  const card = h('section', { class: 'nextcard' + (isMine ? ' mine' : '') },
    h('div', { class: 'row nc-top' }, h('span', { class: 'chip ' + (f.stage === 'league' ? 'approved' : 'active') }, STAGE_NAME[f.stage]), h('b', null, isMine ? 'Your next match' : 'Next match')),
    h('div', { class: 'nc-teams' }, h('div', { class: 'nc-team' }, crest(f.teamA), h('b', null, f.teamA.name)), h('div', { class: 'nc-vs' }, 'VS'), h('div', { class: 'nc-team' }, crest(f.teamB), h('b', null, f.teamB.name))),
    h('div', { class: 'nc-when' }, f.scheduledAt ? fmtWhen(f.scheduledAt) : 'Time to be announced'), cd, label,
    isMine ? h('div', { class: 'row nc-act' }, f.roomCode ? h('span', { class: 'chip code' }, f.roomCode) : null, enter) : null);
  let opened = false;
  const tick = () => {
    if (when == null) { cd.textContent = '--:--:--'; label.textContent = 'The owner has not announced the time yet.'; return; }
    const left = when - (Date.now() + off);
    if (left > 0) { cd.textContent = fmtCountdown(left); cd.classList.remove('live'); label.textContent = isMine ? 'The room opens at the announced time.' : 'Kick-off countdown'; return; }
    cd.textContent = 'ROOM OPEN'; cd.classList.add('live'); label.textContent = isMine ? 'Both teams can enter now.' : 'This match is open now.';
    if (enter && f.roomCode) { enter.setAttribute('href', '/aurex-pen?room=' + encodeURIComponent(f.roomCode)); enter.removeAttribute('aria-disabled'); enter.classList.remove('disabled'); }
    if (!opened) { opened = true; if (!f.open && onOpen) onOpen(); }      // the server's own "open" flag is refreshed once
  };
  const timer = setInterval(() => { if (!document.body.contains(card)) return clearInterval(timer); tick(); }, 1000); tick(); return card;
}

// ---------- play-off bracket ----------
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
function bracketView(d) {
  const n = d.league.teamCount; if (!d.league.started || (n !== 6 && n !== 8)) return null;
  const seeds = d.standings, anyPlayed = seeds.some(r => r.played > 0), fixed = d.league.phase !== 'league';
  const seed = i => { const r = seeds[i]; return r ? { id: r.teamId, name: r.name, hasLogo: r.hasLogo } : null; };
  const semis = d.fixtures.filter(f => f.stage === 'semi'), fin = d.fixtures.find(f => f.stage === 'final');
  const byPair = (a, b) => semis.find(f => (f.teamA.id === a.id && f.teamB.id === b.id) || (f.teamA.id === b.id && f.teamB.id === a.id));
  const fxRows = f => [[f.teamA, f.score && f.score.a], [f.teamB, f.score && f.score.b]].map(([t, sc]) => ({ team: t, score: sc == null ? null : sc, win: f.played && f.winnerTeamId === t.id }));
  const projRows = (i, j) => [i, j].map(k => ({ team: anyPlayed || fixed ? seed(k) : null, label: ORD[k] + ' place', proj: !fixed }));
  const semiCard = (title, i, j) => { const a = seed(i), b = seed(j), f = fixed && a && b ? byPair(a, b) : null; return { title, f, rows: f ? fxRows(f) : projRows(i, j), win: f && f.played ? (f.winnerTeamId === f.teamA.id ? f.teamA : f.teamB) : null }; };
  const cards = n === 8 ? [semiCard('Semi-final 1', 0, 3), semiCard('Semi-final 2', 1, 2)] : [semiCard('Semi-final', 1, 2)];
  const winRow = (c, label) => ({ team: c.win, label, proj: false });
  const finalRows = fin ? fxRows(fin) : n === 8 ? [winRow(cards[0], 'Winner SF1'), winRow(cards[1], 'Winner SF2')] : [{ team: fixed || anyPlayed ? seed(0) : null, label: '1st place', proj: !fixed }, winRow(cards[0], 'Winner of the semi-final')];
  const meta = f => (!f ? 'Not set yet' : f.played ? 'Played' : f.scheduledAt ? fmtWhen(f.scheduledAt) : 'Time to be announced');
  const row = r => h('div', { class: 'bk-team' + (r.win ? ' win' : '') + (r.proj ? ' proj' : '') }, r.team ? crest(r.team, true) : h('span', { class: 'bk-ph' }), h('span', { class: 'bk-name' }, r.team ? r.team.name : r.label), r.score != null ? h('b', { class: 'bk-sc' }, r.score) : null);
  const card = (title, rows, f) => h('div', { class: 'bk-card' + (f && f.mine ? ' mine' : '') + (f && f.open ? ' open' : '') }, h('div', { class: 'bk-title' }, h('span', null, title), h('span', { class: 'muted' }, meta(f))), rows.map(row));
  const col1 = n === 8 ? cards.map(c => card(c.title, c.rows, c.f)) : [h('div', { class: 'bk-card bye' }, h('div', { class: 'bk-title' }, h('span', null, 'Direct to the final'), h('span', { class: 'muted' }, '1st place')), row({ team: fixed || anyPlayed ? seed(0) : null, label: '1st place', proj: !fixed })), card(cards[0].title, cards[0].rows, cards[0].f)];
  const champ = d.league.champion;
  return h('div', { class: 'panel bkwrap' }, h('div', { class: 'bk', role: 'group', 'aria-label': 'Play-off bracket' },
    h('div', { class: 'bk-col semis' }, h('div', { class: 'bk-head' }, 'Semi-finals'), col1),
    h('div', { class: 'bk-col' }, h('div', { class: 'bk-head' }, 'Final'), card('Final', finalRows, fin)),
    h('div', { class: 'bk-col' }, h('div', { class: 'bk-head' }, 'Champion'), h('div', { class: 'bk-card champ' + (champ ? ' won' : '') }, champ ? [crest(champ), h('b', null, champ.name)] : [h('div', { class: 'bk-trophy', 'aria-hidden': 'true' }, '🏆'), h('span', { class: 'muted' }, 'To be decided')]))),
    fixed ? null : h('p', { class: 'muted small mt6' }, 'Projected from the current table — the real pairings are set when the round robin ends.'));
}

// ---------- champions ceremony ----------
const TROPHY = '<svg class="cer-trophy" viewBox="0 0 120 140" aria-hidden="true"><defs><linearGradient id="gtr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#e8b84a"/><stop offset="1" stop-color="#a8741a"/></linearGradient></defs><path d="M30 10h60v34c0 22-14 34-30 38-16-4-30-16-30-38z" fill="url(#gtr)"/><path d="M30 18H14c0 22 8 34 22 38M90 18h16c0 22-8 34-22 38" fill="none" stroke="#e8b84a" stroke-width="7" stroke-linecap="round"/><rect x="54" y="82" width="12" height="26" fill="url(#gtr)"/><path d="M34 128h52l-8-20H42z" fill="url(#gtr)"/></svg>';
function startConfetti(cv) {
  const ctx = cv.getContext('2d'), colors = ['#e8b84a', '#5b95ff', '#ffffff', '#41e0a0', '#ff6b86']; let w = 0, hh = 0, raf = 0, dead = false; const parts = [], t0 = performance.now();
  const size = () => { w = cv.width = innerWidth; hh = cv.height = innerHeight; }; size(); addEventListener('resize', size);
  const spawn = k => { for (let i = 0; i < k; i++) parts.push({ x: Math.random() * w, y: -20 - Math.random() * hh * 0.3, vx: (Math.random() - 0.5) * 2.2, vy: 2 + Math.random() * 3.2, r: 6 + Math.random() * 8, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)], k: 0.5 + Math.random() * 0.5 }); };
  spawn(170);
  const tick = now => {
    if (dead) return; ctx.clearRect(0, 0, w, hh); const el = now - t0; if (el < 7000) spawn(3);
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.x += p.vx + Math.sin(p.y / 40) * 0.6; p.y += p.vy; p.a += p.va; if (p.y > hh + 24) { parts.splice(i, 1); continue; } ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r * p.k / 2, p.r, p.r * p.k); ctx.restore(); }
    if (el < 7000 || parts.length) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', size); };
}
function showCeremony(d) {
  const c = d.league.champion; if (!c || document.querySelector('.cer')) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, canvas = h('canvas', { class: 'cer-conf', 'aria-hidden': 'true' }), trophy = h('div', { class: 'cer-trophywrap' });
  trophy.innerHTML = TROPHY;
  const prev = document.activeElement; let stop = null;
  const close = () => { if (stop) stop(); document.removeEventListener('keydown', onKey); ov.remove(); if (prev && prev.focus) prev.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const closeBtn = h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Close');
  const shareBtn = window.AurexShare ? h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { const card = await AurexShare.championCard({ team: c, subtitle: 'Winners of the AUREX Penalty League' }); const r = await AurexShare.share(card, 'aurex-champions-' + nameSlug(c.name), c.name + ' are the AUREX Penalty Cup champions!'); if (r === 'downloaded') toast('Card saved as an image'); }
    catch (e) { toast('Could not create the card', true); } } }, 'Share champion card') : null;
  const ov = h('div', { class: 'cer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Champions: ' + c.name }, canvas,
    h('div', { class: 'cer-body' }, trophy, h('img', { class: 'cer-crest', alt: c.hasLogo ? c.name + ' logo' : '', src: c.hasLogo ? logoUrl(c) : 'aurex-logo-sm.png' }),
      h('p', { class: 'cer-kick' }, 'AUREX PENALTY CUP'), h('h2', { class: 'cer-title' }, 'CHAMPIONS'), h('p', { class: 'cer-name' }, c.name), h('div', { class: 'row cer-act' }, shareBtn, closeBtn)));
  document.body.append(ov); document.addEventListener('keydown', onKey); closeBtn.focus(); if (!reduce) stop = startConfetti(canvas);
}
function maybeCeremony(d) {
  const L = d.league; if (L.phase !== 'finished' || !L.champion) return;
  const key = 'aurex.cer.' + L.champion.id + '.' + (L.startedAt || '');
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { /* storage blocked: show it each visit */ }
  showCeremony(d);
}
async function viewCup() {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  shell('cup', h('h2', null, 'AUREX Penalty Cup'), body);
  clearInterval(cupTimer);
  const load = async () => {
    const d = await api('GET', '/pen/cup'), my = S.team && S.team.status === 'active';
    const nextCard = nextMatchCard(d, () => load().catch(() => { })), bracket = bracketView(d);
    body.replaceChildren(h('div', null,
      leagueBanner(d), nextCard,
      bracket ? [h('h3', { class: 'mt14 mb6' }, 'Play-offs'), bracket] : null,
      d.league.started ? [h('h3', { class: 'mt14 mb6' }, 'Matches'), fixtureTable(d.fixtures, false)] : null,
      h('h3', { class: 'mt14 mb6' }, 'Table'), cupTable(d.standings, d.league.started),
      h('section', { class: 'panel mt14 mb14' }, h('h3', { class: 'mb6' }, 'Friendly duel'),
        h('p', { class: 'muted mb14' }, 'Practise against another team in a private room or the quick queue. Friendlies never count. One shoots, one keeps goal, then you swap. Five kicks each, sudden death if level, a draw if it is still level after ten kicks each. An AI referee and VAR watch every kick.'),
        h('div', { class: 'row' }, h('a', { class: 'btn' + (my ? '' : ' disabled'), href: my ? '/aurex-pen' : null, 'aria-disabled': my ? null : 'true' }, 'Play a friendly'), my ? null : h('span', { class: 'muted' }, 'Your team must be active to play.'))),
      h('section', { class: 'panel mt14 mb14' }, h('h3', { class: 'mb6' }, '📺 Reporter · گزارشگر'),
        h('p', { class: 'muted mb14' }, 'Watch the matches that are running right now. Pick a match from the live list and follow it from 9 camera angles (broadcast, kicker, keeper, net, goal, side, top view, ball cam) with instant slow-motion replays. You only watch; you cannot affect the match.'),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '/aurex-pen?mode=reporter' }, 'Watch live matches'))),
      h('h3', { class: 'mt14 mb6' }, 'Latest results'), cupResults(d.recent)));
    return d;
  };
  let first = null;
  try { first = await load(); } catch (e) { body.replaceChildren(h('div', { class: 'banner bad' }, e.message)); return; }
  try { maybeCeremony(first); } catch (_) { }
  cupTimer = setInterval(() => { if (location.hash.replace(/^#\/?/, '').split('/')[0] !== 'cup') return clearInterval(cupTimer); load().catch(() => { }); }, 15000);
}
async function adminLeague(body) {
  const [d, { teams }] = await Promise.all([api('GET', '/pen/cup'), api('GET', '/admin/teams')]), reload = () => adminLeague(body), L = d.league;
  const activeCount = teams.filter(t => t.status === 'active').length, okSize = [4, 6, 8].includes(activeCount);
  if (!L.started) {
    return body.replaceChildren(h('section', { class: 'panel' }, h('h3', { class: 'mb6' }, 'Penalty league'),
      h('p', { class: 'muted mb14' }, 'The league is played with 4, 6 or 8 ACTIVE teams. When you press Start the teams are frozen. Then you announce every match (who plays whom and when); the game picks a room code for each and opens it at the announced time. Every team plays every other team once.'),
      h('ul', { class: 'muted mb14' }, h('li', null, '4 teams: the table leader is the champion.'), h('li', null, '6 teams: top 3 go on. 2nd v 3rd in the semi-final, the winner plays the 1st in the final.'), h('li', null, '8 teams: top 4 go on. 1st v 4th and 2nd v 3rd, the winners play the final.')),
      h('div', { class: 'banner ' + (okSize ? 'good' : 'warn') + ' mb14' }, `Active teams right now: ${activeCount}. ` + (okSize ? 'Ready to start.' : 'Activate or suspend teams until there are exactly 4, 6 or 8.')),
      h('button', { class: 'btn primary', disabled: !okSize, onclick: async () => { const v = await ask({ title: 'Start the penalty league', text: `${activeCount} teams enter the league. The list is frozen from now on. This cannot be undone.`, confirm: 'Start league' }); if (v) run(api('POST', '/admin/pen/league/start'), 'League started', reload); } }, 'Start league'),
      h('h3', { class: 'mt14 mb6' }, 'Latest results'), cupResults(d.recent)));
  }
  const selA = h('select', { 'aria-label': 'Team A' }, h('option', { value: '' }, 'Team A'), d.teams.map(t => h('option', { value: t.id }, t.name)));
  const selB = h('select', { 'aria-label': 'Team B' }, h('option', { value: '' }, 'Team B'), d.teams.map(t => h('option', { value: t.id }, t.name)));
  const when = h('input', { type: 'datetime-local', 'aria-label': 'Match time' });
  const add = h('button', { class: 'btn primary', onclick: () => { if (!selA.value || !selB.value) return toast('Pick both teams', true); run(api('POST', '/admin/pen/fixtures', { teamA: +selA.value, teamB: +selB.value, scheduledAt: fromLocalInput(when.value) }), 'Match announced', reload); } }, 'Announce match');
  const gen = h('button', { class: 'btn', onclick: () => run(api('POST', '/admin/pen/fixtures/generate'), 'Pairings created — now set the times', reload) }, 'Create all missing pairings');
  body.replaceChildren(h('section', { class: 'panel' }, h('h3', { class: 'mb6' }, 'Penalty league'), leagueBanner(d),
    L.phase === 'league' ? h('div', null, h('h3', { class: 'mb6' }, 'Announce a match'),
      h('p', { class: 'muted mb14' }, `${d.progress.leagueAnnounced} of ${d.progress.leagueTotal} league matches announced. Pick the two teams and the time; the game chooses the room code, which opens at that time. Leave the time empty to set it later.`),
      h('div', { class: 'row mb14' }, selA, selB, when, add), h('div', { class: 'mb14' }, gen)) : null,
    bracketView(d) ? [h('h3', { class: 'mt14 mb6' }, 'Play-offs'), bracketView(d)] : null,
    h('h3', { class: 'mt14 mb6' }, 'Matches and room codes'), fixtureTable(d.fixtures, true, reload),
    h('h3', { class: 'mt14 mb6' }, 'Table'), cupTable(d.standings, true), h('h3', { class: 'mt14 mb6' }, 'Latest results'), cupResults(d.recent)));
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
  if (r === 'teams') return /^\d{1,9}$/.test(path[1] || '') ? viewTeamProfile(+path[1]) : viewTeams();
  if (r === 'clubs') return viewClubs();
  if (r === 'cup') return viewCup();
  if (r === 'account') return viewAccount();
  if (r === 'owner-setup') return viewOwnerSetup();
  if (r === 'admin') return viewAdmin(path[1]);
  go('#/team');
}
window.addEventListener('hashchange', render);
loadMe().then(render);
})();
