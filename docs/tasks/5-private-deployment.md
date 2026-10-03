---
depends-on: [4]
---

# Deploy Hai privately on gogo

Run the built frontend and local Node API as a persistent user systemd service,
reading `/home/agent/prg/hai/TASKS.md`. Bind the API to `127.0.0.1:4173` and expose
only a private Tailscale HTTPS route on port 8443. Preserve all existing Serve routes.

Use the stable installed Node path, restart on failure, and document install,
health checks, logs, redeployment, and shutdown. Verify the production build and
tests before activation, then check API and frontend access through the private URL.
Deployment does not constitute user acceptance.

## Completed 2026-10-03

Enabled and started `hai.service`, with private access at
<https://gogo.tailnet.example:8443>. Existing Tailscale routes were preserved.
Local and HTTPS health, frontend, and workspace requests returned HTTP 200.
Production desktop/mobile checks and real tracker writes passed without browser
errors. Installation, redeployment, and shutdown are in [deployment.md](../deployment.md).

## Follow-up 2026-10-03

The original HTTP port 5173 still depended on a temporary Vite process and stopped
working when it exited. Added a persistent private HTTP route to the same
production service. Verified access and writes after Vite shutdown; HTTPS port
8443 remains available. The repair is tracked separately in TASKS.md.
