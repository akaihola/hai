"""Local tracker storage with revisions, advisory locking and atomic file replacement."""
import errno
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .markdown import TasksError, mutate_tasks, parse_tasks, validate_workspace, with_frontmatter_dependencies, workspace_of


def regular_file(path, maximum=2 * 1024 * 1024):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise TasksError(f'Tracker source must be a regular file: {path}', 422)
            if info.st_size > maximum:
                raise TasksError(f'Tracker source exceeds the {maximum}-byte size limit: {path}', 422)
            with os.fdopen(fd, 'rb', closefd=False) as handle:
                content = handle.read(maximum + 1)
        finally:
            os.close(fd)
        if len(content) > maximum:
            raise TasksError(f'Tracker source exceeds the {maximum}-byte size limit: {path}', 422)
        return content.decode('utf-8')
    except (OSError, UnicodeError) as error:
        if isinstance(error, OSError) and error.errno == errno.ELOOP:
            raise TasksError(f'Tracker source must be a regular file, not a symbolic link: {path}', 422) from error
        raise TasksError(f'Cannot read tracker source {path}: {error}', 422) from error


def run_git(root, *args, timeout=30):
    try:
        return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True, timeout=timeout, env={**os.environ, 'SHELL': '/bin/bash', 'GIT_TERMINAL_PROMPT': '0'})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise TasksError(f'Git operation failed: {error}', 503) from error


class TasksStore:
    capabilities = dict(canCreate=True, canUpdate=True, canDelete=True, canReorderBacklog=True, canImport=False,
                        fields=dict(description=True, assignee=False, project=False, cycle=False))

    def __init__(self, tasks_file, *, revision_key=None):
        self.tasks_file = Path(os.path.abspath(Path(tasks_file).expanduser()))
        self.root = self.tasks_file.parent
        self.revision_key = revision_key or str(self.tasks_file)

    def check_root(self):
        try:
            if self.root.resolve(strict=True) != self.root:
                raise OSError(f'Project directory resolves to {self.root.resolve()}; symbolic links are not allowed.')
        except OSError as error:
            raise TasksError(f'Project directory changed or cannot be opened at {self.root}: {error}. Reopen the project.', 422) from error

    @contextmanager
    def locked(self):
        self.check_root()
        # Lock the directory inode, not TASKS.md, which is replaced during saves.
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            self.check_root()
            yield
        finally:
            os.close(fd)

    def document_path(self, path, create=False):
        if not re.fullmatch(r'docs/tasks/[A-Za-z0-9][A-Za-z0-9._-]*\.md', path) or '..' in path:
            raise TasksError('Description paths must name Markdown files directly inside docs/tasks.', 422)
        absolute = self.root / path
        directory = self.root
        for part in Path(path).parent.parts:
            directory /= part
            if create:
                directory.mkdir(exist_ok=True)
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode):
                reason = 'is a symbolic link' if stat.S_ISLNK(info.st_mode) else 'is not a directory'
                raise TasksError(f'Description directory {directory} {reason}. Use a directory without symbolic links.', 422)
        return absolute

    def _snapshot(self):
        self.check_root()
        source = regular_file(self.tasks_file)
        parsed = parse_tasks(source)
        documents = {}
        for task in parsed['tasks']:
            path = task['issue'].get('sourcePath')
            if path:
                if path not in documents:
                    try:
                        documents[path] = regular_file(self.document_path(path), 256 * 1024)
                    except (TasksError, OSError) as error:
                        raise TasksError(f'Cannot open description {self.root / path} referenced by {task["issue"]["sourceReference"]} in {self.tasks_file}: {error}', 422) from error
                task['issue']['description'] = documents[path]
        workspace = workspace_of(parsed)
        validate_workspace(workspace)
        digest = hashlib.sha256((self.revision_key + '\0' + source).encode())
        for path, content in sorted(documents.items()):
            digest.update(('\0' + path + '\0' + content).encode())
        return dict(parsed=parsed, workspace=workspace, documents=documents, revision=digest.hexdigest())

    def read(self):
        with self.locked():
            return self._snapshot()

    def allocate(self, parsed, title):
        reserved = re.search(r'<!-- hai:reserved-numbers:([\d,]*) -->', parsed['source'])
        used = {int(n) for n in parsed['references']}
        if reserved:
            used.update(int(n) for n in reserved[1].split(',') if n)
        filenames = []
        try:
            directory = self.document_path('docs/tasks/placeholder.md').parent
            filenames = [p.name for p in directory.iterdir()]
        except FileNotFoundError:
            pass
        try:
            history = run_git(self.root, 'log', '--all', '--format=', '--name-only', '--', 'docs/tasks', timeout=5)
            filenames += [Path(p).name for p in history.stdout.splitlines()]
        except subprocess.CalledProcessError as error:
            # A missing repository is supported; other Git failures are not.
            if error.returncode != 128 or 'not a git repository' not in error.stderr:
                raise TasksError('Cannot verify historical description numbers.', 503) from error
        for name in filenames:
            match = re.match(r'^(\d+)(?:-|\.)', name)
            if match:
                used.add(int(match[1]))
        number = 1
        while number in used:
            number += 1
        slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:70] or 'task'
        return dict(number=number, path=f'docs/tasks/{number}-{slug}.md')

    def mutate(self, operation, revision, id=None, input=None):
        with self.locked():
            before = self._snapshot()
            if not isinstance(revision, str) or revision.strip('"') != before['revision']:
                raise TasksError('TASKS.md or a description changed. Reload before saving.', 412)
            if input is None and operation == 'delete':
                input = {}
            if not isinstance(input, dict):
                raise TasksError('Expected an issue object.')
            patch = dict(input)
            current = next((issue for issue in before['workspace']['issues'] if issue['id'] == id), {})
            if operation == 'update' and 'description' in patch and patch['description'] == current.get('description'):
                del patch['description']
            allocation = None
            if operation != 'reorder' and isinstance(patch.get('description'), str) and patch['description'] and not current.get('sourcePath'):
                allocation = self.allocate(before['parsed'], str(patch.get('title', current.get('title', 'task'))))
            result = mutate_tasks(before['parsed']['source'], operation, id, patch, allocation)
            if 'dependencies' in result:
                # Keep the description file's `depends-on:` frontmatter consistent with the bullet.
                path = result.get('descriptionWrite', {}).get('path') or current.get('sourcePath')
                if path:
                    content = result['descriptionWrite']['content'] if 'descriptionWrite' in result else before['documents'][path]
                    updated = with_frontmatter_dependencies(content, result['dependencies'])
                    if updated != content:
                        result['descriptionWrite'] = dict(path=path, content=updated)
            if allocation or (operation == 'delete' and current.get('sourcePath')):
                pattern = r'<!-- hai:reserved-numbers:([\d,]*) -->'
                previous = re.search(pattern, result['source'])
                reserved = {int(n) for n in before['parsed']['references']}
                if previous:
                    reserved.update(int(n) for n in previous[1].split(',') if n)
                if allocation:
                    reserved.add(allocation['number'])
                metadata = '<!-- hai:reserved-numbers:' + ','.join(map(str, sorted(reserved))) + ' -->'
                result['source'] = re.sub(pattern, lambda _: metadata, result['source']) if previous else re.sub(r'^## Rules', lambda _: metadata + before['parsed']['newline'] * 2 + '## Rules', result['source'], flags=re.M)
            candidate = parse_tasks(result['source'])
            description = result.get('descriptionWrite', {})
            for task in candidate['tasks']:
                path = task['issue'].get('sourcePath')
                if path:
                    task['issue']['description'] = description['content'] if path == description.get('path') else before['documents'][path]
            validate_workspace(workspace_of(candidate))
            changes = []
            if description:
                changes.append(dict(path=self.document_path(description['path'], True), content=description['content'], previous=before['documents'].get(description['path'])))
            if result['source'] != before['parsed']['source']:
                changes.append(dict(path=self.tasks_file, content=result['source'], previous=before['parsed']['source']))
            deleted_path = current.get('sourcePath') if operation == 'delete' else None
            if deleted_path and deleted_path not in candidate['references'].values():
                changes.append(dict(path=self.document_path(deleted_path), content=None, previous=before['documents'][deleted_path]))
            temps, committed = [], []
            try:
                for change in changes:
                    mode = 0o600
                    try:
                        info = change['path'].lstat()
                        if not stat.S_ISREG(info.st_mode):
                            raise TasksError('Refusing to replace a nonregular source file.', 422)
                        if change['previous'] is None:
                            raise TasksError('The new description path already exists.', 409)
                        mode = stat.S_IMODE(info.st_mode)
                    except FileNotFoundError:
                        pass
                    change['mode'] = mode
                    temps.append(self.stage(change['path'], change['content'], mode) if change['content'] is not None else None)
                if self._snapshot()['revision'] != before['revision']:
                    raise TasksError('Tracker changed during save. Reload before saving.', 412)
                for temporary, change in zip(temps, changes):
                    if change['content'] is None:
                        change['path'].unlink()
                    elif change['previous'] is None:
                        # Publish new files without overwriting an external creation.
                        os.link(temporary, change['path'])
                        os.unlink(temporary)
                    else:
                        os.replace(temporary, change['path'])
                    committed.append(change)
                after = self._snapshot()
                output = dict(workspace=after['workspace'], revision=after['revision'])
                if result.get('id') and operation != 'delete':
                    output['issue'] = next(i for i in after['workspace']['issues'] if i['id'] == result['id'])
                return output
            except Exception:
                for change in committed:
                    try:
                        unchanged = not os.path.lexists(change['path']) if change['content'] is None else regular_file(change['path']) == change['content']
                    except TasksError:
                        unchanged = False
                    if not unchanged:
                        raise TasksError('Save was partially applied and a source changed again. Current files were preserved. Reload and review the tracker before retrying.', 409) from None
                for change in reversed(committed):
                    if change['previous'] is None:
                        change['path'].unlink()
                    else:
                        temporary = self.stage(change['path'], change['previous'], change['mode'])
                        if change['content'] is None:
                            temps.append(temporary)
                            os.link(temporary, change['path'])
                        else:
                            os.replace(temporary, change['path'])
                raise
            finally:
                for path in temps:
                    if path is not None:
                        Path(path).unlink(missing_ok=True)

    @staticmethod
    def stage(path, content, mode):
        fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.hai-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as handle:
                os.fchmod(handle.fileno(), mode)
                handle.write(content.encode())
                handle.flush()
                os.fsync(handle.fileno())
        except Exception:
            os.unlink(temporary)
            raise
        return temporary

    def export(self, format='tasks'):
        return export_snapshot(self.read(), format)


def export_snapshot(snapshot, format):
    if format == 'tasks':
        return snapshot['parsed']['source']
    if format != 'json':
        raise TasksError('Choose tasks or json export format.')
    numbers = [int(m[1]) for issue in snapshot['workspace']['issues'] if (m := re.fullmatch(r'HAI-(\d+)', issue['identifier']))]
    content = json.dumps(dict(version=1, nextIssueNumber=max(numbers, default=0) + 1, workspace=snapshot['workspace']), indent=2, ensure_ascii=False) + '\n'
    if len(content.encode()) > 2 * 1024 * 1024:
        raise TasksError('This backup is too large. The limit is 2 MB.')
    return content
