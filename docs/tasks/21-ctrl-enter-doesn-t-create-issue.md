Pressing Ctrl+Enter in the `Description` field of the `New issue` dialog doesn't always select the `Create issue` button. Sometimes it does, but often not.
Validation: `npm run check` passed 32 Python tests, 89 client/API tests,
TypeScript, the production build and all 58 Chromium workflows. The first run
hit the existing oversized-request EPIPE failure; the complete rerun passed
without changing that test.

Implementation: the Description textarea had no submission shortcut. Ctrl+Enter
and Cmd+Enter now request normal form submission, preserving title validation
and the existing backend save path. Plain Enter inserts a newline. Composing
and repeated key events do not submit; unsupported saves and saves already in
progress are guarded.

Merged into main and deployed. Loopback, private HTTP and private HTTPS passed
health and exact validated HTML/asset checks. The private HTTPS collaborative
browser created exactly one temporary browser-local issue with Ctrl+Enter from
Description and closed the dialog. Browser storage was restored afterwards.
