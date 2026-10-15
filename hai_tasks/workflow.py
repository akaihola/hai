"""Provider workflow catalogs and their display statuses."""

STAGES = ('triage', 'waiting', 'ready', 'scheduled', 'active', 'review', 'done', 'dropped')
STAGE_STATUSES = dict(zip(STAGES, ('backlog', 'backlog', 'todo', 'todo', 'in_progress', 'in_review', 'done', 'canceled')))
TASK_STATES = dict(zip(('Unverified proposals', 'Ordered backlog', 'Scheduled', 'In Progress', 'Completed / Accepted'), ('triage', 'ready', 'scheduled', 'active', 'done')))


class TasksError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def status_for_stage(stage):
    return STAGE_STATUSES[stage]


def select_state(states, patch, current=None):
    """Resolve a native state, accepting a display status for older clients."""
    if 'sourceState' in patch:
        state = patch['sourceState']
    elif 'status' in patch:
        state = next((key for key, stage in states.items() if status_for_stage(stage) == patch['status']), None)
    else:
        state = current if current is not None else next(iter(states))
    if not isinstance(state, str) or state not in states:
        raise TasksError('Choose a supported source state or status.')
    if 'status' in patch and patch['status'] != status_for_stage(states[state]):
        raise TasksError('Status does not match the source state.')
    return state
