CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO metadata VALUES ('revision', '0') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
    created_at TEXT NOT NULL,
    display_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS face_samples (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    vector_json TEXT NOT NULL CHECK(jsonb_typeof(vector_json::jsonb) = 'array'
                                    AND jsonb_array_length(vector_json::jsonb) = 60),
    feature_version TEXT NOT NULL,
    dimension INTEGER NOT NULL CHECK(dimension = 60),
    landmark_count INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE(person_id, feature_version, vector_json)
);
CREATE INDEX IF NOT EXISTS samples_person ON face_samples(person_id);
CREATE INDEX IF NOT EXISTS samples_version ON face_samples(feature_version, dimension);
CREATE OR REPLACE FUNCTION invalidate_face_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE metadata SET value = (value::bigint + 1)::text WHERE key = 'revision';
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS people_revision ON people;
CREATE TRIGGER people_revision AFTER INSERT OR UPDATE OR DELETE ON people
    FOR EACH STATEMENT EXECUTE FUNCTION invalidate_face_cache();
DROP TRIGGER IF EXISTS samples_revision ON face_samples;
CREATE TRIGGER samples_revision AFTER INSERT OR UPDATE OR DELETE ON face_samples
    FOR EACH STATEMENT EXECUTE FUNCTION invalidate_face_cache();
