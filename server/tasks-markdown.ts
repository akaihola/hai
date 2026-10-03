import { createHash, randomUUID } from 'node:crypto'
import type { Issue, IssuePatch, Workspace } from '../src/domain.ts'

export const SECTIONS = ['Unverified proposals', 'Ordered backlog', 'Scheduled', 'In Progress', 'Completed / Accepted'] as const
export type Section = typeof SECTIONS[number]
export type TaskIssue = Issue & { sourceSection: Section; accepted: boolean; sourcePath?: string; dependencies: string[]; sourceReference: string }
type Metadata = { id?: string; priority?: Issue['priority']; labels?: string[]; createdAt?: string; updatedAt?: string }
export interface Task { start: number; end: number; raw: string; marker: string; checkbox?: string; titleStart: number; summaryEnd: number; metadata: Metadata; issue: TaskIssue }
export interface ParsedTasks { source: string; tasks: Task[]; sections: Map<Section | 'Rules', { start: number; end: number }>; references: Map<string, string>; newline: string }
export class TasksError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
const metaPattern = /(?:\r?\n)[ \t]*<!-- hai:(\{[^\r\n]*\}) -->/g
const statusFor = (section: Section): Issue['status'] => section === 'In Progress' ? 'in_progress' : section === 'Scheduled' ? 'todo' : section === 'Completed / Accepted' ? 'done' : 'backlog'
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)
const epoch = '1970-01-01T00:00:00.000Z'

export function parseTasks(source: string): ParsedTasks {
  if (Buffer.byteLength(source) > 2 * 1024 * 1024 || source.includes('\0')) throw new TasksError('TASKS.md is invalid or exceeds 2 MB.', 422)
  const headings = [...source.matchAll(/^## (.+)\r?$/gm)]
  if (headings.map(match => match[1]).join('|') !== [...SECTIONS, 'Rules'].join('|')) throw new TasksError('TASKS.md sections must occur once in the documented order.', 422)
  const sections: ParsedTasks['sections'] = new Map(headings.map((match, index) => [match[1] as Section | 'Rules', { start: match.index! + 3 + match[1].length, end: headings[index + 1]?.index ?? source.length }]))
  const references = new Map<string, string>()
  const rulesStart = sections.get('Rules')!.start
  for (const match of source.slice(0, rulesStart).matchAll(/^\[(\d+)\]:[ \t]*(\S+)[ \t]*\r?$/gm)) {
    if (references.has(match[1])) throw new TasksError(`Duplicate description reference [${match[1]}].`, 422)
    references.set(match[1], match[2])
  }
  const tasks: Task[] = []
  const ids = new Set<string>()
  const markers = new Set<string>()
  for (const section of SECTIONS) {
    const range = sections.get(section)!
    const content = source.slice(range.start, range.end)
    for (const match of content.matchAll(/^- \[([^\]\r\n]+)\](?:[ \t]+\[([^\]\r\n]+)\])?[ \t]+([^\r\n]*)/gm)) {
      const start = range.start + match.index!
      let raw = match[0]
      let cursor = match.index! + raw.length
      while (cursor < content.length) {
        const next = /^(\r?\n)([^\r\n]*)/.exec(content.slice(cursor))
        if (!next || (next[2].trim() && !/^[ \t]/.test(next[2]))) break
        raw += next[0]
        cursor += next[0].length
      }
      raw = raw.replace(/(?:\r?\n[ \t]*)+$/, '')
      const end = start + raw.length
      const checkbox = [' ', 'x', 'X', '~'].includes(match[1]) ? match[1] : undefined
      const marker = checkbox ? (/^(\d+|\*)$/.test(match[2] ?? '') ? match[2] : '*') : match[1]
      if (!/^(\d+|\*)$/.test(marker)) throw new TasksError('Invalid task identifier.', 422)
      const firstLine = raw.split(/\r?\n/, 1)[0]
      const prefix = checkbox ? /^- \[[^\]]+\](?:[ \t]+\[(?:\d+|\*)\])?[ \t]+/ : /^- \[[^\]]+\][ \t]+/
      const titleStart = prefix.exec(firstLine)![0].length
      const summary = [firstLine.slice(titleStart).trim()]
      let summaryEnd = firstLine.length
      for (const line of raw.slice(firstLine.length).matchAll(/\r?\n([^\r\n]*)/g)) {
        if (!line[1].trim() || /^\s*(?:- |<!--)/.test(line[1])) break
        summary.push(line[1].trim())
        summaryEnd += line[0].length
      }
      const title = summary.join(' ')
      if (!title || title.length > 300) throw new TasksError('Task title must contain 1–300 characters.', 422)
      const metadataMatches = [...raw.matchAll(metaPattern)]
      if (metadataMatches.length > 1) throw new TasksError('Duplicate Hai task metadata.', 422)
      let metadata: Metadata = {}
      try { if (metadataMatches[0]) metadata = JSON.parse(metadataMatches[0][1]) as Metadata } catch { throw new TasksError('Malformed Hai task metadata.', 422) }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || (metadata.id !== undefined && !/^[\w-]{1,100}$/.test(metadata.id))) throw new TasksError('Invalid Hai task metadata.', 422)
      if (marker !== '*' && markers.has(marker)) throw new TasksError(`Duplicate task reference [${marker}].`, 422)
      if (marker !== '*') markers.add(marker)
      const id = metadata.id ?? (marker === '*' ? `simple-${hash(raw.replace(metaPattern, '').replace(/^- \[[^\]]+\](?:[ \t]+\[(?:\d+|\*)\])?/, ''))}` : `task-${marker}`)
      if (ids.has(id)) throw new TasksError('Tasks have duplicate identities; assign distinct Hai metadata IDs.', 422)
      ids.add(id)
      const description = raw.slice(summaryEnd).replace(metaPattern, '').replace(/^\r?\n/, '').split(/\r?\n/).filter(line => !/^\s*- Depends on:/.test(line)).map(line => line.replace(/^ {2}/, '')).join('\n')
      const issue: TaskIssue = { id, sourceReference: `[${marker}]`, identifier: marker === '*' ? `HAI-SIMPLE-${id.slice(-16).toUpperCase()}` : `HAI-${marker}`, title, description, status: statusFor(section), priority: metadata.priority ?? 'none', labels: metadata.labels ?? [], assigneeId: null, projectId: null, cycleId: null, createdAt: metadata.createdAt ?? epoch, updatedAt: metadata.updatedAt ?? epoch, sourceSection: section, accepted: section === 'Completed / Accepted' && checkbox?.toLowerCase() === 'x', dependencies: [...raw.matchAll(/^\s*- Depends on:[^\r\n]*/gm)].flatMap(match => [...match[0].matchAll(/\[(\d+)\]/g)].map(ref => ref[1])) }
      if (marker !== '*') {
        const path = references.get(marker)
        if (!path) throw new TasksError(`Task [${marker}] has no description reference.`, 422)
        issue.sourcePath = path
      }
      tasks.push({ start, end, raw, marker, checkbox, titleStart, summaryEnd, metadata, issue })
    }
    const withoutTasks = tasks.filter(task => task.issue.sourceSection === section).reduceRight((text, task) => text.slice(0, task.start - range.start) + text.slice(task.end - range.start), content)
    if (/^- \[/m.test(withoutTasks)) throw new TasksError('Malformed task entry.', 422)
  }
  return { source, tasks, sections, references, newline: source.includes('\r\n') ? '\r\n' : '\n' }
}

export function workspaceOf(parsed: ParsedTasks): Workspace { return { issues: parsed.tasks.map(task => task.issue), projects: [], members: [], cycles: [], currentMemberId: null } }

function normalizeTaskSpacing(source: string): string {
  const parsed = parseTasks(source)
  const headings = new Set<number>()
  for (const [name, { start }] of parsed.sections) headings.add(start).add(start - name.length - 3)
  const starts = new Set(parsed.tasks.map(task => task.start))
  const ends = new Set(parsed.tasks.map(task => task.end))
  return source.replace(/\r?\n(?:[ \t]*\r?\n){2,}/g, (gap: string, offset: number) =>
    headings.has(offset) || headings.has(offset + gap.length) || (ends.has(offset) && starts.has(offset + gap.length)) ? parsed.newline.repeat(2) : gap)
}

function removeTask(source: string, task: Task): string {
  const before = source.slice(0, task.start)
  const after = source.slice(task.end)
  const gap = /^\r?\n(?:[ \t]*\r?\n)*/.exec(after)![0]
  const newline = before.endsWith('\r\n') ? '\r\n' : '\n'
  const blank = /\n[ \t]*\r?\n$/.test(before) || /\n[ \t]*\r?\n/.test(gap)
  return before.replace(/\r?\n(?:[ \t]*\r?\n)*$/, newline.repeat(blank ? 2 : 1)) + after.slice(gap.length)
}

function validatePatch(input: unknown): asserts input is IssuePatch & { sourceSection?: Section; accepted?: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TasksError('Expected an issue object.')
  const patch = input as Record<string, unknown>
  const allowed = ['title', 'description', 'status', 'sourceSection', 'accepted', 'priority', 'labels', 'assigneeId', 'projectId', 'cycleId']
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new TasksError('Unknown or read-only issue field.')
  if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 300 || /[\r\n\x00-\x1f]/.test(patch.title))) throw new TasksError('Title must contain 1–300 characters on one line.')
  if (patch.description !== undefined && (typeof patch.description !== 'string' || patch.description.length > 50000 || patch.description.includes('\0'))) throw new TasksError('Description exceeds 50,000 characters or is invalid.')
  if (patch.sourceSection !== undefined && !SECTIONS.includes(patch.sourceSection as Section)) throw new TasksError('Unsupported source section.')
  if (patch.status !== undefined && !['backlog', 'todo', 'in_progress', 'done'].includes(String(patch.status))) throw new TasksError('Unsupported TASKS.md status.')
  if (patch.sourceSection !== undefined && patch.status !== undefined && statusFor(patch.sourceSection as Section) !== patch.status) throw new TasksError('Status does not match the source section.')
  if (patch.accepted !== undefined && typeof patch.accepted !== 'boolean') throw new TasksError('Acceptance must be a boolean.')
  if (patch.priority !== undefined && !['none', 'low', 'medium', 'high', 'urgent'].includes(String(patch.priority))) throw new TasksError('Invalid priority.')
  if (patch.labels !== undefined && (!Array.isArray(patch.labels) || patch.labels.length > 50 || patch.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100 || /[\x00-\x1f]/.test(label)))) throw new TasksError('Invalid labels.')
  if (['assigneeId', 'projectId', 'cycleId'].some(key => patch[key] !== undefined && patch[key] !== null)) throw new TasksError('This tracker has no members, projects or cycles.')
}

export function mutateTasks(source: string, operation: 'create' | 'update' | 'delete' | 'reorder', id?: string, input: unknown = {}, newReference?: { number: number; path: string }): { source: string; id?: string; descriptionWrite?: { path: string; content: string } } {
  if (operation === 'reorder') {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'issueIds') || !('issueIds' in input) || !Array.isArray(input.issueIds) || input.issueIds.some(id => typeof id !== 'string')) throw new TasksError('Provide issueIds as an array of backlog issue IDs.')
    const backlog = parseTasks(source).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog')
    const byId = new Map(backlog.map(task => [task.issue.id, task]))
    const ids = input.issueIds as string[]
    if (ids.length !== backlog.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw new TasksError('Include every Ordered backlog issue exactly once.')
    const ordered = ids.map(id => byId.get(id)!)
    const positions = new Map(ordered.map((task, index) => [task.marker, index]))
    for (const [index, task] of ordered.entries()) {
      for (const dependency of task.issue.dependencies) {
        const prerequisite = positions.get(dependency)
        if (prerequisite !== undefined && prerequisite >= index) throw new TasksError(`${task.issue.identifier} depends on [${dependency}], which must appear earlier in Ordered backlog.`)
      }
    }
    const parts: string[] = []
    let cursor = 0
    for (const [index, slot] of backlog.entries()) {
      parts.push(source.slice(cursor, slot.start), ordered[index].raw)
      cursor = slot.end
    }
    parts.push(source.slice(cursor))
    return { source: normalizeTaskSpacing(parts.join('')) }
  }
  validatePatch(input)
  const patch = input as IssuePatch & { sourceSection?: Section; accepted?: boolean }
  const parsed = parseTasks(source)
  const task = operation === 'create' ? undefined : parsed.tasks.find(item => item.issue.id === id)
  if (operation !== 'create' && !task) throw new TasksError('Issue not found.', 404)
  if (operation === 'delete') {
    if (task!.marker !== '*' && parsed.tasks.some(other => other !== task && other.issue.dependencies.includes(task!.marker))) throw new TasksError('Other issues depend on this task. Update their dependencies before deleting it.', 409)
    return { source: normalizeTaskSpacing(removeTask(source, task!)), id: task!.issue.id }
  }
  if (operation === 'create' && !patch.title) throw new TasksError('A title is required.')
  const nextId = task?.issue.id ?? `simple-${randomUUID()}`
  const section = patch.sourceSection ?? (patch.status ? ({ backlog: task?.issue.status === 'backlog' ? task.issue.sourceSection : 'Ordered backlog', todo: 'Scheduled', in_progress: 'In Progress', done: 'Completed / Accepted' } as Partial<Record<Issue['status'], Section>>)[patch.status]! : task?.issue.sourceSection ?? 'Unverified proposals')
  const accepted = patch.accepted ?? task?.issue.accepted ?? false
  if (accepted && section !== 'Completed / Accepted') throw new TasksError('An accepted issue must remain completed. Clear acceptance explicitly before reopening it.')
  const descriptionChanged = patch.description !== undefined && patch.description !== task?.issue.description
  let marker = task?.marker ?? '*'
  let path = task?.issue.sourcePath
  let descriptionWrite: { path: string; content: string } | undefined
  if (patch.description !== undefined && (path || patch.description.length > 0)) {
    if (!path) {
      if (!newReference) throw new TasksError('A description reference must be allocated.')
      marker = String(newReference.number)
      path = newReference.path
    }
    descriptionWrite = { path, content: patch.description }
  }
  const checkbox = section === 'Completed / Accepted' ? (accepted ? 'x' : ' ') : section === 'In Progress' ? '~' : undefined
  const title = patch.title?.trim() ?? task!.issue.title
  let raw: string
  if (task && patch.title === undefined && marker === task.marker && section === task.issue.sourceSection && patch.accepted === undefined) raw = task.raw
  else {
    const summary = task && patch.title === undefined ? task.raw.slice(task.titleStart) : `${title}${task?.raw.slice(task.summaryEnd) ?? ''}`
    raw = `- ${checkbox ? `[${checkbox}] ` : ''}[${marker}] ${summary}`
  }
  if (descriptionChanged && task?.marker === '*' && task.issue.description) {
    raw = raw.split(/\r?\n/).filter((line, index) => index === 0 || /^\s*- Depends on:/.test(line) || line.includes('<!-- hai:')).join(parsed.newline)
  }
  const metadata: Metadata = { ...task?.metadata }
  if (marker === '*' || task?.marker === '*' || !task) metadata.id = nextId
  if (patch.priority !== undefined) metadata.priority = patch.priority
  if (patch.labels !== undefined) metadata.labels = patch.labels
  if (!task) metadata.createdAt = new Date().toISOString()
  metadata.updatedAt = new Date().toISOString()
  raw = raw.replace(metaPattern, '') + `${parsed.newline}  <!-- hai:${JSON.stringify(metadata).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')} -->`
  let output = source
  if (task) output = section === task.issue.sourceSection ? source.slice(0, task.start) + raw + source.slice(task.end) : removeTask(source, task)
  if (!task || section !== task.issue.sourceSection) {
    const remaining = parseTasks(output)
    const dependencies = section === 'Ordered backlog' ? remaining.tasks.filter(other => other.issue.sourceSection === section && task?.issue.dependencies.includes(other.marker)) : []
    const destination = dependencies.at(-1)?.end ?? remaining.sections.get(section)!.start
    output = output.slice(0, destination) + `${parsed.newline}${parsed.newline}${raw}` + output.slice(destination)
  }
  if (path && !parsed.references.has(marker)) {
    const rulesHeading = /^## Rules\r?$/m.exec(output)!.index
    output = output.slice(0, rulesHeading).replace(/\r?\n(?:[ \t]*\r?\n){2,}$/, parsed.newline.repeat(2)) + `[${marker}]: ${path}${parsed.newline}${parsed.newline}` + output.slice(rulesHeading)
  }
  return { source: normalizeTaskSpacing(output), id: nextId, descriptionWrite }
}
