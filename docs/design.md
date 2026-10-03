# Hai interface

Hai is an issue workspace for a product team. The first screen is a working issue list, with persistent navigation and direct access to creation, filters, and display options.

## Research

Reviewed October 3, 2026.

- [Linear product](https://linear.app/) shows a persistent workspace sidebar, compact issue metadata, and status-based boards. Hai uses that application hierarchy and an original wordmark.
- [Create issues](https://linear.app/docs/creating-issues) establishes the issue as the basic work item, with a team, sequential identifier, title, and status. Creation has a visible button and a keyboard shortcut.
- [Display options](https://linear.app/docs/display-options) separates filtering from presentation. Hai offers list and board layouts, status groups, sorting, and search.
- [Projects](https://linear.app/docs/projects) groups work around an outcome. Project cards expose progress and open their associated issues.
- [Cycles](https://linear.app/docs/use-cycles) describes time-boxed work periods. Hai shows cycle dates, completion, and assigned issues.

## Visual system

A 232px sidebar anchors a near-black canvas. Thin neutral borders separate navigation, a compact header, the toolbar, and 41px issue rows. Bright text carries titles; muted text carries identifiers and dates. Indigo marks the primary action and selection. Status colors remain confined to small icons and badges. Shared spacing, color, and radius variables keep dialogs, cards, menus, and inputs consistent.

The issue list is the default. Boards retain the same metadata in compact cards. Projects and cycles use modest summaries tied to actual issues. The command palette and issue dialog preserve the current workspace context. Settings explain each connector's configured state.

## Implementation sequence

1. Define shared tokens, navigation, controls, and responsive layout.
2. Build the grouped issue list and board against the same records.
3. Connect creation, issue edits, filtering, sorting, projects, cycles, inbox, and search.
4. Add connector settings, persistence feedback, loading, empty, and error states.
5. Verify the desktop and narrow layouts, keyboard navigation, dialog focus, and durable changes.

## Acceptance checks

- Every visible action changes a view, opens a working dialog, or persists a real edit.
- Creating an issue gives it an identifier and makes it visible in matching views.
- List and board render the same filtered records; editing status moves the record between groups.
- Project and cycle summaries derive from their issues.
- Dialogs trap focus, close with Escape, and return focus to their trigger.
- Search is accessible by button and keyboard shortcut. Typing in form controls does not trigger global shortcuts.
- At 390px, navigation opens as a drawer, the issue title remains readable, and dialogs fit the viewport. The board scrolls within its own region.
- Focus indicators, readable contrast, labeled icon buttons, and reduced-motion preferences are preserved.
- Loading, empty, error, and persistence feedback remain legible without color alone.

## Validation record

`npm run check` passed with 9 unit tests, 12 Chromium browser tests, and a production build. T3 preview automation was unavailable, so browser verification used Playwright with Chromium.

Final screenshots were visually reviewed at 1440px and 390px for the issue list, and at desktop width for the board, projects, integrations, and issue editor. Navigation, dense rows, card spacing, modal fields, and mobile controls rendered without blocking layout defects. The desktop menu button stays hidden; closed mobile navigation leaves the tab order. The main muted text tokens exceed 4.5:1 against panel backgrounds. Lightning CSS parsed and optimized the final stylesheet, and unused component rules were removed.
