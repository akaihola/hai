"""Repository-wide Matt Pocock tickets, grouped by feature directories."""

import hashlib
import os
import re
import stat
from pathlib import Path

from .workflow import select_state, status_for_stage
from .markdown import EPOCH, TasksError, text_length, validate_patch, validate_workspace
from .store import TasksStore, export_snapshot, regular_file

STATES = {
    "needs-triage": "triage",
    "needs-info": "triage",
    "ready-for-agent": "ready",
    "ready-for-human": "waiting",
    "wontfix": "dropped",
    "open": "ready",
    "claimed": "active",
    "resolved": "done",
}
TICKET = re.compile(r"(\d+)-[A-Za-z0-9][A-Za-z0-9._-]*\.md")


class ScratchStore(TasksStore):
    def __init__(self, directory):
        self.capabilities = {
            "canCreate": True,
            "canUpdate": True,
            "canDelete": True,
            "canReorderBacklog": False,
            "canImport": False,
            "projectAssignment": "required-on-create",
            "canCreateProject": False,
            "canUpdateProject": False,
            "canDeleteProject": False,
            "fields": {
                "description": True,
                "assignee": False,
                "project": True,
                "cycle": False,
                "priority": False,
                "labels": False,
                "acceptance": False,
                "dependencies": True,
            },
        }
        path = Path(os.path.abspath(Path(directory).expanduser()))
        if path.name == "issues" and path.parent.parent.name == ".scratch":
            path = path.parent
        if not path.is_dir() or path.is_symlink():
            raise TasksError("Local issue sources must be directories without symbolic links.", 422)
        self.root = path.parent if path.parent.name == ".scratch" else path
        if self.root.name != ".scratch":
            raise TasksError("Use .scratch, a feature, or its issues directory as the local issue source.", 422)
        self.revision_key = str(self.root)

    @staticmethod
    def project_id(feature):
        return "feature-" + hashlib.sha256(feature.encode()).hexdigest()[:24]

    def states(self):
        labels = {role: role for role in STATES}
        mapping = self.root.parent / "docs/agents/triage-labels.md"
        content = ""
        if mapping.exists() or mapping.is_symlink():
            if mapping.parent.resolve() != mapping.parent:
                raise TasksError(
                    "Triage mapping directories must not contain symbolic links.", 422
                )
            content = regular_file(mapping, 256 * 1024)
            for role, label in re.findall(
                r"^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|", content, re.MULTILINE
            ):
                if role in {"needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"}:
                    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,99}", label):
                        raise TasksError("Invalid local triage label.", 422)
                    labels[role] = label
        if len(set(labels.values())) != len(labels):
            raise TasksError("Conflicting local triage labels.", 422)
        states = {labels[role]: status for role, status in STATES.items()}
        return states, content

    @staticmethod
    def parse_ticket(path, content, states):
        feature = path.parent.parent.name
        title = re.search(r"^# (.+?)\r?$", content, re.MULTILINE)
        header = re.split(r"^## ", content, maxsplit=1, flags=re.MULTILINE)[0]
        statuses = list(
            re.finditer(r"^Status:[ \t]*([^\r\n]*)(\r?\n|$)", header, re.MULTILINE)
        )
        if not title or len(statuses) > 1:
            raise TasksError(
                f"{path}: expected one # title and at most one Status: line.", 422
            )
        state = (
            statuses[0][1].strip()
            if statuses
            else next(s for s, value in states.items() if value == "triage")
        )
        if state not in states:
            raise TasksError(
                f"{path}: unsupported Status: {state}. Use a triage role or open/claimed/resolved.",
                422,
            )
        body = content
        spans = [
            (
                title.start(),
                title.end() + (1 if content[title.end() :].startswith("\n") else 0),
            )
        ]
        if statuses:
            spans.append((statuses[0].start(), statuses[0].end()))
        for start, end in sorted(spans, reverse=True):
            body = body[:start] + body[end:]
        issue = {
            "id": "scratch-" + hashlib.sha256((feature + "/" + path.name).encode()).hexdigest()[:24],
            "identifier": feature + "/" + TICKET.fullmatch(path.name)[1],
            "feature": feature,
            "title": title[1],
            "description": body.strip("\r\n"),
            "status": status_for_stage(states[state]),
            "sourceState": state,
            "sourcePath": feature + "/issues/" + path.name,
            "priority": "none",
            "labels": [],
            "assigneeId": None,
            "projectId": None,
            "cycleId": None,
            "createdAt": EPOCH,
            "updatedAt": EPOCH,
            "accepted": False,
            "dependencies": re.findall(
                r"\d+",
                (
                    re.search(r"^Blocked by:([^\r\n]*)", content, re.MULTILINE)
                    or ["", ""]
                )[1],
            ),
        }
        if text_length(issue["title"]) > 50000:
            raise TasksError(f"{path}: title exceeds 50,000 characters.", 422)
        validate_patch({"title": issue["title"]})
        validate_workspace({"issues": [issue]})
        issue["projectId"] = ScratchStore.project_id(feature)
        return issue

    def _snapshot(self):
        self.check_root()
        states, mapping = self.states()
        documents, issues, projects = {}, [], []
        digest = hashlib.sha256((self.revision_key + "\0" + mapping).encode())
        for feature in sorted(self.root.iterdir()):
            if feature.is_symlink():
                raise TasksError("Feature directories must not contain symbolic links.", 422)
            if not feature.is_dir():
                continue
            digest.update(("\0feature:" + feature.name).encode())
            projects.append(dict(id=self.project_id(feature.name), name=feature.name,
                                 description="", color="#6e86d9", status="planned"))
            directory = feature / "issues"
            if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
                raise TasksError("The issues path must be a directory without symbolic links.", 422)
            numbers = set()
            for path in sorted(directory.iterdir()) if directory.exists() else []:
                match = TICKET.fullmatch(path.name)
                if not match:
                    continue
                number = int(match[1])
                if number in numbers:
                    raise TasksError(f"{feature.name}: duplicate ticket number {number}.", 422)
                numbers.add(number)
                content = regular_file(path, 256 * 1024)
                issue = self.parse_ticket(path, content, states)
                documents[issue["sourcePath"]] = content
                issues.append(issue)
                digest.update(("\0" + issue["sourcePath"] + "\0" + content).encode())
        issues.sort(key=lambda issue: (issue["feature"], int(issue["identifier"].split("/")[-1])))
        workspace = {
            "issues": issues,
            "projects": projects,
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
                workflow="scratch",
                sourceStates=[{"id": k, "stage": v} for k, v in states.items()],
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
                    "Local issues or triage labels changed. Reload before saving.", 412
                )
            if operation not in ["create", "update", "delete"]:
                raise TasksError("Local issues do not support this operation.", 422)
            patch = {} if input is None else input
            if not isinstance(patch, dict) or set(patch) - {
                "title",
                "description",
                "status",
                "sourceState",
                "priority",
                "labels",
                "assigneeId",
                "projectId",
                "cycleId",
            }:
                raise TasksError("Unsupported local issue fields.", 422)
            validate_patch(
                {k: v for k, v in patch.items() if k not in ["sourceState", "status", "projectId"]}
            )
            if patch.get("priority", "none") != "none" or patch.get("labels", []):
                raise TasksError(
                    "Local issues do not support priority or arbitrary labels.", 422
                )
            issue = next(
                (i for i in before["workspace"]["issues"] if i["id"] == id), None
            )
            if operation != "create" and issue is None:
                raise TasksError("Issue not found.", 404)
            states = {
                s["id"]: s["stage"] for s in before["capabilities"]["sourceStates"]
            }
            state = select_state(states, patch, issue["sourceState"] if issue else None)
            project_id = patch.get("projectId", issue["projectId"] if issue else None)
            project = next((p for p in before["workspace"]["projects"] if p["id"] == project_id), None)
            if project is None:
                raise TasksError("Choose a feature when creating a ticket.", 422)
            if issue and project_id != issue["projectId"]:
                raise TasksError("Tickets cannot move between features.", 422)
            directory = self.root / project["name"] / "issues"
            if operation == "create":
                if len(before["workspace"]["issues"]) >= 10000:
                    raise TasksError("A workspace supports at most 10,000 issues.", 422)
                title = patch.get("title", "")
                if not title:
                    raise TasksError("A title is required.")
                number = (
                    max((int(Path(p).name.split("-")[0]) for p in before["documents"] if Path(p).parts[0] == project["name"]), default=0)
                    + 1
                )
                slug = (
                    re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:70] or "issue"
                )
                path = directory / f"{number:02d}-{slug}.md"
                content = f"# {title}\n\nStatus: {state}\n\n" + patch.get(
                    "description", ""
                )
            else:
                assert issue is not None
                path = self.root / issue["sourcePath"]
                content = before["documents"][issue["sourcePath"]]
                if operation == "delete":
                    number = str(int(path.name.split("-")[0]))
                    if any(
                        number in {str(int(d)) for d in i["dependencies"]}
                        for i in before["workspace"]["issues"]
                        if i != issue and i["projectId"] == issue["projectId"]
                    ):
                        raise TasksError(
                            "Other tickets are blocked by this issue.", 409
                        )
                if (
                    "description" in patch
                    and patch["description"] != issue["description"]
                ):
                    content = (
                        f"# {patch.get('title', issue['title'])}\n\nStatus: {state}\n\n"
                        + patch["description"]
                    )
                else:
                    if "title" in patch:
                        content = re.sub(
                            r"^# .+?\r?$",
                            lambda m: (
                                "# "
                                + patch["title"]
                                + ("\r" if m[0].endswith("\r") else "")
                            ),
                            content,
                            count=1,
                            flags=re.MULTILINE,
                        )
                    if "sourceState" in patch or "status" in patch:
                        header = re.split(
                            r"^## ", content, maxsplit=1, flags=re.MULTILINE
                        )[0]
                        if re.search(r"^Status:", header, re.MULTILINE):
                            content = re.sub(
                                r"^(Status:[ \t]*)[^\r\n]*",
                                lambda m: m[1] + state,
                                content,
                                count=1,
                                flags=re.MULTILINE,
                            )
                        else:
                            newline = "\r\n" if "\r\n" in content else "\n"
                            content = re.sub(
                                r"^(# [^\r\n]*)(\r?\n|$)",
                                lambda m: m[1] + newline + "Status: " + state + newline,
                                content,
                                count=1,
                                flags=re.MULTILINE,
                            )
            if operation != "delete" and (
                len(content.encode()) > 256 * 1024
                or re.search(
                    r"^Status:",
                    re.split(
                        r"^## ",
                        patch.get("description", ""),
                        maxsplit=1,
                        flags=re.MULTILINE,
                    )[0],
                    re.MULTILINE,
                )
            ):
                raise TasksError(
                    "Ticket exceeds the size limit or its description contains a second Status: line.",
                    422,
                )
            if operation != "delete":
                self.parse_ticket(path, content, states)
            temporary = None
            published = False
            relative = str(path.relative_to(self.root))
            previous = before["documents"].get(relative)
            mode = (
                stat.S_IMODE(path.lstat().st_mode) if operation != "create" else 0o600
            )
            try:
                if operation != "delete":
                    directory.mkdir(exist_ok=True)
                    temporary = self.stage(path, content, mode)
                if self._snapshot()["revision"] != before["revision"]:
                    raise TasksError("Local issues changed during save.", 412)
                if operation == "delete":
                    path.unlink()
                elif operation == "create":
                    assert temporary is not None
                    os.link(temporary, path)
                else:
                    assert temporary is not None
                    os.replace(temporary, path)
                published = True
                after = self._snapshot()
            except Exception:
                if published:
                    if operation == "delete":
                        unchanged = not path.exists() and not path.is_symlink()
                    else:
                        try:
                            unchanged = regular_file(path) == content
                        except TasksError:
                            unchanged = False
                    if not unchanged:
                        raise TasksError(
                            "Save was partially applied and the ticket changed again. Reload and review the files.",
                            409,
                        ) from None
                    if previous is None:
                        path.unlink()
                    else:
                        restore = self.stage(path, previous, mode)
                        try:
                            if operation == "delete":
                                os.link(restore, path)
                            else:
                                os.replace(restore, path)
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
                    i
                    for i in after["workspace"]["issues"]
                    if i["sourcePath"] == relative
                )
            return result

    def export(self, format="tasks"):
        return export_snapshot(self.read(), format)
