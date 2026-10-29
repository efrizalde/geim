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

Login attempts are limited in PostgreSQL across instances, both by client address and by username. Each bucket allows five attempts per minute, including successful attempts. If PostgreSQL is unavailable, sign-in fails closed. Ensure the deployment supplies a trustworthy client address; otherwise the fallback is one shared address bucket. Registration retains a per-process limiter; use an edge limit as well for public deployments. Review hosting, access control, backups, and secret management before exposing an instance to other users.

### Owner admin

The admin panel is disabled until an existing user has been provisioned and its UUID configured. Apply migrations first and back up the database before provisioning. From a private terminal connected to the intended database, run:

```bash
bun run scripts/provision-owner.ts <existing-username>
```

This resets that user's password to a random 32-character value and invalidates all their existing geim sessions. It prints the UUID and password once: store the password in a password manager, keep terminal output private, and never paste it into logs or tickets. Set `OWNER_USER_ID` to the printed UUID in the server's deployment configuration, redeploy, then sign in with the new password. The account menu links to Owner admin. Neither registration order nor a username grants owner access.

To rotate or recover owner access, run the same command for the intended existing account and update `OWNER_USER_ID` if it changed; doing so resets that account's password and invalidates its sessions. Remove `OWNER_USER_ID` and redeploy to disable the panel. Keep deployment configuration and database access restricted; possession of either is effectively administrative access. There is no MFA in this release.

The panel can pause new registrations without interrupting existing users. It logs each actual registration change with the actor and previous and new values. Retain audit records for 90 days initially; an operator should schedule a database cleanup such as `DELETE FROM admin_audit WHERE created_at < now() - interval '90 days'` according to local retention requirements. Similarly, expired login-attempt rows can be removed periodically with `DELETE FROM login_attempts WHERE reset_at < now() - interval '1 day'`.

Before deploying, apply the additive migrations and verify owner/non-owner access and cross-instance rate limiting in a separate environment. If rolling back to a version before the registration control while registration is paused, the old version ignores the setting; block registration at the edge first or explicitly reopen it. Migrations may remain in place during an application rollback.

This project uses unofficial Riot endpoints that may change or be restricted. It is not affiliated with or endorsed by Riot Games. VALORANT and Riot Games are trademarks of Riot Games, Inc.

## License

[MIT](LICENSE)
