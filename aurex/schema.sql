-- AUREX CHAMPIONSHIP · phase 1 schema (idempotent; run at every boot)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER','OWNER')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta(key, value) VALUES ('team_seq', '0') ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  logo_mime TEXT,
  logo_data BYTEA,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','active','suspended')),
  team_code TEXT UNIQUE,
  captain_id INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  reject_reason TEXT,
  suspend_reason TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_live ON teams(name_lower) WHERE status <> 'rejected';
CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot IN (1,2)),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (team_id, user_id),
  UNIQUE (team_id, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_active ON team_members(user_id) WHERE active;
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- AUREX football club selection (Phase 2, PostgreSQL-native; safe/idempotent)
CREATE TABLE IF NOT EXISTS football_clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  starting_xi JSONB NOT NULL DEFAULT '[]'::jsonb,
  substitutes JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'aurex'
);
CREATE TABLE IF NOT EXISTS aurex_club_selection (
  aurex_team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  football_club_id TEXT NOT NULL UNIQUE REFERENCES football_clubs(id),
  selected_by INTEGER REFERENCES users(id),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AUREX PENALTY CUP (additive only: new tables, nothing existing is altered or dropped)
CREATE TABLE IF NOT EXISTS aurex_pen_league (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  started_at TIMESTAMPTZ,
  started_by INTEGER REFERENCES users(id)
);
INSERT INTO aurex_pen_league(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS aurex_pen_matches (
  id TEXT PRIMARY KEY,                       -- match id: a result can be stored only once
  team_a INTEGER NOT NULL REFERENCES teams(id),
  team_b INTEGER NOT NULL REFERENCES teams(id),
  player_a INTEGER REFERENCES users(id),
  player_b INTEGER REFERENCES users(id),
  goals_a SMALLINT NOT NULL,
  goals_b SMALLINT NOT NULL,
  kicks_a SMALLINT NOT NULL DEFAULT 0,
  kicks_b SMALLINT NOT NULL DEFAULT 0,
  result TEXT NOT NULL CHECK (result IN ('A','B','DRAW')),
  reason TEXT NOT NULL,
  league BOOLEAN NOT NULL DEFAULT FALSE,     -- false = friendly (played before the owner started the league)
  var_count SMALLINT NOT NULL DEFAULT 0,
  detail JSONB,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (team_a <> team_b)
);
CREATE INDEX IF NOT EXISTS aurex_pen_matches_league_idx ON aurex_pen_matches(league, finished_at);

-- AUREX PENALTY LEAGUE v2: scheduled fixtures with room codes + play-offs (additive; safe to re-run)
ALTER TABLE aurex_pen_league ADD COLUMN IF NOT EXISTS phase TEXT;                -- NULL/'idle' | 'league' | 'playoffs' | 'finished'
ALTER TABLE aurex_pen_league ADD COLUMN IF NOT EXISTS teams JSONB;               -- team ids that entered the league (frozen when the owner presses Start)
ALTER TABLE aurex_pen_league ADD COLUMN IF NOT EXISTS champion_team INTEGER REFERENCES teams(id);
ALTER TABLE aurex_pen_matches ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'friendly';   -- friendly | league | semi | final
ALTER TABLE aurex_pen_matches ADD COLUMN IF NOT EXISTS fixture_id INTEGER;
CREATE TABLE IF NOT EXISTS aurex_pen_fixtures (
  id SERIAL PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('league','semi','final')),
  team_a INTEGER NOT NULL REFERENCES teams(id),
  team_b INTEGER NOT NULL REFERENCES teams(id),
  scheduled_at TIMESTAMPTZ,                  -- NULL until the owner announces the time
  room_code TEXT NOT NULL UNIQUE,            -- chosen by the game; the room opens at scheduled_at
  match_id TEXT UNIQUE REFERENCES aurex_pen_matches(id),
  winner_team INTEGER REFERENCES teams(id),  -- NULL while unplayed or drawn
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (team_a <> team_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS aurex_pen_fixtures_pair_idx ON aurex_pen_fixtures(stage, LEAST(team_a, team_b), GREATEST(team_a, team_b));
