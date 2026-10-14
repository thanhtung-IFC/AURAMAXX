"""Quản lý tài khoản, danh sách và mật khẩu trong cơ sở dữ liệu SQLite / SQL Server."""

import argparse
import getpass
import json
import secrets
import sys
from pathlib import Path

from auth_store import AuthStore, PASSWORDS
from database_config import create_store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("list", "create-admin", "create-user", "reset-password"))
    parser.add_argument("--username", default="")
    parser.add_argument("--name", default="", help="Họ và tên hiển thị")
    parser.add_argument("--password", default="", help="Mật khẩu trực tiếp (tùy chọn)")
    parser.add_argument("--generate-password", action="store_true")
    args = parser.parse_args()

    store = create_store(Path(__file__).resolve().parent)
    store.initialize()
    auth = AuthStore(store)
    auth.initialize()

    if args.command == "list":
        accounts = auth.list_all_accounts()
        print(f"\n====================== DANH SÁCH TÀI KHOẢN ({len(accounts)}) ======================")
        print(f"{'TÊN ĐĂNG NHẬP':<20} | {'HỌ TÊN':<25} | {'VAI TRÒ':<8} | {'TRẠNG THÁI':<10} | {'NGÀY TẠO'}")
        print("-" * 85)
        for acc in accounts:
            status = "Hoạt động" if acc.get("is_active") else "Bị khóa"
            created = acc.get("created_at", "")[:19]
            print(f"{acc['username']:<20} | {acc['display_name']:<25} | {acc['role']:<8} | {status:<10} | {created}")
        print("=" * 85 + "\n")
        return

    username = args.username or input("Nhập tên đăng nhập: ").strip()

    if args.generate_password:
        password = secrets.token_urlsafe(12)
    elif args.password:
        password = args.password
    else:
        password = getpass.getpass("Mật khẩu mới (6-128 ký tự): ")
        if password != getpass.getpass("Xác nhận mật khẩu: "):
            raise ValueError("Mật khẩu xác nhận không khớp!")

    if args.command == "create-admin":
        display_name = args.name or "Quản trị viên"
        account = auth.create_account(username, display_name, password, role="admin", force_change=False)
        print("\n✓ Đã tạo thành công tài khoản Admin:")
        print(f"  - Username: {account['username']}")
        print(f"  - Tên: {account['display_name']}")
        if args.generate_password:
            print(f"  - Mật khẩu: {password}")

    elif args.command == "create-user":
        display_name = args.name or username
        account = auth.create_account(username, display_name, password, role="user", force_change=False)
        print("\n✓ Đã tạo thành công tài khoản Người dùng:")
        print(f"  - Username: {account['username']}")
        print(f"  - Tên: {account['display_name']}")
        if args.generate_password:
            print(f"  - Mật khẩu: {password}")

    elif args.command == "reset-password":
        valid_user = auth.username(username)
        auth.password(password)
        hashed = PASSWORDS.hash(password)
        with store._connect() as connection:
            auth.write_lock(connection)
            row = connection.execute("SELECT id FROM accounts WHERE username = ?", (valid_user,)).fetchone()
            if not row:
                raise ValueError(f"Tài khoản '{valid_user}' không tồn tại trong cơ sở dữ liệu.")
            identifier = row[0]
            connection.execute("UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?", (hashed, identifier))
            connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            auth.audit(connection, identifier, "account.password_reset", identifier)
        print(f"\n✓ Đã đặt lại mật khẩu thành công cho tài khoản '{valid_user}'.")
        if args.generate_password:
            print(f"  - Mật khẩu mới: {password}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
