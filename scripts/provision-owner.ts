import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { hashPassword, validateUsername } from '../src/lib/server/auth/password';

const username = validateUsername(process.argv[2]);
if (!username.ok) throw new Error('Usage: bun run scripts/provision-owner.ts <existing-username>');
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required');
const db = neon(url);
const password = randomBytes(24).toString('base64url');
const hash = await hashPassword(password);
const rows = await db`
	WITH updated AS (
		UPDATE users SET password_hash = ${hash}, owner_password_ready = true, updated_at = now()
		WHERE username = ${username.value} RETURNING id
	), revoked AS (
		DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM updated) RETURNING user_id
	)
	SELECT id, (SELECT count(*) FROM revoked) AS revoked_sessions FROM updated
`;
if (!rows[0]) throw new Error('User not found; no changes made.');
console.log(
	`Owner user ID: ${rows[0].id}\nNew password (save it securely now): ${password}\nExisting sessions revoked: ${rows[0].revoked_sessions}`
);
