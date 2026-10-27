# geim

A self-hosted VALORANT dashboard for viewing your daily shop, owned weapon skins, collection valuation, and match history.

## Features

- View daily shop offers, Night Market offers, and wallet balances.
- Browse owned weapon skins, upgrade levels, and variants; inspect supported skins in the 3D viewer.
- Estimate collection value from known catalog prices and a regional VP pack baseline. Estimates are not actual spending or resale values.
- Review saved match history, rank information, and performance statistics. An optional HenrikDev API key can supplement match history.
- Link multiple Riot accounts and publish a read-only profile snapshot. Published links are accessible without signing in and do not include wallet balances, credentials, or individual matches.

## Requirements

- [Bun](https://bun.sh/) 1.x
- A [Neon PostgreSQL](https://neon.tech/) database
- A Riot account you own

The app uses SvelteKit, Svelte, TypeScript, Drizzle ORM, and Tailwind CSS. The included deployment adapter targets Vercel.

## Getting started

```bash
bun install
cp .env.example .env
```

Set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to your Neon connection strings. Set `ENCRYPTION_MASTER_KEY` to a 32-byte hexadecimal key, generated for example with:

```bash
bun -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Keep this key and the database credentials private. Losing or changing the key makes existing encrypted Riot sessions unreadable. `HENRIKDEV_API_KEY` is optional.

For a new database, apply the migrations and start the app:

```bash
bun run db:migrate
bun run dev
```

Open the local URL printed by the dev server, register a geim account, and link a Riot account. Riot authentication may be blocked by upstream CAPTCHA or network restrictions; the app does not bypass those challenges.

For an existing database created before migrations were tracked, run `bun run scripts/baseline-migrations.ts` to verify it against the first two migration snapshots. Only if it matches, run the same command with `--apply` to record them, then run `bun run db:migrate`. Do not use the baseline command for a new database or one with an existing migration journal.

## Development

| Command                  | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `bun run dev`            | Start the development server                     |
| `bun run check`          | Run Svelte and TypeScript checks                 |
| `bun run test`           | Run the test suite                               |
| `bun run lint`           | Check formatting and lint rules                  |
| `bun run build`          | Create a production build                        |
| `bun run db:generate`    | Generate a migration from schema changes         |
| `bun run db:migrate`     | Apply migrations                                 |
| `bun run db:studio`      | Open Drizzle Studio                              |
| `bun run spike:valorant` | Run the interactive Riot connectivity diagnostic |

## Security and deployment

Riot session material is encrypted at rest with AES-256-GCM and handled by server-side code. Shared profile links are public to anyone who has the URL; publish only information you intend to share.

The login and registration rate limiter is currently per process. A public deployment running multiple instances needs a shared rate limiter or equivalent protection at the edge. Review hosting, access control, backups, and secret management before exposing an instance to other users.

This project uses unofficial Riot endpoints that may change or be restricted. It is not affiliated with or endorsed by Riot Games. VALORANT and Riot Games are trademarks of Riot Games, Inc.

## License

[MIT](LICENSE)
