"""Machine-readable CLI. Mutation revisions are always explicit."""
import argparse
import json
import sys
from pathlib import Path

from .markdown import SECTIONS, TasksError, parse_tasks
from .sources import open_source, query, report


def rpc(payload):
    if not isinstance(payload, dict):
        raise TasksError('Expected a command object.')
    # SSH endpoints can only open local files, never chain to another remote host.
    source = payload.get('source')
    if not isinstance(source, str) or '://' in source:
        raise TasksError('RPC requires a local source path.')
    store = open_source(source)
    command = payload.get('command')
    if command == 'read':
        return store.read()
    if command == 'export':
        return store.export(payload.get('format', 'tasks'))
    if command == 'mutate':
        return store.mutate(payload.get('operation'), payload.get('revision'), payload.get('id'), payload.get('input'))
    raise TasksError('Unknown RPC command.')


def read_json(value):
    try:
        return json.loads(sys.stdin.read(1024 * 1024 + 1) if value == '-' else value)
    except ValueError:
        raise TasksError('Input must be valid JSON.') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description='Parse, query and edit local, SSH and GitHub TASKS.md projects.')
    commands = parser.add_subparsers(dest='command', required=True)
    parse = commands.add_parser('parse', help='Parse a tracker without loading description files.')
    parse.add_argument('file', help='TASKS.md path, or - for standard input')
    for name in ['query', 'report']:
        command = commands.add_parser(name)
        command.add_argument('sources', nargs='+')
        command.add_argument('--text', default='')
        command.add_argument('--section', choices=SECTIONS)
        command.add_argument('--status', choices=['backlog', 'todo', 'in_progress', 'done', 'canceled'])
        command.add_argument('--priority', choices=['none', 'low', 'medium', 'high', 'urgent'])
        command.add_argument('--label')
        command.add_argument('--accepted', action=argparse.BooleanOptionalAction, default=None)
    for name in ['read', 'export', 'create', 'update', 'delete', 'reorder']:
        command = commands.add_parser(name)
        command.add_argument('source')
        if name in ['update', 'delete']:
            command.add_argument('id', help='Stable issue ID from read/query output')
        if name in ['create', 'update', 'delete', 'reorder']:
            command.add_argument('--revision', required=True, help='Revision returned by read/query')
        if name in ['create', 'update', 'reorder']:
            command.add_argument('--json', required=True, help='Issue patch or {"issueIds": [...]}; - reads stdin')
        if name == 'export':
            command.add_argument('--format', choices=['tasks', 'json'], default='tasks')
    commands.add_parser('rpc', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.command == 'rpc':
            result = {'result': rpc(read_json('-'))}
        elif args.command == 'parse':
            content = sys.stdin.buffer.read(2 * 1024 * 1024 + 1) if args.file == '-' else Path(args.file).read_bytes()
            result = parse_tasks(content.decode('utf-8'))
        elif args.command in ['query', 'report']:
            filters = {key: getattr(args, key) for key in ['text', 'section', 'status', 'priority', 'label', 'accepted']}
            result = (query if args.command == 'query' else report)(args.sources, **filters)
        else:
            store = open_source(args.source)
            if args.command == 'read':
                snapshot = store.read()
                result = dict(workspace=snapshot['workspace'], revision=snapshot['revision'], capabilities=snapshot.get('capabilities', store.capabilities))
            elif args.command == 'export':
                sys.stdout.write(store.export(args.format))
                return 0
            else:
                result = store.mutate(args.command, args.revision, getattr(args, 'id', None), read_json(args.json) if hasattr(args, 'json') else {})
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (TasksError, OSError, UnicodeError) as error:
        result = dict(error=str(error), status=getattr(error, 'status', 500))
        print(json.dumps(result), file=sys.stdout if args.command == 'rpc' else sys.stderr)
        return 1
