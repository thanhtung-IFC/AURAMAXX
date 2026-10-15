"""Check Aura configuration; --live verifies the provider without saving a conversation."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services.ai_service import AIServiceUnavailable, ai_configuration, get_ai_service, ai_http_pool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Send one short test request (uses provider quota).")
    parser.add_argument("--style", choices=("quick", "balanced", "thorough"), default="balanced", help="Response style for the live test.")
    args = parser.parse_args()
    config = ai_configuration()
    result = {**config, "connection_verified": False}
    if not config["available"]:
        result["setup"] = "Configure AI_PROVIDER, AI_API_KEY and AI_MODEL in .env, then restart run_web.py."
    elif args.live:
        async def check():
            async with ai_http_pool():
                service = get_ai_service(response_style=args.style)
                started = perf_counter()
                first_token_ms = None
                chunks = []
                async for chunk in service.stream_reply([{"role": "user", "content": "Chỉ trả lời: AURA AI đã kết nối."}]):
                    if first_token_ms is None:
                        first_token_ms = round((perf_counter() - started) * 1000)
                    chunks.append(chunk)
                if not "".join(chunks).strip():
                    raise AIServiceUnavailable("AI chưa tạo được câu trả lời.", kind="empty_response")
                return dict(provider=service.provider, model=service.model, reply="".join(chunks).strip(), response_style=args.style,
                            first_token_ms=first_token_ms, total_ms=round((perf_counter() - started) * 1000))
        try:
            async def bounded_check():
                return await asyncio.wait_for(check(), timeout=125)
            result.update(connection_verified=True, **asyncio.run(bounded_check()))
        except AIServiceUnavailable as error:
            result.update(status=error.kind, message=str(error))
        except TimeoutError:
            result.update(status="timeout", message="Aura AI phản hồi quá lâu. Hãy thử lại.")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if config["available"] and (not args.live or result["connection_verified"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
