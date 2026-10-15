#!/usr/bin/env bash
# Restart the Hai user service after a build and wait for it to become healthy.
# The unit itself is declared in nixos-config (home-manager/features/hai-gogo.nix)
# and applied with that repository's rebuild workflow; nothing is installed here.
set -euo pipefail
export SHELL=/bin/bash

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
for path in dist/index.html hai_server/__main__.py hai_tasks/store.py TASKS.md; do
  if [[ ! -f "$repo_root/$path" ]]; then
    printf 'Missing %s. Install dependencies and build Hai before restarting.\n' "$path" >&2
    exit 1
  fi
done
if [[ ! -f "$HOME/.config/hai/hai.env" ]]; then
  printf '%s\n' 'Write HAI_ALLOWED_HOSTS and HAI_ALLOWED_ORIGINS to ~/.config/hai/hai.env first; see docs/deployment.md.' >&2
  exit 1
fi
if ! systemctl --user cat hai.service >/dev/null 2>&1; then
  printf '%s\n' 'hai.service is not installed. Apply nixos-config (home-manager/features/hai-gogo.nix) first.' >&2
  exit 1
fi
systemctl --user restart hai.service
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:4173/healthz; then
    printf '%s\n' 'Hai is healthy at http://127.0.0.1:4173.'
    exit 0
  fi
  sleep 0.5
done
printf '%s\n' 'Hai did not become healthy. Inspect: journalctl --user -u hai.service -n 50 --no-pager' >&2
exit 1
