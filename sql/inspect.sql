-- Open in SSMS, connect to localhost\SQLEXPRESS, then Execute (F5).
USE VisionFaceDB;
GO

SELECT DB_NAME() AS current_database;

SELECT p.id, p.name, p.created_at, COUNT(s.id) AS sample_count
FROM dbo.people AS p
LEFT JOIN dbo.face_samples AS s ON s.person_id = p.id
GROUP BY p.id, p.name, p.created_at
ORDER BY p.created_at, p.id;

SELECT p.name, s.id AS sample_id, s.person_id,
       s.dimension, s.landmark_count, s.feature_version, s.created_at
FROM dbo.face_samples AS s
JOIN dbo.people AS p ON p.id = s.person_id
ORDER BY s.created_at, s.id;

SELECT (SELECT COUNT(*) FROM dbo.people) AS people,
       (SELECT COUNT(*) FROM dbo.face_samples) AS samples;
