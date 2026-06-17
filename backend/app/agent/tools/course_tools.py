from collections.abc import Iterator

from langchain_core.tools import tool

# Mocked catalogue keyed by difficulty level. A real implementation would
# query the course repository / embedding search instead.
_MOCK_CATALOG = {
    0: "Foundations of System Design",
    1: "Designing Scalable Web Services",
    2: "Distributed Systems Deep Dive",
}
_FALLBACK_COURSE = "Advanced Independent Study"


def get_level() -> Iterator[int]:
    """Yield an ever-increasing difficulty level for course recommendations.

    Starts at 0 and advances by one on each ``next()`` call, so successive
    recommendations escalate in difficulty.
    """
    level = 0
    while True:
        yield level
        level += 1


_level_generator = get_level()


def next_level() -> int:
    """Pull the next difficulty level from the shared generator."""
    return next(_level_generator)


@tool
def recommend_course(topic: str, level: int) -> str:
    """Recommend a course when the user asks about something outside the scope
    of their current lesson.

    ``level`` is the difficulty tier and is supplied by the recommendation
    node from ``get_level()`` — do not invent it yourself.
    """
    title = _MOCK_CATALOG.get(level, _FALLBACK_COURSE)
    return (
        f"Recommended course for '{topic}' (level {level}): {title}. "
        "That question is outside your current lesson — this course covers it."
    )
