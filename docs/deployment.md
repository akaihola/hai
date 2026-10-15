# Private deployment on gogo

The production service serves `dist/` and the Python API from
`/home/agent/prg/hai`, with `/home/agent/prg/hai/TASKS.md` as its tracker. It binds
only to `127.0.0.1:4173`. Tailscale Serve provides two private addresses:

- <http://gogo.tailnet.example:5173/>
- <https://gogo.tailnet.example:8443/>

Both serve the production build and API. Port 5173 does not depend on Vite.
Development and browser tests bind Vite to `127.0.0.1:5173`, separate from
Tailscale's listener on the tailnet IP.

The address is reachable by devices permitted by this tailnet's access policy.
Hai does not add per-user accounts to this deployment. Keep the service private.
Existing Tailscale routes, including HTTPS port 443, must remain unchanged.

## Install after validation

Run on gogo as `agent`. The checked-in service targets this repository's absolute
path. Python is available through `/etc/profiles/per-user/agent/bin/python3`; the path
survives Nix profile updates. User lingering is already enabled, so enabled user
services continue after logout and start at boot.

```bash
export SHELL=/bin/bash
cd /home/agent/prg/hai
npm ci
npm run check
bash deploy/install-user-service.sh
tailscale serve --bg --https=8443 http://127.0.0.1:4173
tailscale serve --bg --http=5173 http://127.0.0.1:4173
```

The install script verifies required files and the service unit, installs it under
`~/.config/systemd/user/`, enables it, restarts it, and checks `/healthz`. It does
not alter Tailscale configuration. The last two commands add HTTPS port 8443 and
HTTP port 5173. `--bg` persists the routes across session and daemon restarts.
Do not run `tailscale serve reset` or `tailscale funnel` for this deployment.

`HAI_ALLOWED_HOSTS=gogo.tailnet.example` permits the proxy's request hostname;
`HAI_ALLOWED_ORIGINS=https://gogo.tailnet.example:8443` permits that exact browser
origin. Localhost remains available for local checks. The API does not trust
forwarded headers to grant origins or host access.
HTTP port 5173 uses the request's matching origin,
`http://gogo.tailnet.example:5173`; it needs no additional origin allowance.

Python 3.11+ runs the service directly from the repository with no Python runtime
dependencies. Node is used for the frontend build and tests. Git must remain on
the service PATH for description-number history checks. SSH and GitHub sources
need credentials configured for the service account; see
[Python API and CLI](python-api-cli.md).

## Verify and inspect

```bash
export SHELL=/bin/bash
systemctl --user is-enabled hai.service
systemctl --user is-active hai.service
curl --fail http://127.0.0.1:4173/healthz
curl --fail http://gogo.tailnet.example:5173/healthz
curl --fail https://gogo.tailnet.example:8443/healthz
curl --fail --silent --output /dev/null https://gogo.tailnet.example:8443/
journalctl --user -u hai.service -n 50 --no-pager
```

Open the private URL from an allowed device and confirm that the repository's
actual task sections and descriptions load. Exercise writes against a temporary
tracker during automated tests; do not leave test tasks in the real tracker.
`/healthz` verifies that the configured tracker can be read and parsed.

## Redeploy

Keep `TASKS.md` and its linked descriptions. They are application data as well as
project documentation. Preserve a backup before changes to the parser or storage
format. The service checks source revisions and atomically replaces individual files;
a tracker plus description update is not a crash-atomic transaction across both files.
Refresh after a conflict before retrying an edit. Deploying a new frontend does not
require replacing the tracker.

```bash
export SHELL=/bin/bash
cd /home/agent/prg/hai
npm ci
npm run check
bash deploy/install-user-service.sh
curl --fail http://gogo.tailnet.example:5173/healthz
curl --fail https://gogo.tailnet.example:8443/healthz
```

The private Serve routes persist; ordinary redeployment does not recreate them.

The service unit sets `HAI_PROJECT_ROOTS=%h/prg:%h/repos`, so the project picker
opens trackers and backlog directories under `/home/agent/prg/` and
`/home/agent/repos/`. Edit the unit in `deploy/hai.service` and redeploy to allow
other server directories; the install script overwrites the installed unit. The configured Hai project remains allowed.
Paths entered in the browser refer to this server, and `~/` expands to the
service user's home directory. Each browser remembers its own selected project;
there is no shared current-project setting on the server.
To use a previously retained application build, restore its source and compatible
`dist/`, preserve current tracker data, and restart `hai.service`.

## Stop or remove access

```bash
export SHELL=/bin/bash
tailscale serve --https=8443 off
tailscale serve --http=5173 off
systemctl --user disable --now hai.service
```

This removes only Hai's two routes and stops its user service. It does not remove
tracker files or affect other services.
