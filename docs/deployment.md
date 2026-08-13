# Production deployment

Janus Protect includes a repeatable Ubuntu deployment flow. Production secrets are never stored in
Git.

## First server setup

Run as root on a clean Ubuntu server:

```bash
git clone https://github.com/SadraKhorami/janus-protect.git /opt/janus-protect
cd /opt/janus-protect
scripts/setup-server.sh
```

The setup script installs Node.js, pnpm, PHP, Composer, Docker and PM2. It also creates `.env` and
`.infra.env` from the tracked examples and stops before deployment while placeholder values remain.
Edit both files, then run:

```bash
scripts/deploy.sh --ref main
```

For a production release, deploy an immutable version tag instead:

```bash
scripts/deploy.sh --ref v0.5.0
```

## What deployment does

The deployment script fetches the selected branch or tag, starts PostgreSQL, Redis and MinIO,
installs locked Node.js and PHP dependencies, generates Prisma Client, applies pending migrations,
builds the API, worker and web application, reloads PM2 and verifies API and web health. A failed
application deployment restores and rebuilds the previously running commit. Database migrations are
forward-only and must remain backward compatible with the previous application during a rollout.

The tracked files under `deploy/` contain no real credentials. Keep these server files private and
mode `0600`:

```text
/opt/janus-protect/.env
/opt/janus-protect/.infra.env
```

## Continuous integration

GitHub Actions runs formatting, linting, type-checking, tests and a full production build for every
push and pull request targeting `main`.

To publish the version already declared in all `package.json` files, run from a clean and synchronized
`main` branch:

```bash
pnpm release
```

This runs the complete local check and pushes an annotated version tag. GitHub Actions independently
verifies the tag, creates a PostgreSQL backup, deploys that exact revision, checks the internal and
public application, and publishes generated GitHub release notes. Normal pushes never deploy
production.
