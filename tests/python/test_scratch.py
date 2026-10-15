import json
import subprocess
import sys
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
from hai_tasks.scratch import ScratchStore


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
        self.project_id = ScratchStore.project_id("feature")

    def test_roundtrip_preserves_body_comments_specs_and_identity(self):
        before = self.store.read()
        issue = before["workspace"]["issues"][0]
        result = self.store.mutate(
            "update",
            before["revision"],
            issue["id"],
            {"sourceState": "ready-for-human", "status": "backlog", "title": "Renamed"},
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
                "projectId": self.project_id,
                "sourceState": "wontfix",
                "status": "canceled",
                "description": "## Details\n\nBody",
            },
        )
        self.assertEqual(result["issue"]["sourcePath"], "feature/issues/02-second-ticket.md")
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
        store = open_source(empty / "issues")
        before = store.read()
        self.assertEqual([p["name"] for p in before["workspace"]["projects"]], ["empty", "feature"])
        result = store.mutate("create", before["revision"], input={"title": "First", "projectId": ScratchStore.project_id("empty")})
        self.assertEqual(result["issue"]["sourceState"], "needs-triage")
        self.file.write_text("# Missing status\n\n## Body\nStatus: example\n")
        before = self.store.read()
        result = self.store.mutate(
            "update",
            before["revision"],
            next(i for i in before["workspace"]["issues"] if i["feature"] == "feature")["id"],
            {"sourceState": "needs-info"},
        )
        self.assertIn("Status: needs-info\n", self.file.read_text())
        self.assertIn("Status: example\n", self.file.read_text())

    def test_mapping_wayfinder_and_stale_revisions(self):
        mapping = self.project / "docs/agents/triage-labels.md"
        mapping.parent.mkdir(parents=True)
        mapping.write_text("| `needs-triage` | `evaluate` | Triage |\n")
        before = self.store.read()
        self.assertEqual(before["capabilities"]["sourceStates"][0], {"id": "evaluate", "stage": "triage"})
        result = self.store.mutate(
            "create",
            before["revision"],
            input={
                "title": "Research",
                "projectId": self.project_id,
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
                self.store.mutate("create", revision, input={"title": f"Ticket {n}", "projectId": self.project_id})
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
                self.store.mutate(operation, before["revision"], issue["id"], {"title": "Changed", "projectId": self.project_id} if operation != "delete" else {})
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

    def test_repository_projects_identity_numbering_and_feature_scoped_dependencies(self):
        other = self.feature.parent / "other"
        (other / "issues").mkdir(parents=True)
        (other / "issues/01-first.md").write_text("# Other first\nStatus: open\n")
        (other / "issues/02-blocked.md").write_text("# Blocked\nStatus: open\nBlocked by: 01\n")
        (self.feature.parent / "spec-only").mkdir()
        store = open_source(self.feature.parent)
        before = store.read()
        self.assertEqual(len(before["workspace"]["projects"]), 3)
        tickets = before["workspace"]["issues"]
        self.assertEqual([i["identifier"] for i in tickets], ["feature/01", "other/01", "other/02"])
        self.assertEqual(len({i["id"] for i in tickets}), 3)
        self.assertEqual(self.store.read()["revision"], before["revision"])
        with self.assertRaises(TasksError):
            store.mutate("create", before["revision"], input={"title": "Missing feature"})
        with self.assertRaises(TasksError):
            store.mutate("update", before["revision"], tickets[0]["id"], {"projectId": ScratchStore.project_id("other")})
        result = store.mutate("create", before["revision"], input={"title": "Second", "projectId": self.project_id})
        self.assertEqual(result["issue"]["identifier"], "feature/02")
        store.mutate("delete", result["revision"], tickets[0]["id"])
        before = store.read()
        with self.assertRaises(TasksError) as error:
            store.mutate("delete", before["revision"], tickets[1]["id"])
        self.assertEqual(error.exception.status, 409)
        rows = query([self.feature.parent])
        self.assertEqual({row["issue"]["feature"] for row in rows}, {"feature", "other"})
        (other / "issues/01-first.md").write_text("# External change\nStatus: open\n")
        with self.assertRaises(TasksError) as error:
            self.store.mutate("create", before["revision"], input={"title": "Third", "projectId": self.project_id})
        self.assertEqual(error.exception.status, 412)
        before = store.read()
        result = store.mutate("create", before["revision"], input={"title": "Spec ticket", "projectId": ScratchStore.project_id("spec-only")})
        self.assertEqual(result["issue"]["identifier"], "spec-only/01")

    def test_cli_repository_read_and_query_include_features(self):
        for command in ["read", "query"]:
            result = subprocess.run([sys.executable, "-m", "hai_tasks", command, str(self.feature.parent)], check=True, capture_output=True, text=True)
            value = json.loads(result.stdout)
            issues = value["workspace"]["issues"] if command == "read" else [row["issue"] for row in value]
            self.assertEqual(issues[0]["feature"], "feature")
            self.assertEqual(issues[0]["identifier"], "feature/01")

    def test_duplicate_numbers_and_feature_symlinks_are_rejected(self):
        (self.directory / "01-duplicate.md").write_text("# Duplicate\nStatus: open\n")
        with self.assertRaises(TasksError):
            self.store.read()
        (self.directory / "01-duplicate.md").unlink()
        (self.feature.parent / "linked").symlink_to(self.feature, target_is_directory=True)
        with self.assertRaises(TasksError):
            self.store.read()

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
            str(self.feature.parent), [s["path"] for s in get("/projects")["sources"]]
        )
        before = get("/workspace" + suffix)
        self.assertEqual(before["capabilities"]["workflow"], "scratch")
        self.assertEqual(before["source"]["path"], str(self.feature.parent))
        self.assertEqual(before["source"]["projectId"], self.project_id)
        root_snapshot = get("/workspace?source=" + quote(str(self.feature.parent)))
        self.assertEqual(root_snapshot["revision"], before["revision"])
        self.assertEqual(get("/workspace?source=" + quote(str(self.directory)))["source"]["projectId"], self.project_id)
        self.assertEqual(len(get("/projects" + suffix)["sources"]), 2)
        empty = self.feature.parent / "empty"
        empty.mkdir()
        empty_snapshot = get("/workspace?source=" + quote(str(empty / "issues")))
        self.assertEqual(empty_snapshot["source"]["projectId"], ScratchStore.project_id("empty"))
        before = get("/workspace" + suffix)
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

        current = get("/workspace?source=" + quote(str(self.feature.parent)))
        create_url = base + "/issues?source=" + quote(str(self.feature.parent))
        def create_ticket(payload):
            return Request(create_url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "If-Match": current["revision"]}, method="POST")
        with self.assertRaises(HTTPError) as error:
            urlopen(create_ticket({"title": "Missing feature"}))
        self.assertEqual(error.exception.code, 422)
        error.exception.close()
        with urlopen(create_ticket({"title": "Empty first", "projectId": ScratchStore.project_id("empty")})) as response:
            created = json.load(response)
        self.assertEqual(created["issue"]["identifier"], "empty/01")
        self.assertTrue((empty / "issues/01-empty-first.md").exists())
        move = Request(base + "/issues/" + created["issue"]["id"] + suffix, data=json.dumps({"projectId": self.project_id}).encode(), headers={"Content-Type": "application/json", "If-Match": created["revision"]}, method="PATCH")
        with self.assertRaises(HTTPError) as error:
            urlopen(move)
        self.assertEqual(error.exception.code, 422)
        error.exception.close()
