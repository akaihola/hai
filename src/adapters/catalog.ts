export const BACKENDS = [
  { id: 'local', name: 'Local workspace', description: 'Saved in this browser. JSON backup and TASKS.md export.', status: 'active', url: null },
  { id: 'github', name: 'GitHub', description: 'Issues and Projects through the GitHub API.', status: 'planned', url: 'https://docs.github.com/en/rest/issues/issues' },
  { id: 'beans', name: 'Beans', description: 'Markdown issues stored alongside your code.', status: 'planned', url: 'https://github.com/hmans/beans' },
  { id: 'taskmd', name: 'taskmd', description: 'Task files with structured YAML frontmatter.', status: 'planned', url: 'https://github.com/driangle/taskmd' },
  { id: 'markdown-ticket', name: 'Markdown Ticket', description: 'Project tickets backed by Markdown and Git.', status: 'planned', url: 'https://github.com/andkirby/markdown-ticket' },
  { id: 'tasks-md', name: 'TASKS.md', description: 'Readable export available. Live file sync is planned.', status: 'planned', url: null },
] as const
