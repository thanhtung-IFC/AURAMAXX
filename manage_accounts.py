"""Create the first admin or reset a password locally; never store plaintext passwords."""

import argparse
import getpass
import secrets
import sys
from pathlib import Path

from auth_store import AuthStore, PASSWORDS
from database_config import create_store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("create-admin", "reset-password"))
    parser.add_argument("--username", default="admin")
    parser.add_argument("--generate-password", action="store_true")
    args = parser.parse_args()
    store = create_store(Path(__file__).resolve().parent)
    store.initialize()
    auth = AuthStore(store)
    auth.initialize()
    password = secrets.token_urlsafe(18) if args.generate_password else getpass.getpass("New password (12-128 characters): ")
    if not args.generate_password and password != getpass.getpass("Confirm password: "):
        raise ValueError("Passwords do not match")
    if args.command == "create-admin":
        account = auth.create_account(args.username, "Quản trị viên", password, role="admin", force_change=True)
    else:
        username = auth.username(args.username)
        auth.password(password)
        hashed = PASSWORDS.hash(password)
        with store._connect() as connection:
            auth.write_lock(connection)
            row = connection.execute("SELECT id FROM accounts WHERE username = ?", (username,)).fetchone()
            if not row:
                raise ValueError("Account does not exist")
            identifier = row[0]
            connection.execute("UPDATE accounts SET password_hash = ?, must_change_password = 1 WHERE id = ?", (hashed, identifier))
            connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            auth.audit(connection, identifier, "account.password_reset", identifier)
        account = auth.account(identifier)
    print("Username:", account["username"])
    if args.generate_password:
        print("Temporary password (shown only here):", password)
    print("Change this password at the first login.")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
