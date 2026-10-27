import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from './db';
import { loadDashboardView } from './providers/valorant/service';
import { summarizeMatchStats, type HydratedMatchItem } from './providers/valorant/tracker';
import type { SupportedCurrency } from './valuation/money';

type Dashboard = Awaited<ReturnType<typeof loadDashboardView>>;

export function summarizeSharedStats(matches: HydratedMatchItem[]) {
	return summarizeMatchStats(matches);
}

export type SharedStats = ReturnType<typeof summarizeSharedStats>;

export interface SharedProfileSnapshot {
	account: {
		gameName: string;
		tagLine: string;
		shard: string;
		lastSyncedAt: string;
	};
	profile: Dashboard['profile'];
	inventory: Dashboard['inventory'];
	stats: SharedStats;
	vpIconUrl: string;
}

export function createSharedProfileSnapshot(dashboard: Dashboard): SharedProfileSnapshot | null {
	const account = dashboard.activeAccount;
	if (!account?.lastSyncedAt) return null;
	// Copy only published fields, never sibling accounts, wallet, or provider session state.
	return {
		account: {
			gameName: account.gameName,
			tagLine: account.tagLine,
			shard: account.shard,
			lastSyncedAt: account.lastSyncedAt
		},
		profile: dashboard.profile,
		inventory: dashboard.inventory,
		stats: dashboard.tracker?.stats ?? summarizeSharedStats([]),
		vpIconUrl: dashboard.currencyIcons.vp
	};
}

export async function getProfileShare(userId: string, accountId: string) {
	const [share] = await getDb()
		.select({ token: schema.sharedProfiles.token, publishedAt: schema.sharedProfiles.publishedAt })
		.from(schema.sharedProfiles)
		.innerJoin(
			schema.linkedAccounts,
			eq(schema.linkedAccounts.id, schema.sharedProfiles.linkedAccountId)
		)
		.where(and(eq(schema.linkedAccounts.userId, userId), eq(schema.linkedAccounts.id, accountId)))
		.limit(1);
	return share
		? { path: `/share/${share.token}`, publishedAt: share.publishedAt.toISOString() }
		: null;
}

export async function publishSharedProfile(
	userId: string,
	accountId: string,
	currency: SupportedCurrency
): Promise<string | null> {
	if (!z.uuid().safeParse(accountId).success) return null;
	const db = getDb();
	const [ownedAccount] = await db
		.select({ id: schema.linkedAccounts.id })
		.from(schema.linkedAccounts)
		.where(and(eq(schema.linkedAccounts.id, accountId), eq(schema.linkedAccounts.userId, userId)))
		.limit(1);
	if (!ownedAccount) return null;

	// Full skin detail stays embedded so the published snapshot stays self-contained.
	const dashboard = await loadDashboardView(userId, currency, accountId, { fullSkinDetail: true });
	if (dashboard.activeAccount?.id !== accountId) return null;
	const snapshot = createSharedProfileSnapshot(dashboard);
	if (!snapshot) return null;

	const [share] = await db
		.insert(schema.sharedProfiles)
		.values({
			token: randomBytes(24).toString('base64url'),
			linkedAccountId: accountId,
			snapshot,
			publishedAt: new Date()
		})
		.onConflictDoUpdate({
			target: schema.sharedProfiles.linkedAccountId,
			set: { snapshot, publishedAt: new Date() }
		})
		.returning({ token: schema.sharedProfiles.token });
	return `/share/${share.token}`;
}

export async function loadSharedProfile(token: string) {
	if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
	const [share] = await getDb()
		.select({
			snapshot: schema.sharedProfiles.snapshot,
			publishedAt: schema.sharedProfiles.publishedAt
		})
		.from(schema.sharedProfiles)
		.where(eq(schema.sharedProfiles.token, token))
		.limit(1);
	if (!share) return null;
	// Older publications may contain match records; never serialize those to public visitors.
	const saved = share.snapshot as SharedProfileSnapshot & { tracker?: Dashboard['tracker'] };
	const snapshot: SharedProfileSnapshot = {
		account: {
			gameName: saved.account.gameName,
			tagLine: saved.account.tagLine,
			shard: saved.account.shard,
			lastSyncedAt: saved.account.lastSyncedAt
		},
		profile: saved.profile,
		inventory: saved.inventory,
		stats: saved.stats ?? summarizeSharedStats(saved.tracker?.matches ?? []),
		vpIconUrl: saved.vpIconUrl
	};
	return { snapshot, publishedAt: share.publishedAt.toISOString() };
}
