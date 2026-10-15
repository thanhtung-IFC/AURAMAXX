"""Check Aura configuration; --live verifies the provider without saving a conversation."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services.ai_service import AIServiceUnavailable, ai_configuration, get_ai_service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Send one short test request (uses provider quota).")
    args = parser.parse_args()
    config = ai_configuration()
    result = {**config, "connection_verified": False}
    if not config["available"]:
        result["setup"] = "Configure AI_PROVIDER, AI_API_KEY and AI_MODEL in .env, then restart run_web.py."
    elif args.live:
        async def check():
            return await asyncio.wait_for(get_ai_service().reply([{"role": "user", "content": "Chỉ trả lời: AURA AI đã kết nối."}]), timeout=125)
        try:
            reply = asyncio.run(check())
            result.update(connection_verified=True, provider=reply.provider, model=reply.model, reply=reply.text)
        except AIServiceUnavailable as error:
            result.update(status=error.kind, message=str(error))
        except TimeoutError:
            result.update(status="timeout", message="Aura AI phản hồi quá lâu. Hãy thử lại.")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if config["available"] and (not args.live or result["connection_verified"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
