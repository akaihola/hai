import { STATUSES, PRIORITIES, type Workspace } from '../domain'

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()#+.!|<>~-])/g, '\\$1').replace(/\r?\n/g, ' ')
}

export function exportTasks(workspace: Workspace): string {
  const lines = ['# Tasks', '', '> Exported from Hai. This is a readable snapshot; use a JSON backup to restore all workspace data.', '']
  for (const status of STATUSES) {
    const issues = workspace.issues.filter(issue => issue.status === status.id)
    if (!issues.length) continue
    lines.push(`## ${status.label}`, '')
    for (const issue of issues) {
      lines.push(`- [${issue.status === 'done' ? 'x' : ' '}] ${escapeMarkdown(issue.identifier)} ${escapeMarkdown(issue.title)}`)
      const project = workspace.projects.find(project => project.id === issue.projectId)
      const assignee = workspace.members.find(member => member.id === issue.assigneeId)
      const cycle = workspace.cycles.find(cycle => cycle.id === issue.cycleId)
      const properties = [PRIORITIES.find(priority => priority.id === issue.priority)?.label, project?.name, assignee?.name, cycle?.name, ...issue.labels]
      lines.push(`  - ${properties.filter(Boolean).map(value => escapeMarkdown(value!)).join(' · ')}`)
      if (issue.description) lines.push('', ...issue.description.split(/\r?\n/).map(line => `    ${line}`))
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}
