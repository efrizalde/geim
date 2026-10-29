import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';

// Count every attempt, including successful ones, so concurrent requests cannot bypass the limit.
export async function consumeLoginAttempt(kind: 'ip' | 'user', value: string): Promise<boolean> {
	const key = createHash('sha256').update(`${kind}:${value}`).digest('hex');
	const result = await getDb().execute(sql`
		insert into login_attempts (key, count, reset_at) values (${key}, 1, now() + interval '1 minute')
		on conflict (key) do update set
			count = case when login_attempts.reset_at <= now() then 1 else login_attempts.count + 1 end,
			reset_at = case when login_attempts.reset_at <= now() then now() + interval '1 minute' else login_attempts.reset_at end
		returning count
	`);
	return Number(result.rows[0]?.count) <= 5;
}
