"""Parse and edit tracker blocks without reserializing unrelated Markdown."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

SECTIONS = ['Unverified proposals', 'Ordered backlog', 'Scheduled', 'In Progress', 'Completed / Accepted']
META = re.compile(r'(?:\r?\n)[ \t]*<!-- hai:(\{[^\r\n]*\}) -->')
EPOCH = '1970-01-01T00:00:00.000Z'
PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent']


class TasksError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def status_for(section):
    return {'In Progress': 'in_progress', 'Scheduled': 'todo', 'Completed / Accepted': 'done'}.get(section, 'backlog')


def text_length(value):
    # Match the browser's UTF-16 length limits, including astral characters.
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def parse_tasks(source):
    if not isinstance(source, str) or len(source.encode()) > 2 * 1024 * 1024 or '\0' in source:
        raise TasksError('TASKS.md is invalid or exceeds 2 MB.', 422)
    headings = list(re.finditer(r'^## (.+?)\r?$', source, re.M))
    if [m[1] for m in headings] != SECTIONS + ['Rules']:
        raise TasksError('TASKS.md sections must occur once in the documented order.', 422)
    sections = {m[1]: {'start': m.start() + 3 + len(m[1]), 'end': headings[i + 1].start() if i + 1 < len(headings) else len(source)} for i, m in enumerate(headings)}
    references = {}
    for m in re.finditer(r'^\[(\d+)\]:[ \t]*(\S+)[ \t]*\r?$', source[:sections['Rules']['start']], re.M):
        if m[1] in references:
            raise TasksError(f'Duplicate description reference [{m[1]}].', 422)
        references[m[1]] = m[2]
    tasks, ids, markers = [], set(), set()
    for section in SECTIONS:
        start, end = sections[section].values()
        content = source[start:end]
        for m in re.finditer(r'^- \[([^\]\r\n]+)\](?:[ \t]+\[([^\]\r\n]+)\])?[ \t]+([^\r\n]*)', content, re.M):
            raw = m[0]
            cursor = m.end()
            while cursor < len(content):
                line = re.match(r'^(\r?\n)([^\r\n]*)', content[cursor:])
                if not line or (line[2].strip() and not re.match(r'^[ \t]', line[2])):
                    break
                raw += line[0]
                cursor += len(line[0])
            raw = re.sub(r'(?:\r?\n[ \t]*)+$', '', raw)
            checkbox = m[1] if m[1] in [' ', 'x', 'X', '~'] else None
            marker = (m[2] if re.fullmatch(r'\d+|\*', m[2] or '') else '*') if checkbox else m[1]
            if not re.fullmatch(r'\d+|\*', marker):
                raise TasksError('Invalid task identifier.', 422)
            first_line = re.split(r'\r?\n', raw)[0]
            prefix = r'^- \[[^\]]+\](?:[ \t]+\[(?:\d+|\*)\])?[ \t]+' if checkbox else r'^- \[[^\]]+\][ \t]+'
            title_start = re.match(prefix, first_line).end()
            summary, summary_end = [first_line[title_start:].strip()], len(first_line)
            for line in re.finditer(r'\r?\n([^\r\n]*)', raw[len(first_line):]):
                if not line[1].strip() or re.match(r'^\s*(?:- |<!--)', line[1]):
                    break
                summary.append(line[1].strip())
                summary_end += len(line[0])
            title = ' '.join(summary)
            if not title or text_length(title) > 50000:
                raise TasksError('Task title must contain 1–50,000 characters.', 422)
            matches = list(META.finditer(raw))
            if len(matches) > 1:
                raise TasksError('Duplicate Hai task metadata.', 422)
            try:
                metadata = json.loads(matches[0][1]) if matches else {}
            except ValueError:
                raise TasksError('Malformed Hai task metadata.', 422) from None
            if not isinstance(metadata, dict) or ('id' in metadata and (not isinstance(metadata['id'], str) or not re.fullmatch(r'[\w-]{1,100}', metadata['id'], re.ASCII))):
                raise TasksError('Invalid Hai task metadata.', 422)
            if marker != '*' and marker in markers:
                raise TasksError(f'Duplicate task reference [{marker}].', 422)
            markers.add(marker)
            identity_text = re.sub(r'^- \[[^\]]+\](?:[ \t]+\[(?:\d+|\*)\])?', '', META.sub('', raw))
            identity = metadata.get('id', 'simple-' + hashlib.sha256(identity_text.encode()).hexdigest()[:16] if marker == '*' else f'task-{marker}')
            if identity in ids:
                raise TasksError('Tasks have duplicate identities; assign distinct Hai metadata IDs.', 422)
            ids.add(identity)
            description = re.sub(r'^\r?\n', '', META.sub('', raw[summary_end:]))
            description = '\n'.join(re.sub(r'^ {2}', '', line) for line in re.split(r'\r?\n', description) if not re.match(r'^\s*- Depends on:', line))
            issue = dict(id=identity, sourceReference=f'[{marker}]', identifier=f'HAI-SIMPLE-{identity[-16:].upper()}' if marker == '*' else f'HAI-{marker}', title=title, description=description, status=status_for(section), priority=metadata.get('priority', 'none'), labels=metadata.get('labels', []), assigneeId=None, projectId=None, cycleId=None, createdAt=metadata.get('createdAt', EPOCH), updatedAt=metadata.get('updatedAt', EPOCH), sourceSection=section, accepted=section == 'Completed / Accepted' and checkbox in ['x', 'X'], dependencies=[number for line in re.findall(r'^\s*- Depends on:[^\r\n]*', raw, re.M) for number in re.findall(r'\[(\d+)\]', line)])
            if marker != '*':
                if marker not in references:
                    raise TasksError(f'Task [{marker}] has no description reference.', 422)
                issue['sourcePath'] = references[marker]
            tasks.append(dict(start=start + m.start(), end=start + m.start() + len(raw), raw=raw, marker=marker, checkbox=checkbox, titleStart=title_start, summaryEnd=summary_end, metadata=metadata, issue=issue))
        remainder = content
        for task in reversed([t for t in tasks if t['issue']['sourceSection'] == section]):
            remainder = remainder[:task['start'] - start] + remainder[task['end'] - start:]
        if re.search(r'^- \[', remainder, re.M):
            raise TasksError('Malformed task entry.', 422)
    return dict(source=source, tasks=tasks, sections=sections, references=references, newline='\r\n' if '\r\n' in source else '\n')


def workspace_of(parsed):
    return dict(issues=[task['issue'] for task in parsed['tasks']], projects=[], members=[], cycles=[], currentMemberId=None)


def validate_workspace(workspace):
    issues = workspace['issues']
    if len(issues) > 10000:
        raise TasksError('Invalid workspace: issues must contain at most 10,000 entries.', 422)
    identifiers = set()
    for issue in issues:
        if issue['identifier'] in identifiers:
            raise TasksError('Invalid workspace: duplicate issue identifier.', 422)
        identifiers.add(issue['identifier'])
        if text_length(issue['description']) > 50000:
            raise TasksError('Invalid workspace: description exceeds 50,000 characters.', 422)
        validate_patch({key: issue[key] for key in ['priority', 'labels']})
        for key in ['createdAt', 'updatedAt']:
            value = issue[key]
            try:
                if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(T.*)?', value):
                    raise ValueError()
                datetime.fromisoformat(value.replace('Z', '+00:00'))
            except ValueError:
                raise TasksError('Invalid workspace: issue has invalid dates.', 422) from None


def normalize_spacing(source):
    parsed = parse_tasks(source)
    headings = {position for name, section in parsed['sections'].items() for position in [section['start'], section['start'] - len(name) - 3]}
    starts = {task['start'] for task in parsed['tasks']}
    ends = {task['end'] for task in parsed['tasks']}
    return re.sub(r'\r?\n(?:[ \t]*\r?\n){2,}', lambda m: parsed['newline'] * 2 if m.start() in headings or m.end() in headings or (m.start() in ends and m.end() in starts) else m[0], source)


def remove_task(source, task):
    before, after = source[:task['start']], source[task['end']:]
    gap = re.match(r'^\r?\n(?:[ \t]*\r?\n)*', after)
    gap = gap[0] if gap else ''
    newline = '\r\n' if before.endswith('\r\n') else '\n'
    blank = re.search(r'\n[ \t]*\r?\n$', before) or re.search(r'\n[ \t]*\r?\n', gap)
    return re.sub(r'\r?\n(?:[ \t]*\r?\n)*$', newline * (2 if blank else 1), before) + after[len(gap):]


def validate_patch(patch):
    if not isinstance(patch, dict):
        raise TasksError('Expected an issue object.')
    if set(patch) - {'title', 'description', 'status', 'sourceSection', 'accepted', 'priority', 'labels', 'assigneeId', 'projectId', 'cycleId'}:
        raise TasksError('Unknown or read-only issue field.')
    if 'title' in patch and (not isinstance(patch['title'], str) or not patch['title'].strip() or text_length(patch['title']) > 50000 or re.search(r'[\r\n\x00-\x1f]', patch['title'])):
        raise TasksError('Title must contain 1–50,000 characters on one line.')
    if 'description' in patch and (not isinstance(patch['description'], str) or text_length(patch['description']) > 50000 or '\0' in patch['description']):
        raise TasksError('Description exceeds 50,000 characters or is invalid.')
    if 'sourceSection' in patch and patch['sourceSection'] not in SECTIONS:
        raise TasksError('Unsupported source section.')
    if 'status' in patch and patch['status'] not in ['backlog', 'todo', 'in_progress', 'done']:
        raise TasksError('Unsupported TASKS.md status.')
    if 'sourceSection' in patch and 'status' in patch and status_for(patch['sourceSection']) != patch['status']:
        raise TasksError('Status does not match the source section.')
    if 'accepted' in patch and type(patch['accepted']) is not bool:
        raise TasksError('Acceptance must be a boolean.')
    if 'priority' in patch and patch['priority'] not in PRIORITIES:
        raise TasksError('Invalid priority.')
    if 'labels' in patch and (not isinstance(patch['labels'], list) or len(patch['labels']) > 50 or any(not isinstance(label, str) or not label.strip() or text_length(label) > 100 or re.search(r'[\x00-\x1f]', label) for label in patch['labels'])):
        raise TasksError('Invalid labels.')
    if any(patch.get(key) is not None for key in ['assigneeId', 'projectId', 'cycleId']):
        raise TasksError('This tracker has no members, projects or cycles.')


def mutate_tasks(source, operation, id=None, input=None, new_reference=None):
    patch = {} if input is None and operation == 'delete' else input
    parsed = parse_tasks(source)
    if operation == 'reorder':
        if not isinstance(patch, dict) or set(patch) != {'issueIds'} or not isinstance(patch['issueIds'], list) or any(not isinstance(i, str) for i in patch['issueIds']):
            raise TasksError('Provide issueIds as an array of backlog issue IDs.')
        backlog = [t for t in parsed['tasks'] if t['issue']['sourceSection'] == 'Ordered backlog']
        by_id = {t['issue']['id']: t for t in backlog}
        ids = patch['issueIds']
        if len(ids) != len(backlog) or len(set(ids)) != len(ids) or set(ids) != set(by_id):
            raise TasksError('Include every Ordered backlog issue exactly once.')
        ordered = [by_id[i] for i in ids]
        positions = {t['marker']: i for i, t in enumerate(ordered)}
        for index, task in enumerate(ordered):
            for dependency in task['issue']['dependencies']:
                if positions.get(dependency, -1) >= index:
                    raise TasksError(f"{task['issue']['identifier']} depends on [{dependency}], which must appear earlier in Ordered backlog.")
        output, cursor = '', 0
        for slot, task in zip(backlog, ordered):
            output += source[cursor:slot['start']] + task['raw']
            cursor = slot['end']
        return {'source': normalize_spacing(output + source[cursor:])}
    if operation not in ['create', 'update', 'delete']:
        raise TasksError('Unknown mutation operation.')
    validate_patch(patch)
    task = next((t for t in parsed['tasks'] if t['issue']['id'] == id), None) if operation != 'create' else None
    if operation != 'create' and not task:
        raise TasksError('Issue not found.', 404)
    if operation == 'delete':
        if task['marker'] != '*' and any(t is not task and task['marker'] in t['issue']['dependencies'] for t in parsed['tasks']):
            raise TasksError('Other issues depend on this task. Update their dependencies before deleting it.', 409)
        return dict(source=normalize_spacing(remove_task(source, task)), id=id)
    if operation == 'create' and not patch.get('title'):
        raise TasksError('A title is required.')
    issue = task['issue'] if task else {}
    next_id = issue.get('id', f'simple-{uuid.uuid4()}')
    section = patch.get('sourceSection', {'backlog': issue.get('sourceSection') if issue.get('status') == 'backlog' else 'Ordered backlog', 'todo': 'Scheduled', 'in_progress': 'In Progress', 'done': 'Completed / Accepted'}.get(patch.get('status'), issue.get('sourceSection', 'Unverified proposals')))
    accepted = patch.get('accepted', issue.get('accepted', False))
    if accepted and section != 'Completed / Accepted':
        raise TasksError('An accepted issue must remain completed. Clear acceptance explicitly before reopening it.')
    marker, path = task['marker'] if task else '*', issue.get('sourcePath')
    description_write = None
    if 'description' in patch and (path or patch['description']):
        if not path:
            if not new_reference:
                raise TasksError('A description reference must be allocated.')
            marker, path = str(new_reference['number']), new_reference['path']
        description_write = dict(path=path, content=patch['description'])
    checkbox = ('x' if accepted else ' ') if section == 'Completed / Accepted' else '~' if section == 'In Progress' else None
    title = patch['title'].strip() if 'title' in patch else issue['title']
    if task and 'title' not in patch and marker == task['marker'] and section == issue['sourceSection'] and 'accepted' not in patch:
        raw = task['raw']
    else:
        summary = task['raw'][task['titleStart']:] if task and 'title' not in patch else title + (task['raw'][task['summaryEnd']:] if task else '')
        raw = '- ' + (f'[{checkbox}] ' if checkbox else '') + f'[{marker}] {summary}'
    if 'description' in patch and patch['description'] != issue.get('description') and task and task['marker'] == '*' and issue['description']:
        raw = parsed['newline'].join(line for i, line in enumerate(re.split(r'\r?\n', raw)) if i == 0 or re.match(r'^\s*- Depends on:', line) or '<!-- hai:' in line)
    metadata = dict(task['metadata']) if task else {}
    if marker == '*' or not task or task['marker'] == '*':
        metadata['id'] = next_id
    for key in ['priority', 'labels']:
        if key in patch:
            metadata[key] = patch[key]
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    if not task:
        metadata['createdAt'] = now
    metadata['updatedAt'] = now
    serialized = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).replace('<', r'\u003c').replace('>', r'\u003e')
    raw = META.sub('', raw) + parsed['newline'] + '  <!-- hai:' + serialized + ' -->'
    output = source
    if task:
        output = source[:task['start']] + raw + source[task['end']:] if section == issue['sourceSection'] else remove_task(source, task)
    if not task or section != issue['sourceSection']:
        remaining = parse_tasks(output)
        dependencies = [t for t in remaining['tasks'] if t['issue']['sourceSection'] == section and t['marker'] in issue.get('dependencies', [])] if section == 'Ordered backlog' else []
        destination = dependencies[-1]['end'] if dependencies else remaining['sections'][section]['start']
        output = output[:destination] + parsed['newline'] * 2 + raw + output[destination:]
    if path and marker not in parsed['references']:
        rules = re.search(r'^## Rules\r?$', output, re.M).start()
        output = re.sub(r'\r?\n(?:[ \t]*\r?\n){2,}$', parsed['newline'] * 2, output[:rules]) + f'[{marker}]: {path}' + parsed['newline'] * 2 + output[rules:]
    result = dict(source=normalize_spacing(output), id=next_id)
    if description_write:
        result['descriptionWrite'] = description_write
    return result
