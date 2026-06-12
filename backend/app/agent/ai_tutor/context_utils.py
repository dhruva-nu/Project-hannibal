import json


def parse_ck_value(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass
    return {}


def extract_course_id(context: list) -> int | None:
    for item in context:
        value = parse_ck_value(item.get("value"))
        if "courseId" in value:
            try:
                cid = value["courseId"]
                return int(cid) if cid is not None else None
            except TypeError, ValueError:
                pass
    return None


def extract_lesson_id(context: list) -> int | None:
    for item in context:
        value = parse_ck_value(item.get("value"))
        if "lessonId" in value:
            try:
                lid = value["lessonId"]
                return int(lid) if lid is not None else None
            except TypeError, ValueError:
                pass
    return None


def build_context_block(context: list) -> str:
    return "\n".join(
        f"- {item['description']}: {item['value']}"
        for item in context
        if item.get("description")
    )
