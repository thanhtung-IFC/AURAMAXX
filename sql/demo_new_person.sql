-- Open in SSMS and run the ENTIRE script with F5.
-- Default: demonstrate an insert, then roll back. Existing data is preserved.
USE VisionFaceDB;
GO
SET XACT_ABORT ON;

DECLARE @SaveChanges BIT = 0; -- 0: practice/rollback; 1: permanently save.
DECLARE @PersonId NVARCHAR(128) = N'TEST_USER_001';
DECLARE @Name NVARCHAR(120) = N'Người dùng thử';
DECLARE @Now DATETIME2 = SYSUTCDATETIME();

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM dbo.people WHERE id = @PersonId)
        THROW 50001, N'Mã định danh đã tồn tại. Hãy dùng mã khác.', 1;

    INSERT INTO dbo.people (id, name, created_at, display_date)
    VALUES (
        @PersonId,
        @Name,
        CONVERT(NVARCHAR(27), @Now, 126) + N'+00:00',
        CONVERT(NVARCHAR(8), DATEADD(HOUR, 7, @Now), 108)
    );

    -- The new profile exists inside the transaction, but has no face sample.
    SELECT p.id, p.name, COUNT(s.id) AS sample_count
    FROM dbo.people AS p
    LEFT JOIN dbo.face_samples AS s ON s.person_id = p.id
    WHERE p.id = @PersonId
    GROUP BY p.id, p.name;

    IF @SaveChanges = 1
    BEGIN
        COMMIT;
        SELECT N'Đã lưu hồ sơ mới.' AS result;
    END
    ELSE
    BEGIN
        ROLLBACK;
        SELECT N'Đã hoàn tác bài thử; dữ liệu hiện có được giữ nguyên.' AS result;
    END;

    -- 0 after a practice run; 1 after a permanent save.
    SELECT COUNT(*) AS saved_profile_count
    FROM dbo.people WHERE id = @PersonId;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK;
    THROW;
END CATCH;
