"""Use the original VisionFace report filter for bounded, text-only AI context."""
import json

from gemini_chat import REPORT_FIELDS, _clean


def sanitize_analysis(value: dict | None) -> dict | None:
    if value is None:
        return None
    if len(json.dumps(value, ensure_ascii=False)) > 50_000:
        raise ValueError("Báo cáo VisionFace quá lớn.")

    def compact(item):
        if isinstance(item, str):
            return item[:300]
        if isinstance(item, list):
            return [compact(child) for child in item[:8]]
        if isinstance(item, dict):
            return {key: compact(child) for key, child in item.items()}
        return item

    result = {}
    for key in REPORT_FIELDS:
        if key not in value:
            continue
        candidate = {**result, key: compact(_clean(value[key]))}
        # Leave room for the user's question within the provider context limit.
        if len(json.dumps(candidate, ensure_ascii=False, allow_nan=False)) <= 7_000:
            result = candidate
    return result or None
