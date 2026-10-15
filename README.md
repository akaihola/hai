# Hai

A Linear-inspired issue workspace with a replaceable backend. Built with React, TypeScript, Vite, Lucide icons, and a Python backend.

## Run

Use Python 3.11+ and Git for the backend. Node.js 22.12+ or 24+ builds and tests the frontend.

```bash
npm ci
npm run build
npm start
```

Open http://localhost:4173. Hai reads and edits this repository's `TASKS.md` and its linked task descriptions. The server must be running; connection failures never fall back to sample data.

For frontend development, run `npm run dev:server` and `npm run dev` in separate terminals. Vite serves http://127.0.0.1:5173 and forwards `/api` to the backend on port 4173. On gogo, the backend already runs as `hai.service`.

The deployed app is available at http://gogo.tailnet.example:5173/ and https://gogo.tailnet.example:8443/ through Tailscale. Both addresses use the persistent production service. Vite binds only to loopback so development and tests can share port 5173 with the separate Tailscale address.

The standalone [Python API and CLI](docs/python-api-cli.md) parses, queries, edits and reports on local, SSH and GitHub TASKS.md projects, `.scratch/` feature tickets and `docs/backlog/`-style directories. Run `python3 -m hai_tasks --help`. Configured remote projects can also be opened in the browser by alias.

The independent browser-storage demo remains available at `/?backend=local`. Its sample data and backups stay in that browser and origin.

All backends share an ordered native-state catalog with stages such as `ready`,
`active` and `done`. Lists, boards and editors use each source's catalog; All
projects shares stage columns across providers. CLI `--state` and `--stage`
filters use the same model. See the [catalog mapping](docs/backends.md#workflow-state-catalogs).

## Workflows

- Create, edit, and delete tasks with their source section, priority, labels, and description.
- Local trackers and linked descriptions refresh automatically every five seconds while the tab is visible, and when returning to the tab. Refresh pauses during editing, saving and dragging so stale drafts still receive revision conflicts. Source errors keep the last workspace visible and retry on the next poll. SSH and GitHub aliases use **Refresh source** to avoid repeated remote reads.
- Open another server project from **Open project** in the sidebar. Enter a folder such as `~/prg/my-project/`, its `TASKS.md` path, a `.scratch/<feature>` directory, or a repository's `docs/` workflow directories such as `~/repos/nixos-config/docs/backlog/`. Recent projects and the last selection are saved in this browser.
- Browse grouped lists or a board. Move tasks between source sections on the board or with the issue editor.
- Search and filter issues. Backends that supply them also expose projects, cycles, assigned work, and recent activity.
- Use `C` to create an issue, `Ctrl+K` or `⌘K` to search, and `Escape` to close a dialog.
- Completed and Accepted have separate list and board groups, tabs and filters. Use **Hide accepted** to keep accepted work out of the issue list.
- Complete tasks without accepting them. Completed tasks stay `[ ]` until the user explicitly accepts them with `[x]`.
- Refresh the source after external file edits. Stale revisions are rejected; review any reported partial save before retrying.
- Export the actual `TASKS.md` or a JSON snapshot. The browser demo also supports JSON backup restore.

By default, Hai allows sibling projects of the configured tracker, such as directories under `/home/agent/prg/`. Set `HAI_PROJECT_ROOTS` to a colon-separated list of allowed roots on Linux to change this. The configured default project remains allowed. Only existing trackers with the supported five-section format can be opened.

The file backend follows the [tracker rules](TASKS.md#rules) adopted from Filemill. Keep backups of `TASKS.md` and `docs/tasks/` together. File replacement is atomic per file, not across a tracker and description pair. It does not invent members, projects, or cycles; those views remain available for backends that supply them.

See [deployment instructions](docs/deployment.md) for the persistent service and private HTTPS access on gogo.

## Backend integration

`src/domain.ts` defines `WorkspaceBackend`. `App` accepts a backend prop; the application entry point selects the TASKS.md HTTP adapter by default.

```tsx
import App from './App';
import { myBackend } from './adapters/my-backend';

<App backend={myBackend} />
```

Implement the asynchronous workspace load and issue mutation methods, declare supported capabilities, and map provider data into the shared model. The UI uses capabilities to control available actions. Provider credentials and direct filesystem access belong in a companion service or desktop bridge.

Automatic refresh requires `canAutoRefresh` and `pollChanges(canApply)`. The backend must check `canApply()` immediately before committing a read or advancing its write revision, discard reads superseded by foreground operations, and return `null` for an unchanged revision. Local TASKS.md polling reuses the revision that covers both the tracker and linked descriptions; it needs no file watcher or persistent server connection. Five-second polling trades bounded read traffic for a short refresh delay. Remote aliases keep automatic refresh disabled because SSH reads incur network work and GitHub reads clone the repository.

GitHub Issues/Projects, Beans, taskmd, and markdown-ticket remain planned integrations. Projects, members, and cycles are supplied by the backend; project and cycle administration is available when the backend supports it. The deployment uses private Tailscale access rather than application accounts.

Research, provider mappings, and extension guidance are in [docs/backends.md](docs/backends.md). Design decisions and the implementation plan are in [docs/design.md](docs/design.md).

## Verify

```bash
# Install Chromium only if your environment does not already provide it.
npx playwright install chromium
npm run check
```

`npm test` runs Python package, CLI and transport tests plus the existing client and tracker regressions against Python. `npm run build` typechecks the client and test bridge and produces `dist/`. `npm run test:e2e` runs Chromium workflows, including the file backend against temporary trackers. Tests do not mutate this repository's tracker.

Validation on October 3, 2026 passed 44 unit/API tests, 31 Chromium tests, TypeScript checks, and the production build. Live deployment checks are recorded in `docs/deployment.md`.

Screenshots: [desktop workspace](docs/screenshots/tasks-desktop.png) and [mobile workspace](docs/screenshots/tasks-mobile.png).

The implementation follows [Honey's guiding principles](https://raw.githubusercontent.com/Green-PT/honey-for-devs/refs/heads/main/skills/honey/SKILL.md). UI behavior and hierarchy are informed by [Linear](https://linear.app/); Hai does not use Linear's branding or proprietary assets.
