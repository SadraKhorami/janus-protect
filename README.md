<div align="center">

# Janus Protect

**Protection, licensing, and build infrastructure for WordPress products.**

[Documentation](https://janus.khorami.dev/docs) ·
[Report an issue](https://github.com/SadraKhorami/janus-protect/issues)

![Version](https://img.shields.io/github/package-json/v/SadraKhorami/janus-protect?style=flat-square&color=10b981)
![Node](https://img.shields.io/badge/node-%3E%3D20.19-339933?style=flat-square&logo=node.js&logoColor=white)
![WordPress](https://img.shields.io/badge/WordPress-plugins%20%26%20themes-21759b?style=flat-square&logo=wordpress&logoColor=white)

</div>

Janus Protect accepts WordPress plugin and theme ZIP files, validates their structure, builds a
protected artifact, and provides domain-bound licensing with an embedded WordPress license screen.
It is organized as a modular monolith and exposes a versioned HTTP API for automation.

## Features

- Safe ZIP inspection for traversal, symlinks, nested archives, duplicate paths, and unsafe sizes
- Immutable source revisions and asynchronous BullMQ builds
- PHP AST analysis and compatibility-focused local-variable obfuscation
- Signed integrity manifests and protected build artifacts
- License keys with activation limits, expiration, and normalized site binding
- Signed seven-day offline leases with daily renewal
- Fail-closed runtime enforcement that keeps protected product code unloaded without a valid lease
- A central **Janus Protect** license hub for every protected plugin and theme on the site
- Organization-scoped access with OWNER, ADMIN, DEVELOPER, and VIEWER roles
- Automated CI, database backup, migration, build, health check, and deployment from `main`

## Quick start

Requirements: Node.js 20.19+, pnpm 10.26, PHP 8.3, Composer, and Docker.

```bash
cp .env.example .env
docker compose up -d
pnpm install
composer install --working-dir=services/php-transformer
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Service         | Local address                    |
| --------------- | -------------------------------- |
| Web             | `http://localhost:3000`          |
| API and Swagger | `http://localhost:4000/api/docs` |
| Mailpit         | `http://localhost:8025`          |

The optional development seed is disabled in production and should only be used locally.

## Repository layout

```text
apps/web                 Next.js web application
apps/api                 NestJS HTTP API
apps/worker-build        BullMQ build worker
packages/                Shared contracts, config, database, queue, storage, and protection
services/php-transformer PHP AST analysis and transformation
deploy/                  Production Compose and PM2 definitions
scripts/                 Setup, deployment, backup, and release automation
docs/                    Detailed technical references and architecture decisions
```

## Development

Run the complete local verification suite before committing:

```bash
pnpm check
```

This checks formatting, linting, types, tests, and production builds across all workspaces.

## Deployment and releases

Every successful push to `main` is verified by GitHub Actions and then deployed to production as
the exact tested commit. The deployment creates a PostgreSQL backup, applies pending migrations,
builds the applications, reloads PM2, and verifies the public web application.

Version tags are reserved for formal GitHub releases:

```bash
pnpm release
```
