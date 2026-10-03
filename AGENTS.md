# Instructions for coding agents

Issues are tracked in TASKS.md.

Read the rules at the bottom of `TASKS.md` before changing issue status. Completed
work stays unchecked until the user explicitly accepts it. Tests and deployment
are not acceptance.

## Command shell

The user's interactive login shell is Zsh. Agent command execution uses Bash.

- Write Bash syntax and explicitly select `bash` whenever the command tool accepts
  a shell parameter.
- Keep `SHELL` set to the configured Bash executable in subprocess environments;
  on this host, use `export SHELL=/bin/bash`.
- Do not depend on `.zshrc`, Zsh aliases, or Zsh-only syntax. Invoke Zsh explicitly
  only for work that concerns Zsh behavior.

## Working on Hai

- Keep data operations behind `WorkspaceBackend`; declare unsupported operations
  and fields through capabilities. Do not simulate connected providers.
- Preserve tracker sections, references, task descriptions, unrelated text, and
  user acceptance when editing the live `TASKS.md` backend.
- Run checks appropriate to the change. Use `npm run check` for application-wide
  validation and read `docs/deployment.md` before deploying.
- Apply the Git/worktree workflow in `TASKS.md` only when this directory is a Git
  repository. Do not initialize Git or create commits solely to satisfy tracker
  rules when Git has not been set up.
