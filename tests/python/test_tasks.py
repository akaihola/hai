import json
import os
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

from hai_tasks import TasksError, TasksStore, mutate_tasks, open_source, parse_tasks, query, report
from hai_tasks.sources import GitHubSource, SSHSource
from hai_tasks.store import run_git
from hai_server.http import create_server

SOURCE = '''# Tasks

## Unverified proposals

## Ordered backlog

- [1] First task
  <!-- hai:{"id":"first","labels":["test"],"custom":"preserve"} -->

## Scheduled

## In Progress

## Completed / Accepted

- [ ] [*] Awaiting acceptance
- [x] [*] Accepted task

[1]: docs/tasks/1-first.md

## Rules

Only the user accepts tasks.
'''
ROOT = Path(__file__).resolve().parents[2]


class TrackerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.make_project('project')
        self.store = TasksStore(self.project / 'TASKS.md')

    def make_project(self, name):
        project = self.root / name
        (project / 'docs/tasks').mkdir(parents=True)
        (project / 'TASKS.md').write_text(SOURCE)
        (project / 'docs/tasks/1-first.md').write_text('# Description\n')
        return project

    def cli(self, *args, input=None):
        return subprocess.run([sys.executable, '-m', 'hai_tasks', *map(str, args)], cwd=ROOT, input=input, capture_output=True, text=True)

    def test_cli_revision_roundtrip_and_conflict(self):
        loaded = self.cli('read', self.project)
        self.assertEqual(loaded.returncode, 0, loaded.stderr)
        revision = json.loads(loaded.stdout)['revision']
        saved = self.cli('update', self.project, 'first', '--revision', revision, '--json', '-', input='{"title":"Saved by CLI"}')
        self.assertEqual(saved.returncode, 0, saved.stderr)
        stale = self.cli('delete', self.project, 'first', '--revision', revision)
        self.assertEqual(stale.returncode, 1)
        self.assertEqual(json.loads(stale.stderr)['status'], 412)
        self.assertIn('Saved by CLI', self.store.export())
        missing = self.cli('delete', self.project, 'first')
        self.assertEqual(missing.returncode, 2)

    def test_parse_export_query_and_report_multiple_projects(self):
        second = self.make_project('second')
        rows = query([self.project, second], label='test', text='description')
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['revision'], rows[1]['revision'])
        self.assertEqual(report([self.project, second])['awaitingAcceptance'], 2)
        self.assertEqual(report([self.project, second], accepted=True)['total'], 2)
        parsed = self.cli('parse', '-', input=SOURCE)
        self.assertEqual(len(json.loads(parsed.stdout)['tasks']), 3)
        self.assertEqual(self.cli('export', self.project).stdout, SOURCE)
        summary = self.cli('report', self.project, second, '--no-accepted')
        self.assertEqual(json.loads(summary.stdout)['total'], 4)
        self.assertEqual(self.cli('query', self.project, self.root / 'missing').returncode, 1)

    def test_cli_create_reorder_delete_and_description(self):
        before = self.store.read()
        result = self.cli('create', self.project, '--revision', before['revision'], '--json', json.dumps(dict(title='New', description='Body', sourceSection='Ordered backlog')))
        self.assertEqual(result.returncode, 0, result.stderr)
        created = json.loads(result.stdout)
        issue = created['issue']
        self.assertEqual((self.project / issue['sourcePath']).read_text(), 'Body')
        order = self.cli('reorder', self.project, '--revision', created['revision'], '--json', json.dumps({'issueIds': ['first', issue['id']]}))
        ordered = json.loads(order.stdout)
        deleted = self.cli('delete', self.project, issue['id'], '--revision', ordered['revision'])
        self.assertEqual(deleted.returncode, 0, deleted.stderr)
        self.assertTrue((self.project / issue['sourcePath']).exists())

    def test_separate_processes_cannot_overwrite_each_other(self):
        revision = self.store.read()['revision']
        def save(title):
            result = self.cli('update', self.project, 'first', '--revision', revision, '--json', json.dumps({'title': title}))
            return result.returncode, json.loads(result.stdout or result.stderr)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(save, ['One', 'Two']))
        self.assertEqual(sorted(code for code, _ in results), [0, 1])
        self.assertEqual(next(value['status'] for code, value in results if code), 412)

    def test_invalid_metadata_and_unicode_limits(self):
        for metadata in [{'priority': []}, {'labels': [None]}, {'createdAt': '2026-02-31'}, {'id': 3}]:
            source = SOURCE.replace('{"id":"first","labels":["test"],"custom":"preserve"}', json.dumps(metadata))
            (self.project / 'TASKS.md').write_text(source)
            with self.assertRaises(TasksError):
                self.store.read()
        with self.assertRaises(TasksError):
            mutate_tasks(SOURCE, 'update', 'first', {'title': '😀' * 25001})

    def test_crlf_and_unknown_metadata_survive(self):
        source = SOURCE.replace('\n', '\r\n')
        (self.project / 'TASKS.md').write_bytes(source.encode())
        loaded = self.store.read()
        self.store.mutate('update', loaded['revision'], 'first', {'priority': 'urgent'})
        content = (self.project / 'TASKS.md').read_bytes()
        self.assertIn(b'"custom":"preserve"', content)
        self.assertNotIn(b'\n', content.replace(b'\r\n', b''))
        self.assertIn(b'- [x] [*] Accepted task', content)

    def test_historical_numbers_not_reused(self):
        run_git(self.project, 'init', '--quiet')
        run_git(self.project, 'add', '.')
        run_git(self.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Initial')
        old = self.project / 'docs/tasks/2-retired.md'
        old.write_text('Retired')
        run_git(self.project, 'add', '.')
        run_git(self.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Retired number')
        old.unlink()
        result = self.store.mutate('create', self.store.read()['revision'], input={'title': 'New', 'description': 'Body'})
        self.assertEqual(result['issue']['sourceReference'], '[3]')

    def test_failed_second_file_commit_rolls_back_first(self):
        before = self.store.read()
        real_replace = os.replace
        def replace(src, dst):
            if Path(dst).name == 'TASKS.md':
                raise OSError('injected write failure')
            return real_replace(src, dst)
        with patch('hai_tasks.store.os.replace', side_effect=replace):
            with self.assertRaises(OSError):
                self.store.mutate('update', before['revision'], 'first', {'description': 'Changed', 'title': 'Changed'})
        self.assertEqual(self.store.read()['revision'], before['revision'])
        self.assertEqual(list(self.project.rglob('*.hai-*')), [])

    def test_failed_save_preserves_newer_human_edit_during_rollback(self):
        before = self.store.read()
        real_replace = os.replace
        document = self.project / 'docs/tasks/1-first.md'
        replacement = 'Human edit while saving\n'
        def replace(src, dst):
            if Path(dst).name == 'TASKS.md':
                raise OSError('injected tracker replacement failure')
            real_replace(src, dst)
            document.write_text(replacement)
        with patch('hai_tasks.store.os.replace', side_effect=replace):
            with self.assertRaises(TasksError) as error:
                self.store.mutate('update', before['revision'], 'first', {'description': 'App edit', 'title': 'App title'})
        self.assertEqual(error.exception.status, 409)
        self.assertIn('partially applied', str(error.exception))
        self.assertEqual(document.read_text(), replacement)
        self.assertEqual((self.project / 'TASKS.md').read_text(), SOURCE)

    def test_pending_operations_reject_replaced_project_directory(self):
        before = self.store.read()
        outside = self.make_project('outside')
        ready = threading.Barrier(4)
        release = threading.Event()
        operations = [self.store.read, self.store.export, lambda: self.store.mutate('update', before['revision'], 'first', {'title': 'Unsafe', 'description': 'Unsafe'})]
        def operate(operation):
            ready.wait()
            release.wait()
            with self.assertRaisesRegex(TasksError, 'Project directory changed'):
                operation()
        with ThreadPoolExecutor(3) as pool:
            futures = [pool.submit(operate, operation) for operation in operations]
            ready.wait()
            self.project.rename(self.root / 'old-project')
            self.project.symlink_to(outside, target_is_directory=True)
            release.set()
            for future in futures:
                future.result()
        self.assertEqual((outside / 'TASKS.md').read_text(), SOURCE)
        self.assertEqual((outside / 'docs/tasks/1-first.md').read_text(), '# Description\n')

    def test_external_change_during_save_is_preserved(self):
        before = self.store.read()
        stage = self.store.stage
        def external_change(*args):
            temporary = stage(*args)
            (self.project / 'docs/tasks/1-first.md').write_text('External edit')
            return temporary
        with patch.object(self.store, 'stage', side_effect=external_change):
            with self.assertRaises(TasksError) as error:
                self.store.mutate('update', before['revision'], 'first', {'title': 'Changed'})
        self.assertEqual(error.exception.status, 412)
        self.assertEqual((self.project / 'docs/tasks/1-first.md').read_text(), 'External edit')
        self.assertEqual((self.project / 'TASKS.md').read_text(), SOURCE)

    def test_nonregular_sources_and_unsafe_description_paths(self):
        description = self.project / 'docs/tasks/1-first.md'
        description.unlink()
        os.mkfifo(description)
        with self.assertRaises(TasksError):
            self.store.read()
        description.unlink()
        description.write_text('Original')
        for path in ['../secret.md', 'docs/tasks/../secret.md', '/tmp/secret.md']:
            (self.project / 'TASKS.md').write_text(SOURCE.replace('docs/tasks/1-first.md', path))
            with self.assertRaises(TasksError):
                self.store.read()

    def test_ssh_runs_remote_cli_with_json_stdin(self):
        source = SSHSource(f'ssh://user@example.test:2222{self.project}/TASKS.md')
        real_run = subprocess.run
        calls = []
        def remote(argv, **kwargs):
            calls.append(argv)
            return real_run([sys.executable, '-m', 'hai_tasks', 'rpc'], cwd=ROOT, **kwargs)
        with patch('hai_tasks.sources.subprocess.run', side_effect=remote):
            initial = source.read()
            result = source.mutate('update', initial['revision'], 'first', {'title': 'SSH saved'})
            self.assertEqual(result['issue']['title'], 'SSH saved')
            self.assertIn('SSH saved', source.export())
            with self.assertRaises(TasksError) as conflict:
                source.mutate('delete', initial['revision'], 'first')
            self.assertEqual(conflict.exception.status, 412)
        self.assertEqual(calls[0][-2], 'user@example.test')
        self.assertIn('2222', calls[0])
        self.assertNotIn(str(self.project), calls[0][-1])

    def test_ssh_errors_and_source_validation(self):
        for uri in ['ssh://-option/tmp/TASKS.md', 'ssh://user:password@host/tmp/TASKS.md', 'ssh://host:wrong/tmp/TASKS.md', 'ssh://host/path?command=bad', 'github://owner/repo?path=../TASKS.md', 'github://owner/repo?ref=-option', 'https://example.test/tasks']:
            with self.subTest(uri=uri), self.assertRaises(TasksError):
                open_source(uri)
        with patch('hai_tasks.sources.subprocess.run', return_value=subprocess.CompletedProcess([], 255, '', 'Permission denied')):
            with self.assertRaisesRegex(TasksError, 'authentication'):
                SSHSource('ssh://host/tmp/TASKS.md').read()

    def github(self):
        run_git(self.project, 'init', '--quiet', '-b', 'main')
        (self.project / 'unrelated.txt').write_text('Keep me')
        (self.project / '.gitignore').write_text('docs/tasks/2-*.md\n')
        run_git(self.project, 'add', '.')
        run_git(self.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Initial')
        remote = self.root / 'remote.git'
        run_git(self.root, 'clone', '--bare', str(self.project), str(remote))
        source = GitHubSource('github://test/project?ref=main')
        source.remote_url = str(remote)
        return source, remote

    def test_github_real_git_roundtrip_stale_revision_and_unrelated_content(self):
        source, remote = self.github()
        before = source.read()
        created = source.mutate('create', before['revision'], input={'title': 'Remote task', 'description': 'Remote body'})
        after = source.read()
        self.assertEqual(created['revision'], after['revision'])
        self.assertEqual(run_git(remote, 'show', 'main:' + created['issue']['sourcePath']).stdout, 'Remote body')
        self.assertIn('Remote task', source.export())
        self.assertEqual(run_git(remote, 'show', 'main:unrelated.txt').stdout, 'Keep me')
        with self.assertRaises(TasksError) as error:
            source.mutate('delete', before['revision'], 'first')
        self.assertEqual(error.exception.status, 412)
        source.mutate('delete', after['revision'], created['issue']['id'])
        self.assertNotIn('Remote task', source.export())

    def test_github_rejects_competing_push(self):
        source, remote = self.github()
        before = source.read()
        real_git = run_git
        def competing(root, *args, **kwargs):
            if args and args[0] == 'push':
                (self.project / 'unrelated.txt').write_text('Concurrent edit')
                real_git(self.project, 'add', '.')
                real_git(self.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Concurrent')
                real_git(self.project, 'push', str(remote), 'HEAD:main')
            return real_git(root, *args, **kwargs)
        with patch('hai_tasks.sources.run_git', side_effect=competing):
            with self.assertRaises(TasksError) as error:
                source.mutate('update', before['revision'], 'first', {'title': 'Must not overwrite'})
        self.assertEqual(error.exception.status, 412)
        self.assertEqual(run_git(remote, 'show', 'main:TASKS.md').stdout, SOURCE)
        self.assertEqual(run_git(remote, 'show', 'main:unrelated.txt').stdout, 'Concurrent edit')

    def test_http_only_allows_configured_remote_aliases(self):
        with patch('hai_server.http.open_source', return_value=self.store):
            server = create_server(self.project / 'TASKS.md', self.root, port=0, remote_sources={'team': 'ssh://host/tmp/TASKS.md'})
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            with urlopen(base + '/api/workspace?source=/@team') as response:
                loaded = json.load(response)
            self.assertEqual(loaded['source'], {'name': 'team', 'path': '/@team'})
            request = Request(base + '/api/issues/first?source=/@team', data=b'{"title":"Via alias"}', method='PATCH', headers={'Content-Type': 'application/json', 'If-Match': loaded['revision']})
            with urlopen(request) as response:
                self.assertEqual(json.load(response)['issue']['title'], 'Via alias')
            with self.assertRaises(HTTPError) as error:
                urlopen(base + '/api/workspace?source=ssh://unconfigured/tmp/TASKS.md')
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
