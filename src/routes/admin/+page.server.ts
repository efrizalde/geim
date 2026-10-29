import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { registrationIsOpen, requireOwner, setRegistrationPolicy } from '#lib/server/admin.js';
import { getDb } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;
function pageNumber(value: string | null): number {
	const page = Number(value);
	return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireOwner(locals.user);
	const search = (url.searchParams.get('q') ?? '').trim().slice(0, 32);
	const page = pageNumber(url.searchParams.get('page'));
	const auditPage = pageNumber(url.searchParams.get('auditPage'));
	const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
	try {
		const db = getDb();
		const [registrationOpen, totals, statuses, users, audit] = await Promise.all([
			registrationIsOpen(),
			db.execute(
				sql`select (select count(*)::int from users) as users, (select count(*)::int from shared_profiles) as shares`
			),
			db.execute(
				sql`select connection_status as status, count(*)::int as count from linked_accounts group by connection_status order by connection_status`
			),
			db.execute(sql`select u.username, u.created_at as "createdAt", count(a.id)::int as "accountCount", max(a.last_synced_at) as "lastSyncedAt"
				from users u left join linked_accounts a on a.user_id = u.id
				where u.username ilike ${pattern} escape '\\'
				group by u.id order by u.created_at desc, u.id desc limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}`),
			db.execute(sql`select a.id, a.old_value as "oldValue", a.new_value as "newValue", a.created_at as "createdAt", u.username as actor
				from admin_audit a left join users u on u.id = a.actor_id
				order by a.created_at desc, a.id desc limit ${PAGE_SIZE + 1} offset ${(auditPage - 1) * PAGE_SIZE}`)
		]);
		return {
			failed: false as const,
			search,
			page,
			auditPage,
			registrationOpen,
			totals: totals.rows[0] as { users: number; shares: number },
			statuses: statuses.rows as { status: string; count: number }[],
			users: users.rows.slice(0, PAGE_SIZE) as {
				username: string;
				createdAt: string;
				accountCount: number;
				lastSyncedAt: string | null;
			}[],
			hasMoreUsers: users.rows.length > PAGE_SIZE,
			audit: audit.rows.slice(0, PAGE_SIZE) as {
				id: string;
				oldValue: boolean;
				newValue: boolean;
				createdAt: string;
				actor: string | null;
			}[],
			hasMoreAudit: audit.rows.length > PAGE_SIZE,
			retrievedAt: new Date().toISOString()
		};
	} catch {
		return { failed: true as const };
	}
};

export const actions: Actions = {
	registration: async ({ locals, request }) => {
		await requireOwner(locals.user);
		const form = await request.formData();
		const desired = form.get('open');
		if ((desired !== 'true' && desired !== 'false') || form.get('confirmed') !== 'yes') {
			return fail(400, { error: 'Confirm the registration change before continuing.' });
		}
		try {
			await setRegistrationPolicy(desired === 'true', locals.user!.id);
			return { success: 'Registration setting saved.' };
		} catch {
			return fail(503, { error: 'Could not save the registration setting. Try again.' });
		}
	}
};
