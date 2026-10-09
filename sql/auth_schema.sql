IF OBJECT_ID(N'dbo.accounts', N'U') IS NULL
    CREATE TABLE dbo.accounts (
        id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,
        username NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL UNIQUE,
        display_name NVARCHAR(120) NOT NULL,
        password_hash NVARCHAR(512) NOT NULL,
        role NVARCHAR(16) NOT NULL CHECK (role IN ('admin', 'user')),
        is_active INT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        must_change_password INT NOT NULL DEFAULT 0,
        created_at NVARCHAR(40) NOT NULL,
        last_login NVARCHAR(40) NULL
    );
IF OBJECT_ID(N'dbo.account_people', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.account_people (
        person_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 PRIMARY KEY REFERENCES dbo.people(id) ON DELETE CASCADE,
        account_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES dbo.accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX account_people_owner ON dbo.account_people(account_id);
END;
IF OBJECT_ID(N'dbo.auth_sessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.auth_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        account_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES dbo.accounts(id) ON DELETE CASCADE,
        csrf_token VARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL
    );
    CREATE INDEX sessions_account ON dbo.auth_sessions(account_id);
    CREATE INDEX sessions_expiry ON dbo.auth_sessions(expires_at);
END;
IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
    CREATE TABLE dbo.audit_logs (
        id NVARCHAR(128) PRIMARY KEY,
        actor_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL,
        action NVARCHAR(64) NOT NULL,
        target_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL,
        created_at NVARCHAR(40) NOT NULL
    );

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NOT NULL
BEGIN
    -- Upgrade existing databases without changing identifiers or deleting events.
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.audit_logs')
               AND name = N'actor_id' AND collation_name <> N'Latin1_General_100_BIN2')
        ALTER TABLE dbo.audit_logs ALTER COLUMN actor_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL;
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.audit_logs')
               AND name = N'target_id' AND collation_name <> N'Latin1_General_100_BIN2')
        ALTER TABLE dbo.audit_logs ALTER COLUMN target_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.audit_logs') AND name = N'audit_logs_recent')
        CREATE INDEX audit_logs_recent ON dbo.audit_logs(created_at DESC, id DESC);
END;
