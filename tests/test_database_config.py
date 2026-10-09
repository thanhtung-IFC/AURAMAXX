import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from database_config import CONFIG_NAME, create_store
from sql_server_store import connection_string


class DatabaseConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_default_sqlite_and_explicit_override(self):
        self.assertEqual(create_store(self.root).backend, "sqlite")
        (self.root / CONFIG_NAME).write_text(json.dumps({"backend": "sqlserver"}))
        self.assertEqual(create_store(self.root).backend, "sqlserver")
        with patch.dict(os.environ, {"FACE_DB_BACKEND": "sqlite"}):
            self.assertEqual(create_store(self.root).backend, "sqlite")

    def test_typo_is_rejected_instead_of_silently_switching_database(self):
        with patch.dict(os.environ, {"FACE_DB_BACKEND": "sqlsever"}):
            with self.assertRaises(ValueError):
                create_store(self.root)

    def test_postgres_requires_explicit_secret_and_overrides_local_sqlserver(self):
        (self.root / CONFIG_NAME).write_text(json.dumps({"backend": "sqlserver"}))
        with patch.dict(os.environ, {"FACE_DB_BACKEND": "postgres"}):
            with self.assertRaisesRegex(ValueError, "DATABASE_URL"):
                create_store(self.root)
            with patch("postgres_store.PostgresFaceStore") as constructor:
                with patch.dict(os.environ, {"DATABASE_URL": "secret-value"}):
                    create_store(self.root)
                constructor.assert_called_once_with("secret-value")

    def test_certificate_trust_is_explicit_and_typed(self):
        (self.root / CONFIG_NAME).write_text(json.dumps({"backend": "sqlserver"}))
        self.assertIn("TrustServerCertificate=no", create_store(self.root).connection_string)
        with patch.dict(os.environ, {"SQLSERVER_TRUST_CERTIFICATE": "true"}):
            self.assertIn("TrustServerCertificate=yes", create_store(self.root).connection_string)
        (self.root / CONFIG_NAME).write_text(json.dumps({"trust_certificate": "false"}))
        with self.assertRaises(ValueError):
            create_store(self.root)

    def test_connection_values_cannot_inject_new_options(self):
        value = connection_string("local;UID=other", "data}base")
        self.assertIn("SERVER={local;UID=other}", value)
        self.assertIn("DATABASE={data}}base}", value)

    def test_cloud_sql_authentication_uses_environment_secrets(self):
        with patch.dict(os.environ, {"FACE_DB_BACKEND": "sqlserver", "SQLSERVER_SERVER": "tcp:example.database.windows.net,1433",
                                    "SQLSERVER_DATABASE": "VisionFaceCloudTest", "SQLSERVER_USERNAME": "cloudadmin",
                                    "SQLSERVER_PASSWORD": "secret};Encrypt=no;"}):
            store = create_store(self.root)
        value = store.connection_string
        self.assertIn("UID={cloudadmin};PWD={secret}};Encrypt=no;};Encrypt=yes;", value)
        self.assertNotIn("Trusted_Connection", value)
        self.assertIn("TrustServerCertificate=no", value)

    def test_incomplete_credentials_fail_instead_of_using_windows_auth(self):
        for options in ({"username": "user"}, {"password": "secret"}, {"username": "", "password": "secret"},
                        {"username": "user", "password": ""}):
            with self.assertRaises(ValueError):
                connection_string("server", "database", **options)


if __name__ == "__main__":
    unittest.main()
