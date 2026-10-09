-- VisionFace SQL Server schema. Run inside the selected application database.
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.metadata', N'U') IS NULL
    CREATE TABLE dbo.metadata (
        [key] NVARCHAR(128) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,
        [value] NVARCHAR(256) NOT NULL
    );

IF NOT EXISTS (SELECT 1 FROM dbo.metadata WHERE [key] = N'revision')
    INSERT INTO dbo.metadata ([key], [value]) VALUES (N'revision', N'0');

IF OBJECT_ID(N'dbo.people', N'U') IS NULL
    CREATE TABLE dbo.people (
        id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,
        name NVARCHAR(120) NOT NULL CHECK (LEN(name) BETWEEN 1 AND 120),
        created_at NVARCHAR(40) NOT NULL,
        display_date NVARCHAR(64) NOT NULL
    );

IF OBJECT_ID(N'dbo.face_samples', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.face_samples (
        id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,
        person_id NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL
            REFERENCES dbo.people(id) ON DELETE CASCADE,
        vector_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(vector_json) = 1),
        vector_hash BINARY(32) NOT NULL,
        feature_version NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        dimension INT NOT NULL CHECK (dimension = 60),
        landmark_count INT NULL CHECK (landmark_count >= 468),
        created_at NVARCHAR(40) NOT NULL,
        CONSTRAINT samples_unique UNIQUE (person_id, feature_version, vector_hash)
    );
    CREATE INDEX samples_person ON dbo.face_samples(person_id);
    CREATE INDEX samples_version ON dbo.face_samples(feature_version, dimension);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.metadata WHERE [key] = N'schema_version')
    INSERT INTO dbo.metadata ([key], [value]) VALUES (N'schema_version', N'1');
