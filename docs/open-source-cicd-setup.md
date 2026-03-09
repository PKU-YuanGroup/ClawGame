# Open Source CI/CD Setup (Safe for Public Repos)

This guide configures:
- open contribution via pull requests
- automatic production deploy on `main`
- no secrets or production user data exposed to contributors

## 1) Add GitHub secrets

In GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The token should have least privilege for this project only (Workers + KV needed for deploy).

## 2) Create and bind KV namespaces

Run locally (inside `worker/`):

```bash
npx wrangler kv namespace create APP_KV --env production
npx wrangler kv namespace create APP_KV --env preview
npx wrangler kv namespace create APP_KV
npx wrangler kv namespace create APP_KV --preview
```

Copy the returned IDs into `worker/wrangler.toml`:
- `REPLACE_WITH_PROD_KV_ID`
- `REPLACE_WITH_PREVIEW_KV_ID`
- `REPLACE_WITH_LOCAL_KV_ID`
- `REPLACE_WITH_LOCAL_PREVIEW_KV_ID`

## 3) Set worker secrets (do not commit)

Run locally:

```bash
cd worker
npx wrangler secret put GITHUB_CLIENT_ID --env production
npx wrangler secret put GITHUB_CLIENT_SECRET --env production

npx wrangler secret put GITHUB_CLIENT_ID --env preview
npx wrangler secret put GITHUB_CLIENT_SECRET --env preview
```

For local dev only, create `worker/.dev.vars`:

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
APP_BASE_URL=http://127.0.0.1:8787
```

## 4) Configure GitHub environment protection

In GitHub repo -> `Settings` -> `Environments` -> create `production`:
- add `Required reviewers` (maintainers)
- optional: restrict deployment branches to `main`

This ensures even `main` deploys need approved maintainers.

## 5) Branch protection for `main`

In GitHub repo -> `Settings` -> `Branches` -> add protection rule for `main`:
- require pull request before merge
- require status checks to pass (`CI / checks`)
- require conversation resolution before merge

## 6) Workflow behavior

- `.github/workflows/ci.yml`
  - runs on pull requests
  - no Cloudflare credentials used
  - only lint/build/typecheck
- `.github/workflows/deploy.yml`
  - runs on push to `main`
  - deploys with `wrangler deploy --env production`
  - reads credentials from GitHub Secrets only

## 7) Security rules to keep

- Do not use `pull_request_target` to run untrusted PR code with secrets.
- Never log tokens/session cookies/user PII in CI output.
- Keep production data and preview data in different namespaces.
