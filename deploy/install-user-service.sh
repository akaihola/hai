#!/usr/bin/env bash
set -euo pipefail
export SHELL=/bin/bash

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$repo_root" != /home/agent/prg/hai ]]; then
  printf '%s\n' 'This unit targets /home/agent/prg/hai on gogo. Update deploy/hai.service before installing elsewhere.' >&2
  exit 1
fi
for path in dist/index.html server/index.ts TASKS.md node_modules/tsx/package.json; do
  if [[ ! -f "$repo_root/$path" ]]; then
    printf 'Missing %s. Install dependencies and build Hai before deployment.\n' "$path" >&2
    exit 1
  fi
done
if [[ ! -x /etc/profiles/per-user/agent/bin/node ]]; then
  printf '%s\n' 'The configured Node executable is unavailable.' >&2
  exit 1
fi
systemd-analyze --user verify "$repo_root/deploy/hai.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p -- "$unit_dir"
install -m 644 "$repo_root/deploy/hai.service" "$unit_dir/hai.service"
systemctl --user daemon-reload
systemctl --user enable hai.service
systemctl --user restart hai.service
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:4173/healthz; then
    printf '%s\n' 'Hai is healthy at http://127.0.0.1:4173. Configure the private Tailscale route as documented in docs/deployment.md.'
    exit 0
  fi
  sleep 0.5
done
printf '%s\n' 'Hai did not become healthy. Inspect: journalctl --user -u hai.service -n 50 --no-pager' >&2
exit 1
