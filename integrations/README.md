# Integrations for automation builders

Both talk to the public API (`/api/v1`, see `/docs/api` in the app) with an API key from **Settings → API**.

| Folder | What | Tested |
| --- | --- | --- |
| `n8n-nodes-firstline-email/` | n8n community node (declarative): Lead → Personalise, Job → Get, Credit → Get Balance | `n8n-node lint` and `n8n-node build` pass; n8n's package scanner rules pass on the source and the build; ran in a real n8n 2.47.4 (Docker) against `scripts/api-sandbox.ts` (see below). |
| `make-app/` | Make custom app as files (base, connection, 4 modules) | `make-app.test.ts` (in `npm test`). Not run inside Make yet: that needs a Make account. |

## Test locally without the real database

```bash
npx tsx scripts/api-sandbox.ts 3999
```

This starts a throwaway API (embedded Postgres, every migration, the real `/api/v1` code, the real engine with test output instead of AI). It writes a sandbox API key to a temp file and prints where. Point n8n or Make at `http://localhost:3999` (from Docker: `http://host.docker.internal:3999`).

## Publishing the n8n node (n8n rules, checked 2026-11-11)

n8n only verifies community nodes that are:
- in a **public** GitHub repository whose URL matches `repository.url` in package.json, with the MIT license
- published to npm **from GitHub Actions with provenance** (required since 1 May 2026), using `@n8n/node-cli` 0.23 or later
- free of runtime dependencies, English only, and passing `npx @n8n/scan-community-package n8n-nodes-firstline-email`

Steps:
1. Create a public GitHub repo `n8n-nodes-firstline-email` and copy this folder's contents into it (without `node_modules` and `dist`).
2. Replace `OWNER` / `OWNER_EMAIL` in `package.json`, `README.md`, `credentials/FirstLineApi.credentials.ts` and `nodes/FirstLine/FirstLine.node.json`.
3. On npmjs.com: create the package's trusted publisher (GitHub Actions, your repo, workflow `publish.yml`), or add an `NPM_TOKEN` secret to the repo.
4. Locally in the repo: `npm ci`, then `npm run release`. It lints, builds, bumps the version, tags and pushes; the tag runs `.github/workflows/publish.yml`, which publishes with provenance.
5. Check it: `npx @n8n/scan-community-package n8n-nodes-firstline-email`.
6. Submit at https://creators.n8n.io/nodes. The review can take up to four weeks.

The name `n8n-nodes-firstline` is taken on npm by another company called Firstline (firstline.sh), so this package is `n8n-nodes-firstline-email`.
