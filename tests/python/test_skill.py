import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

from hai_tasks import open_source
from hai_tasks.workflow import TASK_STATES

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / 'skills/hai-tasks/SKILL.md'


class SkillTests(unittest.TestCase):
    def test_documented_commands(self):
        blocks = re.findall(r'```bash\n(.*?)\n```', SKILL.read_text(), re.DOTALL)
        self.assertTrue(blocks, 'The skill must contain executable examples')
        for workflow in ['tasks', 'scratch', 'backlog']:
            with self.subTest(workflow=workflow), tempfile.TemporaryDirectory() as temporary:
                project = Path(temporary)
                tracker = project / 'TASKS.md'
                tracker.write_text('# Tasks\n\n' + ''.join(f'## {state}\n\n' for state in TASK_STATES) + '## Rules\n\nOnly users accept.\n')
                (project / '.scratch/feature/issues').mkdir(parents=True)
                (project / 'docs/backlog').mkdir(parents=True)
                source = {'tasks': tracker, 'scratch': project / '.scratch', 'backlog': project / 'docs/backlog'}[workflow]
                store = open_source(source)
                before = store.read()
                patch = {'title': 'Example issue', 'sourceState': next(s['id'] for s in before['capabilities']['sourceStates'] if s['stage'] == 'ready')}
                if workflow == 'scratch':
                    patch['projectId'] = before['workspace']['projects'][0]['id']
                issue = store.mutate('create', before['revision'], input=patch)['issue']
                entry = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['scripts']['hai-tasks']
                module, function = entry.split(':')
                launcher = project / 'hai-tasks'
                launcher.write_text(f'#!{sys.executable}\nfrom {module} import {function}\nraise SystemExit({function}())\n')
                launcher.chmod(0o755)
                environment = dict(os.environ, PATH=f'{project}{os.pathsep}{os.environ["PATH"]}',
                                   PYTHONPATH=str(ROOT), SHELL='/bin/bash', SOURCE=str(source), ISSUE_ID=issue['id'])
                # One shell retains the documented helper and variables. Checkpoint every block.
                script = 'set -e\n' + '\n'.join(f'{block}\nhai-tasks read "$SOURCE" > checkpoint-{index}.json' for index, block in enumerate(blocks))
                result = subprocess.run(['bash', '-c', script], cwd=project, env=environment, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                statuses = []
                for index in range(len(blocks)):
                    snapshot = json.loads((project / f'checkpoint-{index}.json').read_text())
                    current = next(i for i in snapshot['workspace']['issues'] if i['id'] == issue['id'])
                    statuses.append(current['status'])
                    self.assertFalse(current['accepted'])
                self.assertEqual(statuses, ['todo', 'todo', 'in_progress', 'done', 'todo', 'todo'])
                self.assertEqual(len(snapshot['workspace']['issues']), 2)
                self.assertTrue(all(not i['accepted'] for i in snapshot['workspace']['issues']))
                self.assertIn('Only users accept.', tracker.read_text())
