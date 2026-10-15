import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from hai_server.http import create_server
from hai_tasks import BacklogStore, TasksError, open_source, query, report
from hai_tasks.cli import main


class BacklogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "nixos-config"
        self.docs = self.project / "docs"
        for state in ["ideas", "backlog", "in-progress", "completed", "rejected"]:
            (self.docs / state).mkdir(parents=True)
            (self.docs / state / "README.md").write_text(f"# {state}\n")
            (self.docs / state / ".gitkeep").write_text("")
        (self.docs / "README.md").write_text("# Documentation\n")
        (self.docs / "contributing").mkdir()
        (self.docs / "contributing/guide.md").write_text("# Guide\n")
        self.file = self.docs / "backlog/install-fonts.md"
        self.content = "# Install fonts\r\n\r\n## Context\r\n\r\nKeep **formatting**.\r\n\r\n## Acceptance Criteria\r\n\r\n- [ ] Fonts installed\r\n\r\n**Status:** Backlog (ready to start)\r\n"
        self.file.write_bytes(self.content.encode())
        (self.docs / "completed/add-user.md").write_text("**Completed:** 2026-02-05\n\n# Add user\n\nDone.\n")
        self.store = open_source(self.project)

    def test_reads_directories_as_states_and_opens_from_any_path(self):
        before = self.store.read()
        self.assertEqual(before["capabilities"]["workflow"], "backlog")
        self.assertEqual([s["id"] for s in before["capabilities"]["sourceStates"]], ["issues", "ideas", "backlog", "in-progress", "completed", "rejected"])
        issues = {i["identifier"]: i for i in before["workspace"]["issues"]}
        self.assertEqual(set(issues), {"install-fonts", "add-user"})
        fonts, user = issues["install-fonts"], issues["add-user"]
        self.assertEqual((fonts["title"], fonts["status"], fonts["sourceState"], fonts["sourcePath"]), ("Install fonts", "todo", "backlog", "backlog/install-fonts.md"))
        self.assertTrue(fonts["description"].startswith("## Context"))
        self.assertIn("**Status:** Backlog", fonts["description"])
        self.assertEqual((user["title"], user["status"], user["sourceState"]), ("Add user", "done", "completed"))
        self.assertEqual(user["description"], "**Completed:** 2026-02-05\n\n\nDone.")
        for source in [self.docs, self.docs / "backlog", self.docs / "completed", self.project]:
            snapshot = open_source(source).read()
            self.assertEqual(snapshot["revision"], before["revision"], source)
            self.assertIsInstance(open_source(source), BacklogStore)
        (self.project / "TASKS.md").write_text("# Tasks\n\n## Unverified proposals\n\n## Ordered backlog\n\n## Scheduled\n\n## In Progress\n\n## Completed / Accepted\n\n## Rules\n")
        self.assertNotIsInstance(open_source(self.project), BacklogStore)
        self.assertIsInstance(open_source(self.docs), BacklogStore)
        with self.assertRaises(TasksError):
            BacklogStore(self.docs / "contributing")

    def test_moves_retitles_and_rewrites_without_touching_other_files(self):
        before = self.store.read()
        issue = next(i for i in before["workspace"]["issues"] if i["identifier"] == "install-fonts")
        result = self.store.mutate("update", before["revision"], issue["id"], {"sourceState": "in-progress", "status": "in_progress", "title": "Install UI fonts"})
        self.assertFalse(self.file.exists())
        moved = self.docs / "in-progress/install-fonts.md"
        self.assertEqual(moved.read_bytes().decode(), self.content.replace("# Install fonts", "# Install UI fonts"))
        self.assertEqual(result["issue"]["id"], issue["id"])
        self.assertEqual(result["issue"]["sourcePath"], "in-progress/install-fonts.md")
        self.assertEqual(result["issue"]["status"], "in_progress")
        self.assertEqual((self.docs / "backlog/README.md").read_text(), "# backlog\n")
        self.assertEqual((self.docs / "backlog/.gitkeep").read_text(), "")
        result = self.store.mutate("update", result["revision"], issue["id"], {"description": "## Status\n\nStarted.\n"})
        self.assertEqual(moved.read_text(), "# Install UI fonts\n\n## Status\n\nStarted.\n")
        self.assertEqual(result["issue"]["description"], "## Status\n\nStarted.")
        user = next(i for i in result["workspace"]["issues"] if i["identifier"] == "add-user")
        result = self.store.mutate("update", result["revision"], user["id"], {"title": "Add agent user"})
        self.assertEqual((self.docs / "completed/add-user.md").read_text(), "**Completed:** 2026-02-05\n\n# Add agent user\n\nDone.\n")
        (self.docs / "ideas/untitled.md").write_text("Just prose.\n")
        before = self.store.read()
        untitled = next(i for i in before["workspace"]["issues"] if i["identifier"] == "untitled")
        self.assertEqual(untitled["title"], "untitled")
        self.store.mutate("update", before["revision"], untitled["id"], {"title": "Titled now"})
        self.assertEqual((self.docs / "ideas/untitled.md").read_text(), "# Titled now\n\nJust prose.\n")

    def test_create_query_report_export_delete_and_missing_directories(self):
        before = self.store.read()
        result = self.store.mutate("create", before["revision"], input={"title": "Filed problem", "description": "It breaks."})
        self.assertEqual(result["issue"]["sourcePath"], "issues/filed-problem.md")
        self.assertEqual((self.docs / "issues/filed-problem.md").read_text(), "# Filed problem\n\nIt breaks.\n")
        result = self.store.mutate("create", result["revision"], input={"title": "Rough idea", "sourceState": "ideas", "status": "backlog"})
        self.assertEqual((self.docs / "ideas/rough-idea.md").read_text(), "# Rough idea\n")
        self.assertEqual(len(query([self.project], status="backlog")), 2)
        self.assertEqual([r["issue"]["identifier"] for r in query([self.docs], state="issues")], ["filed-problem"])
        self.assertEqual(report([self.docs / "backlog"])["byState"], {"issues": 1, "ideas": 1, "backlog": 1, "completed": 1})
        self.assertEqual(len(json.loads(self.store.export("json"))["workspace"]["issues"]), 4)
        self.assertIn("# Rough idea", self.store.export())
        with self.assertRaises(TasksError) as error:
            self.store.mutate("create", result["revision"], input={"title": "Install fonts", "sourceState": "ideas"})
        self.assertEqual(error.exception.status, 409)
        result = self.store.mutate("delete", result["revision"], result["issue"]["id"])
        self.assertFalse((self.docs / "ideas/rough-idea.md").exists())
        self.assertEqual(len(result["workspace"]["issues"]), 3)

    def test_duplicate_names_and_blocked_moves(self):
        (self.docs / "rejected/add-user.md").write_text("# Add user again\n")
        before = self.store.read()
        identifiers = sorted(i["identifier"] for i in before["workspace"]["issues"])
        self.assertEqual(identifiers, ["add-user", "install-fonts", "rejected/add-user"])
        user = next(i for i in before["workspace"]["issues"] if i["identifier"] == "add-user")
        with self.assertRaises(TasksError) as error:
            self.store.mutate("update", before["revision"], user["id"], {"sourceState": "rejected"})
        self.assertEqual(error.exception.status, 409)
        self.assertTrue((self.docs / "completed/add-user.md").exists())

    def test_stale_revisions_external_changes_and_concurrent_writers(self):
        before = self.store.read()
        issue = before["workspace"]["issues"][0]
        self.file.write_bytes((self.content + "External note\r\n").encode())
        with self.assertRaises(TasksError) as error:
            self.store.mutate("update", before["revision"], issue["id"], {"sourceState": "completed"})
        self.assertEqual(error.exception.status, 412)
        self.assertTrue(self.file.exists())
        revision = self.store.read()["revision"]

        def create(n):
            try:
                self.store.mutate("create", revision, input={"title": f"Document {n}"})
                return 200
            except TasksError as error:
                return error.status

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(create, [1, 2])), [200, 412])

    def test_invalid_fields_documents_and_operations_never_write(self):
        before = self.store.read()
        issue = next(i for i in before["workspace"]["issues"] if i["identifier"] == "install-fonts")
        for patch in [
            {"accepted": True},
            {"priority": "high"},
            {"labels": ["custom"]},
            {"sourceState": []},
            {"sourceState": "scheduled"},
            {"sourceState": "completed", "status": "todo"},
            {"status": "in_review"},
            {"description": "a" * 50001},
            {"title": ""},
        ]:
            with self.subTest(patch=list(patch)), self.assertRaises(TasksError):
                self.store.mutate("update", before["revision"], issue["id"], patch)
            self.assertEqual(self.file.read_bytes().decode(), self.content)
        with self.assertRaises(TasksError):
            self.store.mutate("reorder", before["revision"], input={"issueIds": [issue["id"]]})
        with self.assertRaises(TasksError) as error:
            self.store.mutate("update", before["revision"], "backlog-missing", {"title": "x"})
        self.assertEqual(error.exception.status, 404)

    def test_symlinks_are_rejected(self):
        linked = self.docs / "ideas/linked.md"
        linked.symlink_to(self.file)
        with self.assertRaises(TasksError):
            self.store.read()
        linked.unlink()
        (self.docs / "ideas").rename(self.docs / "actual-ideas")
        (self.docs / "ideas").symlink_to(self.docs / "actual-ideas", target_is_directory=True)
        with self.assertRaises(TasksError):
            self.store.read()

    def test_failed_post_save_read_restores_only_our_write(self):
        before = self.store.read()
        issue = next(i for i in before["workspace"]["issues"] if i["identifier"] == "install-fonts")
        snapshot = self.store._snapshot
        for operation, patch_input in [("create", {"title": "New document"}), ("update", {"title": "Changed"}), ("update", {"sourceState": "completed", "title": "Moved"}), ("delete", {})]:
            calls = 0

            def fail_after_write():
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise TasksError("Injected post-save read failure", 422)
                return snapshot()

            with self.subTest(operation=operation, patch=patch_input), patch.object(self.store, "_snapshot", side_effect=fail_after_write), self.assertRaises(TasksError):
                self.store.mutate(operation, before["revision"], issue["id"], patch_input)
            self.assertEqual(self.file.read_bytes().decode(), self.content)
            self.assertEqual(sorted(p.name for p in (self.docs / "backlog").iterdir()), [".gitkeep", "README.md", "install-fonts.md"])
            self.assertEqual(sorted(p.name for p in (self.docs / "completed").iterdir()), [".gitkeep", "README.md", "add-user.md"])
            self.assertFalse((self.docs / "issues").exists() and any((self.docs / "issues").iterdir()))

    def test_rollback_preserves_a_document_changed_after_our_write(self):
        before = self.store.read()
        issue = next(i for i in before["workspace"]["issues"] if i["identifier"] == "install-fonts")
        snapshot = self.store._snapshot
        calls = 0

        def fail_after_external_change():
            nonlocal calls
            calls += 1
            if calls == 3:
                (self.docs / "completed/install-fonts.md").write_text("# External writer\n")
                raise TasksError("Injected read failure", 422)
            return snapshot()

        with patch.object(self.store, "_snapshot", side_effect=fail_after_external_change), self.assertRaises(TasksError) as error:
            self.store.mutate("update", before["revision"], issue["id"], {"sourceState": "completed"})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual((self.docs / "completed/install-fonts.md").read_text(), "# External writer\n")
        self.assertFalse(self.file.exists())

    def test_cli_state_filter_and_moves(self):
        import io
        from contextlib import redirect_stdout

        def run(*arguments):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(main(list(arguments)), 0)
            return json.loads(output.getvalue())

        rows = run("query", str(self.project), "--state", "backlog")
        self.assertEqual([r["issue"]["identifier"] for r in rows], ["install-fonts"])
        self.assertEqual(rows[0]["source"], str(self.project))
        result = run("update", str(self.docs), rows[0]["issue"]["id"], "--revision", rows[0]["revision"], "--json", '{"sourceState":"in-progress","status":"in_progress"}')
        self.assertEqual(result["issue"]["sourceState"], "in-progress")
        self.assertEqual(run("report", str(self.docs))["byState"], {"in-progress": 1, "completed": 1})

    def test_http_discovery_reads_and_revision_checked_writes(self):
        from test_tasks import SOURCE

        other = Path(self.temp.name) / "hai"
        (other / "docs/tasks").mkdir(parents=True)
        (other / "TASKS.md").write_text(SOURCE)
        (other / "docs/tasks/1-first.md").write_text("# Description\n")
        server = create_server(other / "TASKS.md", other, port=0, project_roots=[self.temp.name])
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}/api"

        def get(path):
            with urlopen(base + path) as response:
                return json.load(response)

        sources = {s["path"]: s["name"] for s in get("/projects")["sources"]}
        self.assertEqual(sources.get(str(self.docs)), "nixos-config / docs")
        self.assertEqual(sources.get(str(other / "TASKS.md")), "hai")
        for selected in [self.project, self.docs, self.docs / "backlog"]:
            before = get("/workspace?source=" + quote(str(selected)))
            self.assertEqual(before["capabilities"]["workflow"], "backlog")
            self.assertEqual(before["source"], {"name": "nixos-config / docs", "path": str(self.docs)})
        suffix = "?source=" + quote(str(self.docs))
        issue = next(i for i in before["workspace"]["issues"] if i["identifier"] == "install-fonts")
        request = Request(base + "/issues/" + issue["id"] + suffix, data=b'{"sourceState":"completed","status":"done"}', headers={"Content-Type": "application/json", "If-Match": before["revision"]}, method="PATCH")
        with urlopen(request) as response:
            result = json.load(response)
        self.assertEqual(result["issue"]["sourcePath"], "completed/install-fonts.md")
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 412)
        error.exception.close()
        with self.assertRaises(HTTPError) as error:
            urlopen(base + "/workspace?source=" + quote(str(self.docs / "contributing")))
        self.assertEqual(error.exception.code, 404)
        error.exception.close()


if __name__ == "__main__":
    unittest.main()
