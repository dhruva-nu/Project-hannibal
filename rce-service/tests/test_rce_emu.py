"""Tests for the emu integration module: mounts, argv, config, op log (#153)."""

import base64
import json
from unittest.mock import MagicMock

import docker
import pytest

from rce_service import emu


class TestMounts:
    def test_the_binary_volume_is_never_writable(self):
        assert all(mount["mode"] == "ro" for mount in emu.mounts().values())

    def test_only_the_binary_volume_is_mounted(self):
        assert set(emu.mounts()) == {emu.BINARY_VOLUME}

    def test_the_binary_lives_under_the_mount_point(self):
        assert emu.BINARY.startswith(emu.mounts()[emu.BINARY_VOLUME]["bind"] + "/")


class TestEnsurePublished:
    def test_a_published_volume_passes(self):
        client = MagicMock()

        emu.ensure_published(client)

        client.volumes.get.assert_called_once_with(emu.BINARY_VOLUME)

    def test_a_missing_volume_fails_before_the_container_starts(self):
        client = MagicMock()
        client.volumes.get.side_effect = docker.errors.NotFound("no such volume")

        with pytest.raises(emu.EmuNotPublished) as failure:
            emu.ensure_published(client)

        assert "just publish-emu" in str(failure.value)


class TestWrap:
    def test_the_child_command_survives_intact(self):
        assert emu.wrap(["python3", "-u", "/tmp/x.py"])[-3:] == [
            "python3",
            "-u",
            "/tmp/x.py",
        ]

    def test_emu_runs_the_child_behind_the_separator(self):
        wrapped = emu.wrap(["python3", "/tmp/x.py"])

        assert wrapped[:4] == [emu.BINARY, "run", "--config", emu.CONFIG_PATH]
        assert wrapped[4] == "--"

    def test_no_control_channel_is_ever_requested(self):
        # The invariant the threat model rests on. See
        # tests/test_rce_security_invariants.py for the same assertion made
        # against a real run.
        wrapped = " ".join(emu.wrap(["python3", "/tmp/x.py"]))

        assert "--dev-control-socket" not in wrapped
        assert "--dev-control-bind" not in wrapped


class TestEncodeConfig:
    def test_the_config_decodes_back_to_what_the_lesson_declared(self):
        config = {"services": ["postgres"], "seed": {"postgres": ["SELECT 1"]}}

        decoded = base64.b64decode(emu.encode_config(config))

        assert json.loads(decoded) == config


_OPLOG = [{"n": 1, "emu": "postgres", "op": "COMMIT", "fault": "error"}]
_OPLOG_LINE = json.dumps({emu.OPLOG_KEY: _OPLOG}).encode()


class TestSplitOplog:
    def test_the_student_keeps_their_own_output(self):
        stdout, _ = emu.split_oplog(b"transfer 0 ok\n" + _OPLOG_LINE + b"\n")

        assert stdout == b"transfer 0 ok\n"

    def test_the_op_log_comes_back_as_structured_data(self):
        _, oplog = emu.split_oplog(b"transfer 0 ok\n" + _OPLOG_LINE + b"\n")

        assert oplog == _OPLOG

    def test_a_silent_program_leaves_only_the_op_log(self):
        stdout, oplog = emu.split_oplog(_OPLOG_LINE + b"\n")

        assert stdout == b""
        assert oplog == _OPLOG

    def test_output_without_an_op_log_is_handed_back_untouched(self):
        raw = b"transfer 0 ok\nno log here\n"

        assert emu.split_oplog(raw) == (raw, None)

    def test_undecodable_output_is_not_mistaken_for_a_log(self):
        raw = b"\xff\xfe binary garbage\n"

        assert emu.split_oplog(raw) == (raw, None)

    def test_json_that_is_not_an_op_log_is_left_alone(self):
        raw = b'{"result": "the student printed some JSON"}\n'

        assert emu.split_oplog(raw) == (raw, None)

    def test_json_that_is_not_an_object_is_left_alone(self):
        raw = b"[1, 2, 3]\n"

        assert emu.split_oplog(raw) == (raw, None)

    def test_a_forged_op_log_cannot_displace_the_real_one(self):
        # emu writes after the child exits, so the real log is always last —
        # which is the whole reason only the last line is considered.
        forged = json.dumps({emu.OPLOG_KEY: [{"n": 1, "op": "NOTHING BAD"}]}).encode()

        stdout, oplog = emu.split_oplog(forged + b"\n" + _OPLOG_LINE + b"\n")

        assert oplog == _OPLOG
        assert stdout == forged + b"\n"


class TestIsOplogLine:
    def test_the_dump_is_recognised_with_or_without_its_newline(self):
        assert emu.is_oplog_line(_OPLOG_LINE)
        assert emu.is_oplog_line(_OPLOG_LINE + b"\n")

    def test_student_output_is_not(self):
        assert not emu.is_oplog_line(b"transfer 0 ok\n")
