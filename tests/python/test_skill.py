import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / 'skills/hai-tasks/SKILL.md'
TRACKER = '''# Tasks

## Unverified proposals

## Ordered backlog

- [*] Example issue
  <!-- hai:{"id":"example"} -->

- [*] Other backlog issue
  <!-- hai:{"id":"other"} -->

## Scheduled

- [1] Numbered prerequisite

## In Progress

## Completed / Accepted

[1]: docs/tasks/1-numbered-prerequisite.md

## Rules

Only the user accepts work.
'''


class SkillTests(unittest.TestCase):
    def test_documented_commands(self):
        commands = re.findall(r'```bash\n(.*?)\n```', SKILL.read_text(), re.DOTALL)
        self.assertTrue(commands, 'The skill must contain executable examples')
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            tracker = project / 'TASKS.md'
            tracker.write_text(TRACKER)
            (project / 'docs/tasks').mkdir(parents=True)
            (project / 'docs/tasks/1-numbered-prerequisite.md').write_text('# Prerequisite\n')
            subprocess.run(['git', 'init', '-q', str(project)], check=True)
            # Exercise the published console entry point with the documented name.
            entry = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['scripts']['hai-tasks']
            module, function = entry.split(':')
            launcher = project / 'hai-tasks'
            launcher.write_text(f'#!{sys.executable}\nfrom {module} import {function}\nraise SystemExit({function}())\n')
            launcher.chmod(0o755)
            environment = dict(os.environ, PATH=f'{project}{os.pathsep}{os.environ["PATH"]}',
                               PYTHONPATH=str(ROOT), SHELL='/bin/bash')

            def run(arguments):
                result = subprocess.run(arguments, cwd=project, env=environment,
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)

            values = {'$SOURCE': str(tracker), '$ISSUE_ID': 'example',
                      'OTHER_BACKLOG_ID': 'other'}
            fallback = run(['python3', '-m', 'hai_tasks', 'read', str(tracker)])
            self.assertEqual(fallback['revision'], run(['hai-tasks', 'read', str(tracker)])['revision'])
            seen = []
            statuses = []
            for block in commands:
                for line in block.splitlines():
                    arguments = shlex.split(line)
                    self.assertEqual(arguments[0], 'hai-tasks')
                    command = arguments[1]
                    seen.append(command)
                    snapshot = run(['hai-tasks', 'read', str(tracker)])
                    values['$REVISION'] = snapshot['revision']
                    for key, value in values.items():
                        arguments = [argument.replace(key, value) for argument in arguments]
                    result = run(arguments)
                    after = run(['hai-tasks', 'read', str(tracker)])
                    issues = after['workspace']['issues']
                    if command in ['update', 'create']:
                        patch = json.loads(arguments[arguments.index('--json') + 1])
                        issue = next(item for item in issues if item['id'] == result['issue']['id'])
                        self.assertFalse(issue['accepted'])
                        if 'dependencies' in patch:
                            self.assertEqual(issue['dependencies'], [str(number) for number in patch['dependencies']])
                            self.assertIn('\n    - Depends on: [1]\n', tracker.read_text())
                        else:
                            self.assertEqual(issue['sourceSection'], patch['sourceSection'])
                            self.assertEqual(issue['status'], patch['status'])
                            statuses.append(issue['status'])
                        if command == 'create':
                            values['NEW_ISSUE_ID'] = issue['id']
                            self.assertEqual([item['id'] for item in issues if item['sourceSection'] == 'Ordered backlog'],
                                             ['other', issue['id']])
                        if issue['status'] == 'in_progress':
                            self.assertIn('- [~] [*] Example issue', tracker.read_text())
                        if issue['status'] == 'done':
                            self.assertIn('- [ ] [*] Example issue', tracker.read_text())
                    elif command == 'reorder':
                        expected = json.loads(arguments[arguments.index('--json') + 1])['issueIds']
                        self.assertEqual([item['id'] for item in issues if item['sourceSection'] == 'Ordered backlog'], expected)
                    elif command == 'query':
                        self.assertTrue(result)
                        self.assertTrue(all(row['revision'] == snapshot['revision'] for row in result))
                    elif command == 'read':
                        self.assertEqual(result['revision'], snapshot['revision'])
                    self.assertIn('Only the user accepts work.', tracker.read_text())
            self.assertEqual(set(seen), {'read', 'query', 'update', 'create', 'reorder'})
            self.assertEqual(set(statuses), {'backlog', 'todo', 'in_progress', 'done'})
