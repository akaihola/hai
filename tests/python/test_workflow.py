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
                            if type(store) is TasksStore:
                                self.assertEqual(result['issue']['sourceSection'], state)
                for status in dict.fromkeys(status_for_stage(stage) for stage in states.values()):
                    result = store.mutate('update', store.read()['revision'], result['issue']['id'], {'status': status})
                    self.assertEqual(result['issue']['sourceState'], next(key for key, stage in states.items() if status_for_stage(stage) == status))
                for patch in [{'sourceState': 'unknown'}, {'sourceState': []}, {'sourceState': next(iter(states)), 'status': 'done'}, {'status': 'in_review'}]:
                    before = store.read()
                    with self.assertRaises(TasksError):
                        store.mutate('update', before['revision'], result['issue']['id'], patch)
                    self.assertEqual(store.read()['revision'], before['revision'])
                if type(store) is TasksStore:
                    result = store.mutate('update', store.read()['revision'], result['issue']['id'], {'sourceSection': 'Ordered backlog'})
                    self.assertEqual(result['issue']['sourceState'], 'Ordered backlog')
                    self.assertEqual(result['issue']['status'], 'todo')
                    with self.assertRaises(TasksError):
                        store.mutate('update', result['revision'], result['issue']['id'], {'sourceState': 'Scheduled', 'sourceSection': 'In Progress'})
