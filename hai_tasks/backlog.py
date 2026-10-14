"""One repository's docs/ workflow directories, where the directory is the status."""

import hashlib
import os
import re
import stat
from pathlib import Path

from .markdown import EPOCH, TasksError, text_length, validate_patch, validate_workspace
from .store import TasksStore, export_snapshot, regular_file

STATES = {
    "issues": "backlog",
    "ideas": "backlog",
    "backlog": "todo",
    "in-progress": "in_progress",
    "completed": "done",
    "rejected": "canceled",
}
DOCUMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.md")
SKIPPED = {"README.md"}
FIELDS = {
    "title",
    "description",
    "status",
    "sourceState",
    "priority",
    "labels",
    "assigneeId",
    "projectId",
    "cycleId",
}


def backlog_root(path):
    """Return the docs directory of a backlog source path, or None for other paths."""
    path = Path(path)
    if path.name in STATES and path.parent.name == "docs":
        return path.parent
    if path.name == "docs" and (path / "backlog").is_dir():
        return path
    if not (path / "TASKS.md").exists() and (path / "docs/backlog").is_dir():
        return path / "docs"
    return None


class BacklogStore(TasksStore):
    def __init__(self, directory):
        self.capabilities = {
            "canCreate": True,
            "canUpdate": True,
            "canDelete": True,
            "canReorderBacklog": False,
            "canImport": False,
            "fields": {
                "description": True,
                "assignee": False,
                "project": False,
                "cycle": False,
                "priority": False,
                "labels": False,
            },
        }
        root = backlog_root(Path(os.path.abspath(Path(directory).expanduser())))
        if root is None:
            raise TasksError(
                "Use a repository's docs directory, one of its workflow directories "
                "such as docs/backlog, or a project with docs/backlog as the source.",
                422,
            )
        self.root = root
        self.revision_key = str(self.root)

    @staticmethod
    def parse_document(relative, content, duplicate=False):
        """Parse one document. A duplicate shares its file name with an earlier state."""
        state, name = relative.split("/")
        title = re.search(r"^# (.+?)\r?$", content, re.MULTILINE)
        body = content
        if title:
            end = title.end() + (1 if content[title.end() :].startswith("\n") else 0)
            body = content[: title.start()] + content[end:]
        identity = relative if duplicate else name
        issue = {
            "id": "backlog-" + hashlib.sha256(identity.encode()).hexdigest()[:24],
            "identifier": identity[:-3],
            "title": title[1] if title else name[:-3],
            "description": body.strip("\r\n"),
            "status": STATES[state],
            "sourceState": state,
            "sourcePath": relative,
            "priority": "none",
            "labels": [],
            "assigneeId": None,
            "projectId": None,
            "cycleId": None,
            "createdAt": EPOCH,
            "updatedAt": EPOCH,
            "accepted": False,
            "dependencies": [],
        }
        if text_length(issue["title"]) > 50000:
            raise TasksError(f"{relative}: title exceeds 50,000 characters.", 422)
        validate_patch({"title": issue["title"]})
        validate_workspace({"issues": [issue]})
        return issue

    @staticmethod
    def compose(title, description):
        return f"# {title}\n\n{description}".rstrip("\r\n") + "\n"

    @staticmethod
    def retitle(content, title):
        if re.search(r"^# .+?\r?$", content, re.MULTILINE):
            return re.sub(
                r"^# .+?\r?$",
                lambda m: "# " + title + ("\r" if m[0].endswith("\r") else ""),
                content,
                count=1,
                flags=re.MULTILINE,
            )
        newline = "\r\n" if "\r\n" in content else "\n"
        return "# " + title + newline + newline + content

    def _snapshot(self):
        self.check_root()
        documents, issues, owners = {}, [], {}
        digest = hashlib.sha256(self.revision_key.encode())
        for state in STATES:
            directory = self.root / state
            if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
                raise TasksError(
                    f"{directory} must be a directory without symbolic links.", 422
                )
            if not directory.exists():
                continue
            for path in sorted(directory.iterdir()):
                if path.name in SKIPPED or not DOCUMENT.fullmatch(path.name):
                    continue
                content = regular_file(path, 256 * 1024)
                relative = f"{state}/{path.name}"
                documents[relative] = content
                issues.append(
                    self.parse_document(relative, content, path.name in owners)
                )
                owners.setdefault(path.name, state)
                digest.update(("\0" + relative + "\0" + content).encode())
        workspace = {
            "issues": issues,
            "projects": [],
            "members": [],
            "cycles": [],
            "currentMemberId": None,
        }
        validate_workspace(workspace)
        return {
            "workspace": workspace,
            "documents": documents,
            "revision": digest.hexdigest(),
            "capabilities": dict(
                self.capabilities,
                workflow="backlog",
                sourceStates=[{"id": k, "status": v} for k, v in STATES.items()],
            ),
            "parsed": {"source": "\n\n".join(documents.values())},
        }

    def mutate(self, operation, revision, id=None, input=None):
        with self.locked():
            before = self._snapshot()
            if (
                not isinstance(revision, str)
                or revision.strip('"') != before["revision"]
            ):
                raise TasksError(
                    "Backlog documents changed. Reload before saving.", 412
                )
            if operation not in ["create", "update", "delete"]:
                raise TasksError("Backlog documents do not support this operation.", 422)
            patch = {} if input is None else input
            if not isinstance(patch, dict) or set(patch) - FIELDS:
                raise TasksError("Unsupported backlog document fields.", 422)
            validate_patch(
                {k: v for k, v in patch.items() if k not in ["sourceState", "status"]}
            )
            if patch.get("priority", "none") != "none" or patch.get("labels", []):
                raise TasksError(
                    "Backlog documents do not support priority or labels.", 422
                )
            issue = next(
                (i for i in before["workspace"]["issues"] if i["id"] == id), None
            )
            if operation != "create" and issue is None:
                raise TasksError("Issue not found.", 404)
            state = patch.get(
                "sourceState", issue["sourceState"] if issue else next(iter(STATES))
            )
            if (
                not isinstance(state, str)
                or state not in STATES
                or ("status" in patch and patch["status"] != STATES[state])
            ):
                raise TasksError(
                    "Choose a source state matching the issue status.", 422
                )
            if operation == "create":
                if len(before["workspace"]["issues"]) >= 10000:
                    raise TasksError("A workspace supports at most 10,000 issues.", 422)
                title = patch.get("title", "")
                if not title:
                    raise TasksError("A title is required.")
                slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:70]
                name = (slug or "document") + ".md"
                if any(Path(p).name == name for p in before["documents"]):
                    raise TasksError(
                        f"A document named {name} already exists. Choose another title.",
                        409,
                    )
                old_path, previous = None, None
                content = self.compose(title, patch.get("description", ""))
            else:
                assert issue is not None
                old_path = self.root / issue["sourcePath"]
                name = old_path.name
                previous = content = before["documents"][issue["sourcePath"]]
                if "description" in patch and patch["description"] != issue["description"]:
                    content = self.compose(
                        patch.get("title", issue["title"]), patch["description"]
                    )
                elif "title" in patch and patch["title"] != issue["title"]:
                    content = self.retitle(content, patch["title"])
            path = self.root / state / name
            relative = f"{state}/{name}"
            if old_path is not None and old_path != path and relative in before["documents"]:
                raise TasksError(
                    f"docs/{relative} already exists. Rename or remove it first.", 409
                )
            if operation != "delete":
                if len(content.encode()) > 256 * 1024:
                    raise TasksError("Document exceeds the 256 KB size limit.", 422)
                self.parse_document(relative, content)
            moved = old_path is not None and old_path != path
            mode = stat.S_IMODE(old_path.lstat().st_mode) if old_path else 0o600
            temporary = None
            steps = []
            try:
                if operation != "delete":
                    path.parent.mkdir(exist_ok=True)
                    temporary = self.stage(path, content, mode)
                if self._snapshot()["revision"] != before["revision"]:
                    raise TasksError("Backlog documents changed during save.", 412)
                if operation == "delete":
                    old_path.unlink()
                    steps.append(("removed", old_path))
                elif moved or old_path is None:
                    try:
                        os.link(temporary, path)
                    except FileExistsError:
                        raise TasksError(
                            f"{path} already exists. Reload and review the documents.",
                            409,
                        ) from None
                    steps.append(("new", path))
                    if moved:
                        old_path.unlink()
                        steps.append(("removed", old_path))
                else:
                    os.replace(temporary, path)
                    steps.append(("replaced", path))
                after = self._snapshot()
            except Exception:
                for kind, target in steps:
                    if kind == "removed":
                        intact = not os.path.lexists(target)
                    else:
                        try:
                            intact = regular_file(target) == content
                        except TasksError:
                            intact = False
                    if not intact:
                        raise TasksError(
                            "Save was partially applied and the document changed again. "
                            "Reload and review the files.",
                            409,
                        ) from None
                for kind, target in reversed(steps):
                    if kind == "new":
                        target.unlink()
                    else:
                        restore = self.stage(target, previous, mode)
                        try:
                            if kind == "removed":
                                os.link(restore, target)
                            else:
                                os.replace(restore, target)
                        finally:
                            Path(restore).unlink(missing_ok=True)
                raise
            finally:
                if temporary:
                    Path(temporary).unlink(missing_ok=True)
            result = {
                "workspace": after["workspace"],
                "revision": after["revision"],
                "capabilities": after["capabilities"],
            }
            if operation != "delete":
                result["issue"] = next(
                    i for i in after["workspace"]["issues"] if i["sourcePath"] == relative
                )
            return result

    def export(self, format="tasks"):
        return export_snapshot(self.read(), format)
