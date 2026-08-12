# Janus Protect

Janus Protect is an API-first platform for licensing, protecting, building, releasing, and
monitoring WordPress plugins and themes. Version 0.2 contains authentication, organization tenancy,
WordPress projects, hostile ZIP validation, immutable source revisions, protection profiles,
asynchronous builds, AST-based PHP analysis, signed integrity manifests, and protected artifacts.

## Local setup

1. Copy `.env.example` to `.env`.
2. Start local services with `docker compose up -d`.
3. Install dependencies with `pnpm install` and
   `composer install --working-dir=services/php-transformer`.
4. Generate the Prisma client and apply migrations with `pnpm db:generate && pnpm db:migrate`.
5. Create the local development account with `pnpm db:seed`.
6. Start the API, web application, and build worker with `pnpm dev`.

The web app is available at `http://localhost:3000`, the API documentation at
`http://localhost:4000/api/docs`, and Mailpit at `http://localhost:8025`.

The default development login is `admin@khorami.dev` with password `JanusProtect123!`. The seed is
idempotent and refuses to run when `NODE_ENV=production`.

Production code changes require a root semantic-version bump. Install the repository pre-push
guard with `pnpm hooks:install`; pull requests are checked by the same rule in CI.

Run `pnpm check` before submitting changes.
