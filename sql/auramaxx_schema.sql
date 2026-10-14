-- AURAMAXX project data owned by the same local SQL Server as VisionFace.
-- Additive setup: no source tables or records are dropped.
IF SCHEMA_ID(N'auramaxx') IS NULL EXEC(N'CREATE SCHEMA auramaxx AUTHORIZATION dbo');
GO
IF OBJECT_ID(N'auramaxx.schema_version', N'U') IS NULL
CREATE TABLE auramaxx.schema_version (
 version INT PRIMARY KEY,
 applied_at VARCHAR(40) NOT NULL DEFAULT (CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00')
);
GO
IF OBJECT_ID(N'auramaxx.users', N'U') IS NULL
CREATE TABLE auramaxx.users (
 id NVARCHAR(128) PRIMARY KEY,
 email NVARCHAR(254) COLLATE Latin1_General_100_CI_AS_SC NOT NULL UNIQUE,
 password_hash NVARCHAR(512) NOT NULL,
 created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.sessions', N'U') IS NULL
CREATE TABLE auramaxx.sessions (
 token_hash NVARCHAR(128) PRIMARY KEY,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 csrf_token NVARCHAR(128) NOT NULL,
 created_at VARCHAR(40) NOT NULL, expires_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.legacy_account_links', N'U') IS NULL
CREATE TABLE auramaxx.legacy_account_links (
 user_id NVARCHAR(128) PRIMARY KEY REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 account_id NVARCHAR(128) NOT NULL UNIQUE,
 credential_hash NVARCHAR(128) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.user_consents', N'U') IS NULL
CREATE TABLE auramaxx.user_consents (
 id NVARCHAR(128) PRIMARY KEY,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 purpose VARCHAR(32) NOT NULL CHECK(purpose IN ('face_analysis','health_tracking','ai_chat')),
 granted INT NOT NULL CHECK(granted IN (0,1)),
 policy_version NVARCHAR(32) NOT NULL, created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.habit_entries', N'U') IS NULL
CREATE TABLE auramaxx.habit_entries (
 id NVARCHAR(128) PRIMARY KEY,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 category VARCHAR(24) NOT NULL CHECK(category IN ('water','sleep','movement','self_care')),
 [value] NVARCHAR(100) NOT NULL, unit NVARCHAR(24) NOT NULL DEFAULT '',
 note NVARCHAR(500) NOT NULL DEFAULT '', recorded_at VARCHAR(40) NOT NULL, created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.ai_conversations', N'U') IS NULL
CREATE TABLE auramaxx.ai_conversations (
 id NVARCHAR(128) PRIMARY KEY,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 title NVARCHAR(120) NOT NULL DEFAULT N'Cuộc trò chuyện mới',
 created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.ai_messages', N'U') IS NULL
CREATE TABLE auramaxx.ai_messages (
 id NVARCHAR(128) PRIMARY KEY,
 conversation_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.ai_conversations(id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL CHECK(role IN ('user','assistant')),
 content NVARCHAR(MAX) NOT NULL CHECK(LEN(content)<=16000), created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.ai_request_limits', N'U') IS NULL
CREATE TABLE auramaxx.ai_request_limits (
 id NVARCHAR(128) PRIMARY KEY,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 created_at VARCHAR(40) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.arena_profiles', N'U') IS NULL
CREATE TABLE auramaxx.arena_profiles (
 user_id NVARCHAR(128) PRIMARY KEY REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 display_name NVARCHAR(64) COLLATE Latin1_General_100_CI_AS_SC NOT NULL UNIQUE,
 leaderboard_public INT NOT NULL DEFAULT 0 CHECK(leaderboard_public IN (0,1)),
 elo INT NOT NULL DEFAULT 1000 CHECK(elo>=0), highest_elo INT NOT NULL DEFAULT 1000 CHECK(highest_elo>=0),
 matches_played INT NOT NULL DEFAULT 0 CHECK(matches_played>=0),
 wins INT NOT NULL DEFAULT 0 CHECK(wins>=0), losses INT NOT NULL DEFAULT 0 CHECK(losses>=0), draws INT NOT NULL DEFAULT 0 CHECK(draws>=0),
 created_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00'),
 updated_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00')
);
GO
IF OBJECT_ID(N'auramaxx.arena_matches', N'U') IS NULL
CREATE TABLE auramaxx.arena_matches (
 id NVARCHAR(128) PRIMARY KEY,
 status VARCHAR(16) NOT NULL CHECK(status IN ('queued','matched','completed','cancelled')),
 created_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00'), completed_at VARCHAR(40)
);
GO
IF OBJECT_ID(N'auramaxx.arena_match_participants', N'U') IS NULL
CREATE TABLE auramaxx.arena_match_participants (
 match_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.arena_matches(id) ON DELETE CASCADE,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 result VARCHAR(16) CHECK(result IN ('win','loss','draw')), elo_before INT, elo_after INT,
 PRIMARY KEY(match_id,user_id)
);
GO
IF OBJECT_ID(N'auramaxx.arena_elo_history', N'U') IS NULL
CREATE TABLE auramaxx.arena_elo_history (
 id NVARCHAR(128) PRIMARY KEY,
 match_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.arena_matches(id) ON DELETE CASCADE,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 elo_before INT NOT NULL, elo_after INT NOT NULL,
 created_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00'), UNIQUE(match_id,user_id)
);
GO
IF OBJECT_ID(N'auramaxx.arena_achievements', N'U') IS NULL
CREATE TABLE auramaxx.arena_achievements (
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 achievement_key NVARCHAR(64) NOT NULL,
 awarded_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00'),
 PRIMARY KEY(user_id,achievement_key)
);
GO
IF OBJECT_ID(N'auramaxx.arena_bot_profiles', N'U') IS NULL
CREATE TABLE auramaxx.arena_bot_profiles (
 user_id NVARCHAR(128) PRIMARY KEY REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 elo INT NOT NULL DEFAULT 1000 CHECK(elo>=0), highest_elo INT NOT NULL DEFAULT 1000 CHECK(highest_elo>=0),
 matches_played INT NOT NULL DEFAULT 0 CHECK(matches_played>=0),
 wins INT NOT NULL DEFAULT 0 CHECK(wins>=0), losses INT NOT NULL DEFAULT 0 CHECK(losses>=0), draws INT NOT NULL DEFAULT 0 CHECK(draws>=0),
 updated_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00')
);
GO
IF OBJECT_ID(N'auramaxx.arena_bot_matches', N'U') IS NULL
CREATE TABLE auramaxx.arena_bot_matches (
 id NVARCHAR(128) PRIMARY KEY, request_id NVARCHAR(128) NOT NULL,
 user_id NVARCHAR(128) NOT NULL REFERENCES auramaxx.users(id) ON DELETE CASCADE,
 bot_id VARCHAR(16) NOT NULL CHECK(bot_id IN ('rookie','casual','skilled','elite','champion')),
 result VARCHAR(16) NOT NULL CHECK(result IN ('win','loss','draw')),
 player_score FLOAT NOT NULL CHECK(player_score BETWEEN 0 AND 100), bot_score FLOAT NOT NULL CHECK(bot_score BETWEEN 0 AND 100),
 bot_elo INT NOT NULL CHECK(bot_elo>=0), elo_before INT NOT NULL CHECK(elo_before>=0), elo_after INT NOT NULL CHECK(elo_after>=0),
 coverage INT NOT NULL CHECK(coverage BETWEEN 50 AND 100),
 created_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00'), UNIQUE(user_id,request_id)
);
GO
IF OBJECT_ID(N'auramaxx.data_handoffs', N'U') IS NULL
CREATE TABLE auramaxx.data_handoffs (
 id NVARCHAR(128) PRIMARY KEY, manifest_hash NVARCHAR(128) NOT NULL,
 imported_at VARCHAR(40) NOT NULL, details NVARCHAR(MAX) NOT NULL
);
GO
IF OBJECT_ID(N'auramaxx.admin_feature_flags', N'U') IS NULL
CREATE TABLE auramaxx.admin_feature_flags (
 feature_key NVARCHAR(64) PRIMARY KEY,
 enabled INT NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_at VARCHAR(40) NOT NULL DEFAULT(CONVERT(VARCHAR(33),SYSUTCDATETIME(),126)+'+00:00')
);
GO
INSERT INTO auramaxx.admin_feature_flags(feature_key,enabled)
SELECT v.feature_key,1 FROM (VALUES ('user_registration'),('aura_ai'),('health_tracking'),('face_analysis'),('arena')) v(feature_key)
WHERE NOT EXISTS(SELECT 1 FROM auramaxx.admin_feature_flags f WHERE f.feature_key=v.feature_key);
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_sessions_user' AND object_id=OBJECT_ID('auramaxx.sessions'))
 CREATE INDEX idx_sessions_user ON auramaxx.sessions(user_id);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_consents_time' AND object_id=OBJECT_ID('auramaxx.user_consents'))
 CREATE INDEX idx_consents_time ON auramaxx.user_consents(user_id,purpose,created_at DESC);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_habits_time' AND object_id=OBJECT_ID('auramaxx.habit_entries'))
 CREATE INDEX idx_habits_time ON auramaxx.habit_entries(user_id,recorded_at DESC);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_ai_history' AND object_id=OBJECT_ID('auramaxx.ai_conversations'))
 CREATE INDEX idx_ai_history ON auramaxx.ai_conversations(user_id,updated_at DESC);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_ai_messages_time' AND object_id=OBJECT_ID('auramaxx.ai_messages'))
 CREATE INDEX idx_ai_messages_time ON auramaxx.ai_messages(conversation_id,created_at,id);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_ai_limits' AND object_id=OBJECT_ID('auramaxx.ai_request_limits'))
 CREATE INDEX idx_ai_limits ON auramaxx.ai_request_limits(user_id,created_at DESC);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_arena_leaderboard' AND object_id=OBJECT_ID('auramaxx.arena_profiles'))
 CREATE INDEX idx_arena_leaderboard ON auramaxx.arena_profiles(leaderboard_public,elo DESC,matches_played DESC);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='idx_bot_history' AND object_id=OBJECT_ID('auramaxx.arena_bot_matches'))
 CREATE INDEX idx_bot_history ON auramaxx.arena_bot_matches(user_id,created_at DESC);
