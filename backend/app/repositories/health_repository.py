from app.schemas.health import HealthPayload


class HealthRepository:
    def get(self) -> HealthPayload:
        return HealthPayload(status="ok", service="backend")
