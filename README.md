# Tabloom

Tabloom is a privacy-first Chrome extension that turns the tabs in your current window into a reviewable, color-coded organization plan. The MVP uses deterministic local rules, requires no account or API key, and never closes tabs.

## What it does

- Reads the open tabs in the current Chrome window
- Shows a compact inventory with titles, sites, and favicons
- Classifies tabs into Work, Research, Learning, Shopping, Social, Personal, or Inbox
- Flags exact and tracking-parameter variants as likely duplicates
- Supports removable custom categories with selectable tab-group colors and remembers category corrections for matching pages
- Lets you open any category and select exactly which tabs belong under it
- Optionally refines uncertain results with Chrome's private, on-device Prompt API
- Preselects high-confidence grouping recommendations while leaving pinned tabs alone
- Lets you review and approve Chrome tab groups
- Keeps all tab metadata on-device

## Install for development

Requirements: Node.js 18+ and a Chromium-based browser.

```bash
npm install
npm run build
```

Then load the extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project's `dist` directory.
5. Pin Tabloom, open several tabs, and click its toolbar icon.

After making changes, run `npm run build`, then click the extension's refresh button on `chrome://extensions`.

## Development

```bash
npm run check
npm run build
```

The UI entry point is `src/main.ts`; Chrome operations live in the Manifest V3 service worker at `src/background.ts`.

## Plugging in an LLM later

Classification is isolated behind the `TabClassifier` interface in `src/classifier.ts`. A future remote classifier can implement the same interface and be selected by `createClassifier()` without changing the UI or Chrome message contract.

Before adding a provider, preserve the current privacy defaults: ask for explicit opt-in, minimize metadata, explain what leaves the device, and keep grouping behind user approval.

## Permissions

- `tabs`: inventory the current window and group approved tabs
- `tabGroups`: name and color the approved groups
- `storage`: reserved for future on-device preferences

Tabloom v1 does not request page-content access, browsing history, or permission to close tabs.

## Interface icons

Tabloom uses inline [Heroicons](https://heroicons.com/) under the MIT License. The SVGs are bundled directly, so the extension does not load an icon library or make network requests at runtime.
