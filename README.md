# Janus Protect

Janus Protect is an API-first platform for licensing, protecting, building, releasing, and
monitoring WordPress plugins and themes. Version 0.4 contains authentication, organization tenancy,
WordPress projects, hostile ZIP validation, immutable source revisions, protection profiles,
asynchronous builds, AST-based PHP analysis and local-variable obfuscation, signed integrity
manifests, protected artifacts, domain-bound licenses, signed offline leases, and an injected
WordPress license-management UI.

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

## WordPress licensing

Protected builds include a license page under **Settings → License** for plugins and
**Appearance → License** for themes. The SDK renews a signed seven-day offline lease daily and
never breaks the public site during a temporary API outage. Product code can gate premium features
with `apply_filters('janus_protect_license_valid', false, '<project-id>')`; an invalid license also
emits the `janus_protect_license_invalid` action.
