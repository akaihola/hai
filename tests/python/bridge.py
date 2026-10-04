"""Execute the existing TypeScript regression fixtures against Python."""
import json
import sys

from hai_tasks import TasksError, TasksStore, mutate_tasks, parse_tasks

request = json.load(sys.stdin)
try:
    command = request['command']
    args = request.get('args', [])
    if request.get('file'):
        result = getattr(TasksStore(request['file']), command)(*args)
    elif command == 'parse':
        result = parse_tasks(*args)
    elif command == 'mutate':
        result = mutate_tasks(*args)
    else:
        raise TasksError('Unknown test bridge command.')
    print(json.dumps({'result': result}))
except TasksError as error:
    print(json.dumps({'error': str(error), 'status': error.status}))
