"""Round-trip tests for the RabbitMQ wire contracts."""

from rce_service.contracts import EventV1, JobV1, ResultBody, ResultError, ResultV1


class TestJobV1:
    def test_round_trips_through_json(self):
        job = JobV1(job_id="j1", mode="sync", language="python", code="print(1)")
        restored = JobV1.model_validate_json(job.model_dump_json())
        assert restored == job

    def test_default_version_is_one(self):
        job = JobV1(job_id="j1", mode="stream", language="python", code="x=1")
        assert job.v == 1


class TestResultV1:
    def test_round_trips_a_success_result(self):
        result = ResultV1(
            job_id="j1",
            ok=True,
            result=ResultBody(
                exec_id="e",
                exit_code=0,
                stdout="out",
                stderr="",
                timed_out=False,
                duration_ms=5,
            ),
        )
        restored = ResultV1.model_validate_json(result.model_dump_json())
        assert restored == result
        assert restored.v == 1

    def test_round_trips_an_error_result(self):
        result = ResultV1(
            job_id="j1",
            ok=False,
            error=ResultError(code="saturated", message="too many"),
        )
        restored = ResultV1.model_validate_json(result.model_dump_json())
        assert restored == result


class TestEventV1:
    def test_round_trips_through_json(self):
        event = EventV1(
            job_id="j1",
            event={"exec_id": "e", "line": "hi\n", "event_type": "stdout"},
        )
        restored = EventV1.model_validate_json(event.model_dump_json())
        assert restored == event
        assert restored.v == 1
