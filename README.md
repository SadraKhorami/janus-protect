# Janus Protect

Janus Protect is an API-first platform for licensing, protecting, building, releasing, and
monitoring WordPress plugins and themes. The repository currently contains the Milestone 1
foundation: authentication, organization tenancy, local infrastructure, shared contracts, and a
minimal web application.

## Local setup

1. Copy `.env.example` to `.env`.
2. Start local services with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Generate the Prisma client and apply migrations with `pnpm db:generate && pnpm db:migrate`.
5. Start the API and web application with `pnpm dev`.

The web app is available at `http://localhost:3000`, the API documentation at
`http://localhost:4000/api/docs`, and Mailpit at `http://localhost:8025`.

Run `pnpm check` before submitting changes.
