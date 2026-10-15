import type { Issue, IssuePriority, IssueStatus, Workspace } from '../domain'

const rows: [string, IssueStatus, IssuePriority, string | null, string, string[]][] = [
  ['Design the issue detail experience', 'in_progress', 'high', 'alex', 'core', ['Design', 'Feature']],
  ['Add keyboard shortcuts for common actions', 'in_progress', 'high', 'sam', 'core', ['Feature']],
  ['Build the workspace navigation', 'in_progress', 'medium', 'jules', 'core', ['Frontend']],
  ['Define a common adapter interface', 'in_progress', 'high', 'morgan', 'adapters', ['Engineering']],
  ['Improve empty states across the app', 'in_review', 'medium', 'alex', 'core', ['Design']],
  ['Set up the design token system', 'in_review', 'high', 'jules', 'core', ['Design', 'Frontend']],
  ['Add filtering by status and assignee', 'todo', 'high', 'sam', 'core', ['Feature']],
  ['Support drag and drop on the board', 'todo', 'medium', 'jules', 'core', ['Feature']],
  ['Create the local workspace adapter', 'done', 'high', 'morgan', 'adapters', ['Engineering']],
  ['Research Markdown task formats', 'done', 'medium', 'alex', 'adapters', ['Research']],
  ['Map GitHub Issues to the domain model', 'todo', 'high', 'morgan', 'adapters', ['Integration']],
  ['Persist view preferences locally', 'todo', 'low', 'sam', 'core', ['Frontend']],
  ['Fix focus ring clipping in dropdowns', 'todo', 'urgent', 'jules', 'core', ['Bug', 'Accessibility']],
  ['Write the getting started guide', 'in_progress', 'medium', 'alex', 'launch', ['Documentation']],
  ['Make the command menu searchable', 'todo', 'medium', 'sam', 'core', ['Feature']],
  ['Create project overview cards', 'in_review', 'medium', 'jules', 'core', ['Frontend']],
  ['Document the backend capability model', 'todo', 'medium', 'morgan', 'adapters', ['Documentation']],
  ['Explore a Beans filesystem connector', 'backlog', 'medium', null, 'adapters', ['Integration']],
  ['Add a taskmd import adapter', 'backlog', 'medium', 'morgan', 'adapters', ['Integration']],
  ['Investigate Markdown Ticket support', 'backlog', 'low', null, 'adapters', ['Research']],
  ['Add a readable TASKS.md export', 'done', 'medium', 'sam', 'adapters', ['Feature']],
  ['Prepare the first public release', 'backlog', 'high', 'alex', 'launch', ['Release']],
  ['Add reduced motion preferences', 'todo', 'low', 'jules', 'core', ['Accessibility']],
  ['Collect feedback from early users', 'backlog', 'none', null, 'launch', ['Research']],
  ['Build cycle progress summaries', 'todo', 'medium', 'sam', 'core', ['Feature']],
  ['Create workspace backup and restore', 'done', 'high', 'morgan', 'adapters', ['Engineering']],
  ['Replace the legacy status picker', 'canceled', 'low', null, 'core', ['Design']],
]

const descriptions: Record<string, string> = {
  '101': 'Give every issue a focused place to live. Keep the title, description, and properties easy to scan without losing the surrounding workspace.\n\nAcceptance criteria\n- Open an issue from both the list and board\n- Edit its title, description, and properties\n- Support Escape to close and return focus',
  '102': 'Make frequent actions feel immediate. Start with C to create an issue, / to search, and Escape to dismiss overlays. Do not intercept shortcuts while someone is typing.',
  '104': 'Keep the workspace independent of its storage provider. Define the issue model and asynchronous operations, and report what each backend actually supports.',
  '111': 'Research a GitHub adapter using repository issues and Projects fields. Document status mapping, authentication, and fields that do not round-trip.',
  '113': 'The focus indicator gets cut off in compact dropdown menus. Give it enough space and check the complete menu flow using only the keyboard.',
}

export function createSeedWorkspace(): Workspace {
  return {
    currentMemberId: 'alex',
    members: [
      { id: 'alex', name: 'Alex Morgan', initials: 'AM', color: '#6479c8' },
      { id: 'sam', name: 'Sam Chen', initials: 'SC', color: '#819477' },
      { id: 'jules', name: 'Jules Park', initials: 'JP', color: '#b48c72' },
      { id: 'morgan', name: 'Morgan Lee', initials: 'ML', color: '#a28db8' },
    ],
    projects: [
      { id: 'core', name: 'Core experience', description: 'A calm, fast workspace for the work that matters.', color: '#8793cb', status: 'in_progress', targetDate: '2026-10-16' },
      { id: 'adapters', name: 'Backend integrations', description: 'One workspace. Your tools, your data.', color: '#b298cb', status: 'in_progress', targetDate: '2026-10-30' },
      { id: 'launch', name: 'Public launch', description: 'Introduce Hai to a small community of builders.', color: '#c19b70', status: 'planned', targetDate: '2026-11-06' },
    ],
    cycles: [
      { id: 'cycle-12', name: 'Cycle 12', startsAt: '2026-09-28', endsAt: '2026-10-11' },
      { id: 'cycle-13', name: 'Cycle 13', startsAt: '2026-10-12', endsAt: '2026-10-25' },
      { id: 'cycle-11', name: 'Cycle 11', startsAt: '2026-09-14', endsAt: '2026-09-27' },
    ],
    issues: rows.map(([title, status, priority, assigneeId, projectId, labels], index): Issue => {
      const number = 101 + index
      return {
        id: `issue-${number}`, identifier: `HAI-${number}`, title,
        description: descriptions[number] ?? `${title}.\n\nPart of the ${projectId === 'core' ? 'core product experience' : projectId === 'adapters' ? 'backend integration work' : 'public launch'}. Keep the scope focused and document the behavior for the team.`,
        status, sourceState: status, priority, assigneeId, projectId, labels: [...labels],
        cycleId: status === 'backlog' || status === 'canceled' ? null : 'cycle-12',
        createdAt: `2026-09-${String(15 + index % 13).padStart(2, '0')}T09:00:00.000Z`,
        updatedAt: `2026-10-${String(1 + index % 3).padStart(2, '0')}T10:30:00.000Z`,
      }
    }),
  }
}
