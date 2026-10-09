-- SSMS: connect to localhost\SQLEXPRESS, open this file, Execute (F5).
-- Read-only queries: same database used by the web application.
USE VisionFaceDB;
GO

SELECT @@SERVERNAME AS server_name, DB_NAME() AS database_name,
       (SELECT COUNT(*) FROM dbo.audit_logs) AS audit_events,
       (SELECT COUNT(*) FROM dbo.accounts) AS accounts,
       (SELECT COUNT(*) FROM dbo.people) AS people,
       (SELECT COUNT(*) FROM dbo.face_samples) AS face_samples;

-- Latest 100 events, including events whose target has since been deleted.
SELECT TOP (100)
       l.id AS event_id, l.created_at AS time_utc,
       l.actor_id, a.username, a.display_name AS actor_name,
       l.action, l.target_id,
       COALESCE(p.name, target_account.display_name) AS current_target_name
FROM dbo.audit_logs AS l
LEFT JOIN dbo.accounts AS a ON a.id = l.actor_id
LEFT JOIN dbo.people AS p ON p.id = l.target_id
LEFT JOIN dbo.accounts AS target_account ON target_account.id = l.target_id
ORDER BY l.created_at DESC, l.id DESC;

-- Optional filters: NULL means all. Edit values below before executing.
DECLARE @Username NVARCHAR(64) = NULL; -- e.g. N'admin'
DECLARE @Action NVARCHAR(64) = NULL; -- e.g. N'person.sample_saved'
DECLARE @TargetId NVARCHAR(128) = NULL; -- person/account ID from the web
DECLARE @FromDateUTC NVARCHAR(10) = NULL; -- e.g. N'2026-10-09', inclusive
DECLARE @BeforeDateUTC NVARCHAR(10) = NULL; -- e.g. N'2026-10-10', exclusive

SELECT l.id AS event_id, l.created_at AS time_utc, a.username,
       l.action, l.target_id
FROM dbo.audit_logs AS l
LEFT JOIN dbo.accounts AS a ON a.id = l.actor_id
WHERE (@Username IS NULL OR a.username = @Username)
  AND (@Action IS NULL OR l.action = @Action)
  AND (@TargetId IS NULL OR l.target_id = @TargetId)
  AND (@FromDateUTC IS NULL OR l.created_at >= @FromDateUTC)
  AND (@BeforeDateUTC IS NULL OR l.created_at < @BeforeDateUTC)
ORDER BY l.created_at DESC, l.id DESC;

-- Count events by action.
SELECT action, COUNT(*) AS event_count, MAX(created_at) AS last_time_utc
FROM dbo.audit_logs
GROUP BY action
ORDER BY event_count DESC, action;

-- Accounts and owned face records; excludes password/session credentials.
SELECT id, username, display_name, role, is_active, must_change_password,
       created_at, last_login
FROM dbo.accounts
ORDER BY created_at DESC, id;

SELECT p.id AS person_id, p.name, a.username AS owner_username,
       p.created_at AS person_created_at, COUNT(s.id) AS sample_count
FROM dbo.people AS p
LEFT JOIN dbo.account_people AS o ON o.person_id = p.id
LEFT JOIN dbo.accounts AS a ON a.id = o.account_id
LEFT JOIN dbo.face_samples AS s ON s.person_id = p.id
GROUP BY p.id, p.name, a.username, p.created_at
ORDER BY p.created_at DESC, p.id;
