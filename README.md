# Snap Status

A compact maintenance dashboard for snaps published by [`popey`](https://snapcraft.io/publisher/popey). It compares the versions in `stable`, `candidate`, `beta`, and `edge` against each project's latest upstream release. The interface is built with [Canonical Vanilla Framework](https://vanillaframework.io/) to match the Ubuntu and Snap ecosystem.

## What it does

- Discovers the current public Snap Store inventory for publisher `popey`.
- Retains explicitly configured snaps that are temporarily unpublished.
- Collapses architecture-specific Store revisions while exposing version variants.
- Fetches upstream versions from GitHub, Codeberg, and npm.
- Classifies each snap as:
  - **Current** — stable has reached upstream.
  - **In testing** — candidate, beta, or edge has reached upstream.
  - **Update needed** — every published channel is behind upstream.
  - **Needs mapping** — upstream cannot be compared reliably.
- Supports search, status filters, sortable columns, responsive layouts, and accessible reduced-motion behavior.
- Refreshes and deploys hourly without making automated data commits.

## Architecture

```text
Snap Store API ─┐
GitHub API ─────┼─ scripts/collect.py ─ public/data.json ─ Vite static app
Codeberg API ───┤                                      └─ Cloudflare Workers Assets
npm registry ───┘
```

The maintained-snap and upstream-provider map lives in [`config/snaps.json`](config/snaps.json). Missing or unusual upstreams are displayed as unknown rather than guessed.

## Local development

Requirements: Node.js 24+ and Python 3.11+.

```bash
npm ci --ignore-scripts
GITHUB_TOKEN="$(gh auth token)" npm run collect
npm run verify
npm run dev
```

The collector only needs `GITHUB_TOKEN` to avoid the unauthenticated GitHub API rate limit; it does not need Snap Store credentials.

## Deployment

The app uses Cloudflare Workers Static Assets. [`wrangler.jsonc`](wrangler.jsonc) declares `snaps.popey.com` as a custom domain.

GitHub Actions requires these repository secrets:

- `CLOUDFLARE_API_TOKEN` — token with Workers Scripts edit and zone route/domain permissions.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

After setting both secrets, set the repository variable `CLOUDFLARE_DEPLOY_ENABLED` to `true`. Until then, scheduled deployment jobs are cleanly skipped rather than failing every hour.

The **Refresh and deploy** workflow runs at minute 17 each hour, generates data inside the runner, verifies the project, and deploys it directly. It never commits generated data back to the repository.

## Verification

```bash
npm run test            # version and status logic
npm run test:collector  # Store channel collapsing and provider parsing
npm run check           # TypeScript
npm run build           # production static assets
npm audit --audit-level=high
```

## License

MIT
