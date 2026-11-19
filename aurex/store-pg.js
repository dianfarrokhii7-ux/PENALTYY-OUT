'use strict';
// PostgreSQL store (Render PostgreSQL). Same contract as store-mem.js – see test/aurex-store.js.
const fs = require('fs');
const path = require('path');

function create(url, env = process.env) {
  const { Pool } = require('pg');
  const useSsl = env.PGSSL === '1' || (env.PGSSL !== '0' && /\.render\.com/.test(url));
  const pool = new Pool({ connectionString: url, max: +env.PG_POOL_MAX || 8, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
  pool.on('error', e => console.error('[aurex] pg pool error:', e.message));
  const q = (text, params) => pool.query(text, params);
  const iso = d => (d instanceof Date ? d.toISOString() : d);
  const FX_SQL = `SELECT f.*, m.team_a AS m_team_a, m.team_b AS m_team_b, m.goals_a AS m_goals_a, m.goals_b AS m_goals_b, m.result AS m_result, m.reason AS m_reason
    FROM aurex_pen_fixtures f LEFT JOIN aurex_pen_matches m ON m.id = f.match_id`;
  const fxOut = r => (r ? { id: r.id, stage: r.stage, teamA: r.team_a, teamB: r.team_b, scheduledAt: r.scheduled_at ? iso(r.scheduled_at) : null, roomCode: r.room_code, matchId: r.match_id || null, winnerTeam: r.winner_team || null, createdAt: iso(r.created_at),
    match: r.match_id ? { id: r.match_id, teamA: r.m_team_a, teamB: r.m_team_b, goalsA: r.m_goals_a, goalsB: r.m_goals_b, result: r.m_result, reason: r.m_reason } : null } : null);
  const dup = code => Object.assign(new Error(code), { code });

  const userOut = r => (r ? { id: r.id, username: r.username, role: r.role, status: r.status, createdAt: iso(r.created_at), passHash: r.pass_hash, recoveryHash: r.recovery_hash } : null);
  const TEAM_COLS = `t.id, t.name, t.team_code, t.status, t.captain_id, t.created_by, t.reject_reason, t.suspend_reason,
    t.decided_by, t.decided_at, t.created_at, (t.logo_data IS NOT NULL) AS has_logo`;
  async function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const m = await q(`SELECT m.team_id, m.user_id, m.slot, u.username FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ANY($1::int[]) ORDER BY m.slot`, [ids]);
    return rows.map(r => ({
      id: r.id, name: r.name, teamCode: r.team_code, status: r.status, captainId: r.captain_id, createdBy: r.created_by,
      rejectReason: r.reject_reason, suspendReason: r.suspend_reason, decidedBy: r.decided_by, decidedAt: iso(r.decided_at),
      createdAt: iso(r.created_at), hasLogo: r.has_logo,
      members: m.rows.filter(x => x.team_id === r.id).map(x => ({ userId: x.user_id, username: x.username, slot: x.slot })),
    }));
  }
  const one = async rows => (await hydrate(rows))[0] || null;

  return {
    kind: 'postgres',
    async migrate() {
      await q(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      const clubs = [
        ['barcelona','FC Barcelona','BAR',['#A50044','#004D98'],[],[],'penalty_out_existing'],
        ['realmadrid','Real Madrid','RMA',['#FFFFFF','#00529F'],[],[],'penalty_out_existing'],
        ['psg','Paris Saint-Germain','PSG',['#004170','#DA291C'],[
          {name:'Matvey Safonov',pos:'GK'},{name:'Achraf Hakimi',pos:'DF'},{name:'Marquinhos',pos:'DF'},
          {name:'João Neves',pos:'MF'},{name:'Vitinha',pos:'MF'},{name:'Ferran Torres',pos:'FW'},{name:'Ousmane Dembélé',pos:'FW'}
        ],[{name:'Khvicha Kvaratskhelia',pos:'FW'},{name:'Désiré Doué',pos:'FW'}],'aurex'],
        ['atletico','Atlético Madrid','ATM',['#CB3524','#FFFFFF'],[
          {name:'Jan Oblak',pos:'GK'},{name:'Cristian Romero',pos:'DF'},{name:'Alex Grimaldo',pos:'DF'},
          {name:'Koke',pos:'MF'},{name:'Johnny Cardoso',pos:'MF'},{name:'Julián Álvarez',pos:'FW'},{name:'Alexander Sørloth',pos:'FW'}
        ],[{name:'Jonathan David',pos:'FW'},{name:'Miguel Cubo',pos:'MF'}],'aurex']
      ];
      for (const c of clubs) await q(`INSERT INTO football_clubs(id,name,short,colors,starting_xi,substitutes,source)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,short=EXCLUDED.short,colors=EXCLUDED.colors,
        starting_xi=EXCLUDED.starting_xi,substitutes=EXCLUDED.substitutes,source=EXCLUDED.source`,
        [c[0],c[1],c[2],JSON.stringify(c[3]),JSON.stringify(c[4]),JSON.stringify(c[5]),c[6]]);
    },
    async listFootballClubs() {
      const r=await q(`SELECT c.id,c.name,c.short,c.colors,c.starting_xi,c.substitutes,c.source,
        s.aurex_team_id,s.selected_by,s.selected_at,t.name AS aurex_team_name,t.team_code
        FROM football_clubs c LEFT JOIN aurex_club_selection s ON s.football_club_id=c.id
        LEFT JOIN teams t ON t.id=s.aurex_team_id ORDER BY CASE c.id WHEN 'barcelona' THEN 1 WHEN 'realmadrid' THEN 2 WHEN 'psg' THEN 3 ELSE 4 END`);
      return r.rows.map(x=>({id:x.id,name:x.name,short:x.short,colors:x.colors,startingXI:x.starting_xi,substitutes:x.substitutes,
        source:x.source,selectedByTeamId:x.aurex_team_id,selectedByTeamName:x.aurex_team_name,teamCode:x.team_code,selectedAt:x.selected_at}));
    },
    async getClubSelection(teamId) {
      const r=await q(`SELECT c.id,c.name,c.short,c.colors,c.starting_xi,c.substitutes,c.source,s.selected_by,s.selected_at
        FROM aurex_club_selection s JOIN football_clubs c ON c.id=s.football_club_id WHERE s.aurex_team_id=$1`,[teamId]);
      const x=r.rows[0];return x?{id:x.id,name:x.name,short:x.short,colors:x.colors,startingXI:x.starting_xi,substitutes:x.substitutes,source:x.source,selectedBy:x.selected_by,selectedAt:x.selected_at}:null;
    },
    async selectFootballClub(teamId,clubId,userId) {
      const c=await pool.connect();
      try {
        await c.query('BEGIN');
        const t=await c.query('SELECT id,status,captain_id FROM teams WHERE id=$1 FOR UPDATE',[teamId]);
        if(!t.rowCount) {await c.query('ROLLBACK');return {kind:'NO_TEAM'};}
        const status=t.rows[0].status;
        if(!['approved','active','suspended'].includes(status)){await c.query('ROLLBACK');return {kind:'BAD_STATUS',status};}
        if(t.rows[0].captain_id!==userId){await c.query('ROLLBACK');return {kind:'NOT_CAPTAIN'};}
        if(status==='suspended'){
          const own=await c.query('SELECT football_club_id FROM aurex_club_selection WHERE aurex_team_id=$1',[teamId]);
          await c.query('ROLLBACK');return own.rows[0]&&own.rows[0].football_club_id===clubId?{kind:'UNCHANGED'}:{kind:'SUSPENDED'};
        }
        const taken=await c.query('SELECT aurex_team_id FROM aurex_club_selection WHERE football_club_id=$1 FOR UPDATE',[clubId]);
        if(taken.rowCount&&taken.rows[0].aurex_team_id!==teamId){await c.query('ROLLBACK');return {kind:'TAKEN'};}
        await c.query(`INSERT INTO aurex_club_selection(aurex_team_id,football_club_id,selected_by) VALUES($1,$2,$3)
          ON CONFLICT(aurex_team_id) DO UPDATE SET football_club_id=EXCLUDED.football_club_id,selected_by=EXCLUDED.selected_by,selected_at=now()`,[teamId,clubId,userId]);
        await c.query('COMMIT');return {kind:'OK'};
      }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return {kind:'TAKEN'};throw e;}finally{c.release();}
    },
    async releaseFootballClub(teamId) { await q('DELETE FROM aurex_club_selection WHERE aurex_team_id=$1',[teamId]); },
    async close() { await pool.end(); },
    async close() { await pool.end(); },
    // users
    async createUser({ username, passHash, recoveryHash }) {
      try {
        const r = await q('INSERT INTO users(username, username_lower, pass_hash, recovery_hash) VALUES ($1,$2,$3,$4) RETURNING *',
          [username, username.toLowerCase(), passHash, recoveryHash]);
        return userOut(r.rows[0]);
      } catch (e) { if (e.code === '23505') throw dup('DUP_USER'); throw e; }
    },
    async getUserByUsername(name) { return userOut((await q('SELECT * FROM users WHERE username_lower = $1', [String(name).toLowerCase()])).rows[0]); },
    async getUserById(id) { return userOut((await q('SELECT * FROM users WHERE id = $1', [id])).rows[0]); },
    async updateUser(id, p) {
      const map = { passHash: 'pass_hash', recoveryHash: 'recovery_hash', status: 'status', role: 'role' };
      const sets = [], vals = [];
      for (const k of Object.keys(map)) if (p[k] !== undefined) { vals.push(p[k]); sets.push(`${map[k]} = $${vals.length}`); }
      if (!sets.length) return this.getUserById(id);
      vals.push(id);
      return userOut((await q(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals)).rows[0]);
    },
    async listUsers() {
      const r = await q(`SELECT u.*, t.id AS t_id, t.name AS t_name, t.team_code AS t_code, t.status AS t_status
        FROM users u LEFT JOIN LATERAL (SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = u.id ORDER BY t.id DESC LIMIT 1) t ON TRUE
        ORDER BY u.id`);
      return r.rows.map(x => ({ ...userOut(x), passHash: undefined, recoveryHash: undefined,
        team: x.t_id ? { id: x.t_id, name: x.t_name, teamCode: x.t_code, status: x.t_status } : null }));
    },
    async countOwners() { return +(await q("SELECT count(*)::int AS n FROM users WHERE role = 'OWNER'")).rows[0].n; },
    async claimOwner(userId) { // atomic and one-shot: only the first caller ever gets true
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query("INSERT INTO meta(key, value) VALUES ('owner_bootstrap', $1) ON CONFLICT (key) DO NOTHING RETURNING key", [String(userId)]);
        if (!r.rowCount) { await c.query('ROLLBACK'); return false; }
        await c.query("UPDATE users SET role = 'OWNER', updated_at = now() WHERE id = $1", [userId]);
        await c.query('COMMIT'); return true;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    },
    // sessions
    async createSession({ userId, tokenHash, expiresAt, userAgent }) {
      await q('INSERT INTO sessions(token_hash, user_id, expires_at, user_agent) VALUES ($1,$2,$3,$4)', [tokenHash, userId, expiresAt, userAgent || null]);
    },
    async getSession(tokenHash) {
      const r = await q(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash]);
      return r.rows[0] ? { user: userOut(r.rows[0]), expiresAt: r.rows[0].expires_at } : null;
    },
    async deleteSession(tokenHash) { await q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]); },
    async deleteUserSessions(userId, exceptHash) { await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2', [userId, exceptHash || null]); },
    async purgeExpiredSessions() { await q('DELETE FROM sessions WHERE expires_at <= now()'); },
    // teams
    async createTeam({ name, passHash, logo, createdBy, memberIds }) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const t = await c.query(`INSERT INTO teams(name, name_lower, pass_hash, logo_mime, logo_data, captain_id, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [name, name.toLowerCase(), passHash, logo ? logo.mime : null, logo ? logo.data : null, createdBy]);
        for (let i = 0; i < memberIds.length; i++) await c.query('INSERT INTO team_members(team_id, user_id, slot) VALUES ($1,$2,$3)', [t.rows[0].id, memberIds[i], i + 1]);
        await c.query('COMMIT');
        return this.getTeamById(t.rows[0].id);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        if (e.code === '23505') throw dup(/teams_name_live/.test(e.constraint || '') ? 'DUP_TEAM' : 'MEMBER_BUSY');
        throw e;
      } finally { c.release(); }
    },
    async getTeamById(id) { return one((await q(`SELECT ${TEAM_COLS} FROM teams t WHERE t.id = $1`, [id])).rows); },
    async getTeamPassHash(id) { const r = await q('SELECT pass_hash FROM teams WHERE id = $1', [id]); return r.rows[0] ? r.rows[0].pass_hash : null; },
    async getActiveTeamForUser(userId) {
      return one((await q(`SELECT ${TEAM_COLS} FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 AND m.active`, [userId])).rows);
    },
    async getLatestTeamForUser(userId) {
      return one((await q(`SELECT ${TEAM_COLS} FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY t.id DESC LIMIT 1`, [userId])).rows);
    },
    async listTeams({ status } = {}) {
      return hydrate((await q(`SELECT ${TEAM_COLS} FROM teams t WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t.id DESC`, [status || null])).rows);
    },
    async updateTeam(id, p) {
      const map = { status: 'status', teamCode: 'team_code', captainId: 'captain_id', rejectReason: 'reject_reason', suspendReason: 'suspend_reason', decidedBy: 'decided_by', decidedAt: 'decided_at' };
      const sets = [], vals = [];
      for (const k of Object.keys(map)) if (p[k] !== undefined) { vals.push(p[k]); sets.push(`${map[k]} = $${vals.length}`); }
      if (sets.length) {
        vals.push(id);
        try { await q(`UPDATE teams SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals); }
        catch (e) { if (e.code === '23505') throw dup('DUP_CODE'); throw e; }
      }
      return this.getTeamById(id);
    },
    async releaseMembers(teamId) { await q('UPDATE team_members SET active = FALSE WHERE team_id = $1', [teamId]); },
    async nextTeamNumber() { return +(await q("UPDATE meta SET value = (value::int + 1)::text WHERE key = 'team_seq' RETURNING value")).rows[0].value; },
    async getLogo(teamId) {
      const r = await q('SELECT logo_mime, logo_data FROM teams WHERE id = $1 AND logo_data IS NOT NULL', [teamId]);
      return r.rows[0] ? { mime: r.rows[0].logo_mime, data: r.rows[0].logo_data } : null;
    },
    // ---- AUREX penalty cup
    async getPenLeague() {
      const r = (await q('SELECT started_at, started_by, phase, teams, champion_team FROM aurex_pen_league WHERE id = 1')).rows[0] || {};
      return { started: !!r.started_at && !!r.phase && r.phase !== 'idle', startedAt: r.started_at ? iso(r.started_at) : null, startedBy: r.started_by || null, phase: r.phase || 'idle', teams: r.teams || null, champion: r.champion_team || null };
    },
    async startPenLeague(userId, teamIds) {
      // allowed only while the phase is still idle (a league started under the old rules has no phase and is restarted cleanly: old matches have no fixture, so they never count)
      const r = await q("UPDATE aurex_pen_league SET started_at = now(), started_by = $1, phase = 'league', teams = $2, champion_team = NULL WHERE id = 1 AND (phase IS NULL OR phase = 'idle') RETURNING started_at", [userId, JSON.stringify(teamIds || [])]);
      if (r.rowCount) return { kind: 'OK', startedAt: iso(r.rows[0].started_at) };
      return { kind: 'ALREADY', startedAt: iso((await q('SELECT started_at FROM aurex_pen_league WHERE id = 1')).rows[0].started_at) };
    },
    async setPenLeaguePhase(phase, champion) {
      if (champion === undefined) await q('UPDATE aurex_pen_league SET phase = $1 WHERE id = 1', [phase]);
      else await q('UPDATE aurex_pen_league SET phase = $1, champion_team = $2 WHERE id = 1', [phase, champion]);
    },
    // fixtures: scheduled matches with a room code that opens at the announced time
    async createPenFixture({ stage, teamA, teamB, scheduledAt, roomCode }) {
      try {
        const r = await q('INSERT INTO aurex_pen_fixtures(stage, team_a, team_b, scheduled_at, room_code) VALUES ($1,$2,$3,$4,$5) RETURNING *', [stage, teamA, teamB, scheduledAt || null, roomCode]);
        return { kind: 'OK', fixture: fxOut(r.rows[0]) };
      } catch (e) {
        if (e.code === '23505') return { kind: /room_code/.test(String(e.constraint || e.detail || e.message)) ? 'DUP_CODE' : 'DUP_PAIR' };
        throw e;
      }
    },
    async getPenFixture(id) { return fxOut((await q(FX_SQL + ' WHERE f.id = $1', [id])).rows[0]); },
    async getPenFixtureByCode(code) { return fxOut((await q(FX_SQL + ' WHERE f.room_code = $1', [code])).rows[0]); },
    async listPenFixtures() { return (await q(FX_SQL + ' ORDER BY f.id')).rows.map(fxOut); },
    async updatePenFixture(id, patch) { if (patch.scheduledAt !== undefined) await q('UPDATE aurex_pen_fixtures SET scheduled_at = $2 WHERE id = $1', [id, patch.scheduledAt]); return this.getPenFixture(id); },
    async deletePenFixture(id) { return (await q('DELETE FROM aurex_pen_fixtures WHERE id = $1 AND match_id IS NULL', [id])).rowCount > 0; },
    async recordPenMatch(m) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        if (m.fixtureId != null) {
          const f = await c.query('SELECT id, match_id FROM aurex_pen_fixtures WHERE id = $1 FOR UPDATE', [m.fixtureId]);
          if (!f.rowCount) { await c.query('ROLLBACK'); return { kind: 'NO_FIXTURE' }; }
          if (f.rows[0].match_id) { await c.query('ROLLBACK'); return { kind: 'DUP' }; }     // a fixture can only ever carry ONE result
        }
        const r = await c.query(`INSERT INTO aurex_pen_matches(id, team_a, team_b, player_a, player_b, goals_a, goals_b, kicks_a, kicks_b, result, reason, league, var_count, detail, stage, fixture_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
          [m.id, m.teamA, m.teamB, m.playerA || null, m.playerB || null, m.goalsA, m.goalsB, m.kicksA || 0, m.kicksB || 0, m.result, m.reason, !!m.league, m.varCount || 0, m.detail ? JSON.stringify(m.detail) : null, m.stage || 'friendly', m.fixtureId == null ? null : m.fixtureId]);
        if (!r.rowCount) { await c.query('ROLLBACK'); return { kind: 'DUP' }; }
        if (m.fixtureId != null) await c.query('UPDATE aurex_pen_fixtures SET match_id = $2, winner_team = $3 WHERE id = $1', [m.fixtureId, m.id, m.winnerTeam == null ? null : m.winnerTeam]);
        await c.query('COMMIT'); return { kind: 'OK' };
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    },
    async listPenMatches({ leagueOnly = false, limit = 50 } = {}) {
      const r = await q(`SELECT m.*, ta.name AS ta_name, tb.name AS tb_name, ua.username AS ua_name, ub.username AS ub_name FROM aurex_pen_matches m
        JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b LEFT JOIN users ua ON ua.id = m.player_a LEFT JOIN users ub ON ub.id = m.player_b
        WHERE ($1::boolean = FALSE OR (m.league AND m.fixture_id IS NOT NULL)) ORDER BY m.finished_at DESC, m.id DESC LIMIT $2`, [!!leagueOnly, limit]);
      return r.rows.map(x => ({ id: x.id, teamA: x.team_a, teamB: x.team_b, playerA: x.player_a, playerB: x.player_b, goalsA: x.goals_a, goalsB: x.goals_b, kicksA: x.kicks_a, kicksB: x.kicks_b,
        result: x.result, reason: x.reason, league: x.league, stage: x.stage, fixtureId: x.fixture_id, varCount: x.var_count, finishedAt: iso(x.finished_at), teamAName: x.ta_name, teamBName: x.tb_name, playerAName: x.ua_name || '?', playerBName: x.ub_name || '?' }));
    },
    async allLeaguePenMatches() {
      const r = await q('SELECT id, team_a, team_b, goals_a, goals_b, result, finished_at FROM aurex_pen_matches WHERE league AND fixture_id IS NOT NULL ORDER BY finished_at, id');
      return r.rows.map(x => ({ id: x.id, teamA: x.team_a, teamB: x.team_b, goalsA: x.goals_a, goalsB: x.goals_b, result: x.result, finishedAt: iso(x.finished_at) }));
    },
    // audit
    async addAudit({ actorId, action, targetType, targetId, detail }) {
      await q('INSERT INTO audit_log(actor_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)',
        [actorId, action, targetType || null, targetId == null ? null : String(targetId), detail ? JSON.stringify(detail) : null]);
    },
    async listAudit(limit = 100) {
      const r = await q(`SELECT a.*, u.username AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT $1`, [limit]);
      return r.rows.map(a => ({ id: a.id, actorId: a.actor_id, actor: a.actor, action: a.action, targetType: a.target_type, targetId: a.target_id, detail: a.detail, createdAt: iso(a.created_at) }));
    },
  };
}
module.exports = { create };
