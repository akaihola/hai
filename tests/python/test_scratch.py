import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from hai_server.http import create_server
from hai_tasks import TasksError, open_source, query, report


class ScratchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "project"
        self.feature = self.project / ".scratch/feature"
        self.directory = self.feature / "issues"
        self.directory.mkdir(parents=True)
        self.file = self.directory / "01-first.md"
        self.content = "# First ticket\r\n\r\nStatus: ready-for-agent\r\nType: task\r\n\r\n## Requirements\r\n\r\nKeep **formatting**.\r\n\r\n## Comments\r\n\r\nStatus: quoted example\r\nA conversation.\r\n"
        self.file.write_bytes(self.content.encode())
        (self.feature / "spec.md").write_text("# Spec\n")
        (self.feature / "map.md").write_text("# Map\n")
        self.store = open_source(self.feature)

    def test_roundtrip_preserves_body_comments_specs_and_identity(self):
        before = self.store.read()
        issue = before["workspace"]["issues"][0]
        result = self.store.mutate(
            "update",
            before["revision"],
            issue["id"],
            {"sourceState": "ready-for-human", "status": "todo", "title": "Renamed"},
        )
        self.assertEqual(
            self.file.read_bytes().decode(),
            self.content.replace("# First ticket", "# Renamed").replace(
                "Status: ready-for-agent", "Status: ready-for-human"
            ),
        )
        self.assertEqual(result["issue"]["id"], issue["id"])
        self.assertIn("Type: task", result["issue"]["description"])
        self.assertIn("Status: quoted example", result["issue"]["description"])
        self.assertEqual((self.feature / "spec.md").read_text(), "# Spec\n")
        self.assertEqual((self.feature / "map.md").read_text(), "# Map\n")
        self.assertEqual(
            open_source(self.directory).read()["revision"], result["revision"]
        )

    def test_create_edit_export_query_delete(self):
        result = self.store.mutate(
            "create",
            self.store.read()["revision"],
            input={
                "title": "Second ticket",
                "sourceState": "wontfix",
                "status": "canceled",
                "description": "## Details\n\nBody",
            },
        )
        self.assertEqual(result["issue"]["sourcePath"], "issues/02-second-ticket.md")
        result = self.store.mutate(
            "update",
            result["revision"],
            result["issue"]["id"],
            {"description": "## Details\n\nChanged"},
        )
        self.assertEqual(result["issue"]["description"], "## Details\n\nChanged")
        self.assertEqual(len(query([self.feature], status="canceled")), 1)
        self.assertEqual(report([self.feature])["bySection"]["wontfix"], 1)
        self.assertEqual(
            len(json.loads(self.store.export("json"))["workspace"]["issues"]), 2
        )
        self.assertIn("# Second ticket", self.store.export())
        self.store.mutate("delete", result["revision"], result["issue"]["id"])
        self.assertFalse((self.directory / "02-second-ticket.md").exists())

    def test_empty_feature_and_missing_status(self):
        empty = self.project / ".scratch/empty"
        empty.mkdir()
        (empty / "spec.md").write_text("# Only a spec\n")
        store = open_source(empty)
        before = store.read()
        self.assertEqual(before["workspace"]["issues"], [])
        result = store.mutate("create", before["revision"], input={"title": "First"})
        self.assertEqual(result["issue"]["sourceState"], "needs-triage")
        self.file.write_text("# Missing status\n\n## Body\nStatus: example\n")
        before = self.store.read()
        result = self.store.mutate(
            "update",
            before["revision"],
            before["workspace"]["issues"][0]["id"],
            {"sourceState": "needs-info"},
        )
        self.assertIn("Status: needs-info\n", self.file.read_text())
        self.assertIn("Status: example\n", self.file.read_text())

    def test_mapping_wayfinder_and_stale_revisions(self):
        mapping = self.project / "docs/agents/triage-labels.md"
        mapping.parent.mkdir(parents=True)
        mapping.write_text("| `needs-triage` | `evaluate` | Triage |\n")
        before = self.store.read()
        self.assertEqual(before["capabilities"]["sourceStates"][0]["id"], "evaluate")
        result = self.store.mutate(
            "create",
            before["revision"],
            input={
                "title": "Research",
                "sourceState": "claimed",
                "status": "in_progress",
                "description": "Type: research\n\n## Answer\n",
            },
        )
        self.assertEqual(result["issue"]["status"], "in_progress")
        resolved = self.store.mutate("update", result["revision"], result["issue"]["id"], {"sourceState": "resolved"})
        self.assertEqual(report([self.feature])["awaitingAcceptance"], 0)
        result = resolved
        with self.assertRaises(TasksError) as error:
            self.store.mutate(
                "update",
                before["revision"],
                result["issue"]["id"],
                {"sourceState": "resolved"},
            )
        self.assertEqual(error.exception.status, 412)
        mapping.write_text(mapping.read_text() + "\nMapping changed.\n")
        with self.assertRaises(TasksError) as error:
            self.store.mutate(
                "update",
                result["revision"],
                result["issue"]["id"],
                {"sourceState": "resolved"},
            )
        self.assertEqual(error.exception.status, 412)

    def test_external_changes_and_concurrent_writers(self):
        before = self.store.read()
        self.file.write_bytes((self.content + "External comment\r\n").encode())
        with self.assertRaises(TasksError) as error:
            self.store.mutate(
                "delete", before["revision"], before["workspace"]["issues"][0]["id"]
            )
        self.assertEqual(error.exception.status, 412)
        revision = self.store.read()["revision"]

        def create(n):
            try:
                self.store.mutate("create", revision, input={"title": f"Ticket {n}"})
                return 200
            except TasksError as error:
                return error.status

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(create, [1, 2])), [200, 412])

    def test_invalid_fields_and_documents_never_write(self):
        before = self.store.read()
        issue = before["workspace"]["issues"][0]
        for patch in [
            {"accepted": True},
            {"priority": "high"},
            {"labels": ["custom"]},
            {"sourceState": []},
            {"sourceState": "unknown"},
            {"sourceState": "wontfix", "status": "done"},
            {"description": "a" * 50001},
            {"description": "Status: unknown"},
        ]:
            with self.subTest(patch=list(patch)), self.assertRaises(TasksError):
                self.store.mutate("update", before["revision"], issue["id"], patch)
            self.assertEqual(self.file.read_bytes().decode(), self.content)
        with self.assertRaises(TasksError):
            self.store.mutate(
                "reorder", before["revision"], input={"issueIds": [issue["id"]]}
            )

    def test_symlinks_and_blocked_delete(self):
        linked = self.directory / "02-linked.md"
        linked.symlink_to(self.file)
        with self.assertRaises(TasksError):
            self.store.read()
        linked.unlink()
        linked.write_text("# Blocked\nStatus: open\nBlocked by: 01\n")
        before = self.store.read()
        with self.assertRaises(TasksError) as error:
            self.store.mutate(
                "delete", before["revision"], before["workspace"]["issues"][0]["id"]
            )
        self.assertEqual(error.exception.status, 409)
        linked.unlink()
        self.directory.rename(self.feature / "actual")
        self.directory.symlink_to(self.feature / "actual", target_is_directory=True)
        with self.assertRaises(TasksError):
            self.store.read()

    def test_failed_post_save_read_restores_only_our_write(self):
        before = self.store.read()
        issue = before["workspace"]["issues"][0]
        snapshot = self.store._snapshot
        for operation in ["create", "update", "delete"]:
            calls = 0
            def fail_after_write():
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise TasksError("Injected post-save read failure", 422)
                return snapshot()
            with self.subTest(operation=operation), patch.object(self.store, "_snapshot", side_effect=fail_after_write), self.assertRaises(TasksError):
                self.store.mutate(operation, before["revision"], issue["id"], {"title": "Changed"} if operation != "delete" else {})
            self.assertEqual(self.file.read_bytes().decode(), self.content)
            self.assertEqual(sorted(p.name for p in self.directory.iterdir()), ["01-first.md"])

    def test_rollback_preserves_a_ticket_changed_after_our_write(self):
        before = self.store.read()
        snapshot = self.store._snapshot
        calls = 0
        def fail_after_external_change():
            nonlocal calls
            calls += 1
            if calls == 3:
                self.file.write_text("# External writer\nStatus: needs-info\n")
                raise TasksError("Injected read failure", 422)
            return snapshot()
        with patch.object(self.store, "_snapshot", side_effect=fail_after_external_change), self.assertRaises(TasksError) as error:
            self.store.mutate("update", before["revision"], before["workspace"]["issues"][0]["id"], {"title": "Changed"})
        self.assertEqual(error.exception.status, 409)
        self.assertIn("# External writer", self.file.read_text())

    def test_http_discovery_reads_and_revision_checked_writes(self):
        from test_tasks import SOURCE

        (self.project / "TASKS.md").write_text(SOURCE)
        (self.project / "docs/tasks").mkdir(parents=True)
        (self.project / "docs/tasks/1-first.md").write_text("# Description\n")
        server = create_server(self.project / "TASKS.md", self.project, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}/api"
        from urllib.parse import quote

        suffix = "?source=" + quote(str(self.feature))

        def get(path):
            with urlopen(base + path) as response:
                return json.load(response)

        self.assertIn(
            str(self.feature), [s["path"] for s in get("/projects")["sources"]]
        )
        before = get("/workspace" + suffix)
        self.assertEqual(before["capabilities"]["workflow"], "scratch")
        issue = before["workspace"]["issues"][0]
        request = Request(
            base + "/issues/" + issue["id"] + suffix,
            data=b'{"sourceState":"resolved","status":"done"}',
            headers={
                "Content-Type": "application/json",
                "If-Match": before["revision"],
            },
            method="PATCH",
        )
        with urlopen(request) as response:
            result = json.load(response)
        self.assertEqual(result["issue"]["sourceState"], "resolved")
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 412)
        error.exception.close()
