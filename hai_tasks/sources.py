"""Project sources. SSH uses the installed CLI; GitHub uses authenticated Git."""
import json
import os
import re
import shlex
import subprocess
import tempfile
from collections import Counter
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlsplit

from .markdown import SECTIONS, TasksError
from .store import TasksStore, export_snapshot, run_git
from .scratch import ScratchStore


class SSHSource:
    capabilities = TasksStore.capabilities

    def __init__(self, uri):
        url = urlsplit(uri)
        if url.password or url.query or url.fragment or not url.hostname or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', url.hostname) or (url.username and not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', url.username)):
            raise TasksError('Use ssh://[user@]host[:port]/absolute/project/TASKS.md.')
        self.host = f'{url.username}@{url.hostname}' if url.username else url.hostname
        try:
            self.port = url.port
        except ValueError as error:
            raise TasksError('Invalid SSH port.') from error
        self.path = unquote(url.path)
        if not self.path.startswith('/') or any(ord(c) < 32 for c in self.path):
            raise TasksError('SSH trackers need an absolute remote path.')
        self.uri = uri

    def call(self, command, **arguments):
        payload = dict(command=command, source=self.path, **arguments)
        argv = ['ssh', '-oBatchMode=yes', '-oConnectTimeout=10']
        if self.port:
            argv += ['-p', str(self.port)]
        argv += ['--', self.host, shlex.join(['env', 'SHELL=/bin/bash', 'python3', '-m', 'hai_tasks', 'rpc'])]
        try:
            result = subprocess.run(argv, input=json.dumps(payload), capture_output=True, text=True, timeout=60, env={**os.environ, 'SHELL': '/bin/bash'})
        except (OSError, subprocess.TimeoutExpired) as error:
            raise TasksError(f'SSH source {self.host} is unavailable: {error}', 503) from error
        try:
            response = json.loads(result.stdout)
        except ValueError:
            raise TasksError(f'SSH source {self.host} failed. Check authentication and install hai-tasks for remote python3. {result.stderr.strip()[:500]}', 503) from None
        if not isinstance(response, dict):
            raise TasksError('SSH returned an invalid response.', 502)
        if 'error' in response:
            raise TasksError(response['error'], response.get('status', 502))
        if result.returncode or 'result' not in response:
            raise TasksError('SSH tracker command failed.', 502)
        return response['result']

    def read(self):
        return self.call('read')

    def mutate(self, operation, revision, id=None, input=None):
        return self.call('mutate', operation=operation, revision=revision, id=id, input=input)

    def export(self, format='tasks'):
        return self.call('export', format=format)


class GitHubSource:
    capabilities = TasksStore.capabilities

    def __init__(self, uri):
        url = urlsplit(uri)
        parts = url.path.strip('/').split('/')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*', url.netloc) or not parts or not re.fullmatch(r'[A-Za-z0-9_.-]+', parts[0]) or parts[0] in ['.', '..'] or len(parts) != 1 or url.fragment:
            raise TasksError('Use github://owner/repository?ref=branch&path=TASKS.md.')
        query = parse_qs(url.query, keep_blank_values=True)
        if set(query) - {'ref', 'path'} or any(len(v) != 1 or not v[0] for v in query.values()):
            raise TasksError('GitHub sources accept one ref and one path.')
        self.branch = query.get('ref', [None])[0]
        self.path = query.get('path', ['TASKS.md'])[0]
        if self.branch and (self.branch.startswith('-') or re.search(r'[\x00-\x20~^:?*\[\\]', self.branch) or '..' in self.branch or '@{' in self.branch):
            raise TasksError('Invalid GitHub branch.')
        if PurePosixPath(self.path).is_absolute() or '..' in self.path.split('/') or '\\' in self.path or not self.path.endswith('.md') or any(ord(c) < 32 for c in self.path):
            raise TasksError('GitHub tracker path must stay inside the repository.')
        self.remote_url = f'https://github.com/{url.netloc}/{parts[0]}.git'
        self.uri = uri

    @contextmanager
    def checkout(self):
        # honey: clone per operation; add a cache if large repositories make this too slow.
        with tempfile.TemporaryDirectory(prefix='hai-github-') as directory:
            root = Path(directory) / 'repository'
            args = ['clone', '--quiet', '--no-local']
            if self.branch:
                args += ['--branch', self.branch]
            try:
                run_git(directory, *args, '--', self.remote_url, str(root), timeout=120)
                branch = run_git(root, 'symbolic-ref', '--short', 'HEAD').stdout.strip()
                head = run_git(root, 'rev-parse', 'HEAD').stdout.strip()
                path = root / self.path
                if not path.resolve().is_relative_to(root):
                    raise TasksError('GitHub tracker links must stay inside the repository.', 422)
                store = TasksStore(path, revision_key=self.uri + '\0' + head)
                yield root, branch, store
            except subprocess.CalledProcessError as error:
                # URLs never contain credentials; authentication stays in Git's credential helper.
                raise TasksError(f'GitHub Git operation failed. Check repository access, branch permissions and Git credentials. {error.stderr.strip()[:500]}', 503) from error

    def read(self):
        with self.checkout() as (_, _, store):
            return store.read()

    def export(self, format='tasks'):
        return export_snapshot(self.read(), format)

    def mutate(self, operation, revision, id=None, input=None):
        with self.checkout() as (root, branch, store):
            deleted_description = None
            if operation == 'delete':
                deleted_description = next((i.get('sourcePath') for i in store.read()['workspace']['issues'] if i['id'] == id), None)
            result = store.mutate(operation, revision, id, input)
            paths = [self.path]
            description = result.get('issue', {}).get('sourcePath') or deleted_description
            if description:
                paths.append(str(store.root.relative_to(root) / description))
            run_git(root, 'add', '--force', '--', *paths)
            if not run_git(root, 'diff', '--cached', '--name-only').stdout.strip():
                return result
            run_git(root, '-c', 'user.name=Hai', '-c', 'user.email=hai@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', f'{operation} TASKS.md issue')
            try:
                run_git(root, 'push', '--porcelain', 'origin', f'HEAD:refs/heads/{branch}', timeout=120)
            except subprocess.CalledProcessError as error:
                if '[rejected]' in error.stdout or 'fetch first' in error.stderr or 'non-fast-forward' in error.stderr:
                    raise TasksError('GitHub branch changed. Reload before saving.', 412) from error
                raise TasksError(f'GitHub rejected the write. Check branch protection and write access. {error.stderr.strip()[:500]}', 403) from error
            head = run_git(root, 'rev-parse', 'HEAD').stdout.strip()
            store.revision_key = self.uri + '\0' + head
            after = store.read()
            result.update(workspace=after['workspace'], revision=after['revision'])
            return result


def open_source(source):
    """Open a path, ssh:// URI, or github:// URI without changing the source."""
    source = str(source)
    if source.startswith('ssh://'):
        return SSHSource(source)
    if source.startswith('github://'):
        return GitHubSource(source)
    if '://' in source:
        raise TasksError('Unsupported source scheme. Use a local path, ssh:// or github://.')
    path = Path(source).expanduser().absolute()
    if path.is_dir():
        if path.parent.name == '.scratch' or (path.name == 'issues' and path.parent.parent.name == '.scratch'):
            return ScratchStore(path)
        path /= 'TASKS.md'
    return TasksStore(path)


def query(sources, *, text='', section=None, status=None, accepted=None, priority=None, label=None):
    """Return project-tagged issues and revisions; a failed project fails the query."""
    if section is not None and section not in SECTIONS:
        raise TasksError('Unsupported source section.')
    result = []
    for source in sources:
        snapshot = open_source(source).read()
        for issue in snapshot['workspace']['issues']:
            if text.casefold() not in (issue['title'] + '\n' + issue['description']).casefold():
                continue
            if any(value is not None and issue.get(key) != value for key, value in [('sourceSection', section), ('status', status), ('accepted', accepted), ('priority', priority)]):
                continue
            if label is not None and label not in issue['labels']:
                continue
            result.append(dict(source=str(source), revision=snapshot['revision'], issue=issue))
    return result


def report(sources, **filters):
    """Count query results by source, workflow section and acceptance."""
    rows = query(sources, **filters)
    return dict(total=len(rows), accepted=sum(row['issue']['accepted'] for row in rows), awaitingAcceptance=sum(row['issue'].get('sourceSection') == 'Completed / Accepted' and not row['issue']['accepted'] for row in rows), bySource=dict(Counter(row['source'] for row in rows)), bySection=dict(Counter(row['issue'].get('sourceState', row['issue'].get('sourceSection')) for row in rows)))
