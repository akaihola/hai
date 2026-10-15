import tempfile
import unittest
from pathlib import Path

from hai_tasks import TasksStore, TasksError
from hai_tasks.backlog import BacklogStore, STATES as DOC_STATES
from hai_tasks.scratch import ScratchStore, STATES as SCRATCH_STATES
from hai_tasks.workflow import TASK_STATES, STAGES, status_for_stage


class WorkflowTests(unittest.TestCase):
    def test_catalogs_and_both_move_forms(self):
        self.assertEqual([status_for_stage(stage) for stage in STAGES],
                         ['backlog', 'backlog', 'todo', 'todo', 'in_progress', 'in_review', 'done', 'canceled'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tracker = root / 'TASKS.md'
            tracker.write_text('# Tasks\n\n' + ''.join(f'## {state}\n\n' for state in TASK_STATES) + '## Rules\n\nKeep rules.\n')
            (root / 'docs/backlog').mkdir(parents=True)
            (root / '.scratch/feature/issues').mkdir(parents=True)
            for store, states in [(TasksStore(tracker), TASK_STATES), (BacklogStore(root / 'docs'), DOC_STATES), (ScratchStore(root / '.scratch'), SCRATCH_STATES)]:
                snapshot = store.read()
                expected = [dict(id=key, stage=value) for key, value in states.items()]
                self.assertEqual(snapshot['capabilities']['sourceStates'], expected)
                patch = {'title': 'Workflow test'}
                if isinstance(store, ScratchStore):
                    patch['projectId'] = store.project_id('feature')
                result = store.mutate('create', snapshot['revision'], input=patch)
                for state, stage in states.items():
                    with self.subTest(backend=type(store).__name__, state=state):
                        for patch in [{'sourceState': state}, {'sourceState': state, 'status': status_for_stage(stage)}]:
                            result = store.mutate('update', store.read()['revision'], result['issue']['id'], patch)
                            self.assertEqual(result['issue']['sourceState'], state)
                            self.assertEqual(result['issue']['status'], status_for_stage(stage))
                            self.assertEqual(result['capabilities']['sourceStates'], expected)
                            self.assertNotIn('sourceSection', result['issue'])
                for status in dict.fromkeys(status_for_stage(stage) for stage in states.values()):
                    result = store.mutate('update', store.read()['revision'], result['issue']['id'], {'status': status})
                    self.assertEqual(result['issue']['sourceState'], next(key for key, stage in states.items() if status_for_stage(stage) == status))
                for patch in [{'sourceState': 'unknown'}, {'sourceState': []}, {'sourceState': next(iter(states)), 'status': 'done'}, {'status': 'in_review'}]:
                    before = store.read()
                    with self.assertRaises(TasksError):
                        store.mutate('update', before['revision'], result['issue']['id'], patch)
                    self.assertEqual(store.read()['revision'], before['revision'])
                for patch in [{'sourceSection': 'Ordered backlog'}, {'sourceState': 'Scheduled', 'sourceSection': 'Scheduled'}]:
                    before = store.read()
                    with self.assertRaises(TasksError):
                        store.mutate('update', before['revision'], result['issue']['id'], patch)
                    self.assertEqual(store.read()['revision'], before['revision'])

    def test_cli_state_and_stage_filters_across_workflows(self):
        import contextlib
        import io
        import json
        from hai_tasks.cli import main
        from hai_tasks import query, report

        def cli(*arguments):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(list(map(str, arguments))), 0)
            return json.loads(output.getvalue())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tracker = root / 'TASKS.md'
            tracker.write_text('# Tasks\n\n' + ''.join(f'## {state}\n\n' for state in TASK_STATES) + '## Rules\n\nKeep rules.\n')
            (root / 'docs/backlog').mkdir(parents=True)
            (root / '.scratch/feature/issues').mkdir(parents=True)
            sources = [tracker, root / 'docs', root / '.scratch']
            stores = [TasksStore(tracker), BacklogStore(root / 'docs'), ScratchStore(root / '.scratch')]
            for source, store in zip(sources, stores):
                catalog = store.read()['capabilities']['sourceStates']
                for state in catalog:
                    patch = {'title': state['id'], 'sourceState': state['id']}
                    if isinstance(store, ScratchStore):
                        patch['projectId'] = store.project_id('feature')
                    store.mutate('create', store.read()['revision'], input=patch)
                for state in catalog:
                    with self.subTest(source=str(source), state=state['id']):
                        rows = cli('query', source, '--state', state['id'])
                        self.assertEqual([row['issue']['sourceState'] for row in rows], [state['id']])
                        expected = [s['id'] for s in catalog if s['stage'] == state['stage']]
                        rows = cli('query', source, '--stage', state['stage'])
                        self.assertCountEqual([r['issue']['sourceState'] for r in rows], expected)
                        summary = cli('report', source, '--stage', state['stage'])
                        self.assertEqual(summary['byState'], dict.fromkeys(expected, 1))
                        self.assertEqual(cli('report', source, '--state', state['id'])['total'], 1)
                self.assertEqual(cli('query', source, '--state', 'missing'), [])
                self.assertEqual(cli('query', source, '--state', catalog[0]['id'], '--stage', 'done'), [])
            self.assertEqual(len(cli('query', *sources, '--stage', 'active')), 3)
            self.assertEqual(cli('report', *sources, '--stage', 'done')['awaitingAcceptance'], 1)
            self.assertEqual(len(query(sources, stage='ready')), 4)
            with self.assertRaises(TasksError):
                report(sources, stage='unknown')
            with self.assertRaises(TypeError):
                query(sources, section='one', state='two')
            for command in ['query', 'report']:
                output = io.StringIO()
                with contextlib.redirect_stdout(output), self.assertRaises(SystemExit):
                    main([command, '--help'])
                self.assertNotIn('--section', output.getvalue())
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                    main([command, str(sources[0]), '--section', 'Ordered backlog'])
                self.assertEqual(error.exception.code, 2)
