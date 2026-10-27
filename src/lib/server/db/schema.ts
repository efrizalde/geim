import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import type { SharedProfileSnapshot } from '../sharing';

export const users = pgTable('users', {
	id: uuid('id').defaultRandom().primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayCurrency: text('display_currency').notNull().default('IDR'),
	purchaseRegion: text('purchase_region').notNull().default('ID'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const appSessions = pgTable(
	'app_sessions',
	{
		id: text('id').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('app_sessions_expires_idx').on(table.expiresAt)]
);

/**
 * Small durable key-value store for cross-process caches (VALORANT metadata index, FX rates)
 * so cold serverless instances can render saved data without re-downloading public catalogs.
 */
export const appState = pgTable('app_state', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const linkedAccounts = pgTable(
	'linked_accounts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		game: text('game').notNull().default('valorant'),
		puuid: text('puuid').notNull(),
		gameName: text('game_name').notNull(),
		tagLine: text('tag_line').notNull(),
		region: text('region').notNull(),
		shard: text('shard').notNull(),
		authMode: text('auth_mode').notNull().default('cookie_jar'),
		connectionStatus: text('connection_status').notNull().default('connected'),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		syncLockedUntil: timestamp('sync_locked_until', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('linked_accounts_owner_game_puuid_idx').on(table.userId, table.game, table.puuid)
	]
);

export const providerSessions = pgTable('provider_sessions', {
	linkedAccountId: uuid('linked_account_id')
		.primaryKey()
		.references(() => linkedAccounts.id, { onDelete: 'cascade' }),
	sealedPayload: text('sealed_payload').notNull(),
	keyVersion: integer('key_version').notNull().default(1),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
	lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }),
	renewalLockedUntil: timestamp('renewal_locked_until', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const sharedProfiles = pgTable('shared_profiles', {
	token: text('token').primaryKey(),
	linkedAccountId: uuid('linked_account_id')
		.notNull()
		.unique()
		.references(() => linkedAccounts.id, { onDelete: 'cascade' }),
	snapshot: jsonb('snapshot').$type<SharedProfileSnapshot>().notNull(),
	publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow()
});

export const storeSnapshots = pgTable(
	'store_snapshots',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		linkedAccountId: uuid('linked_account_id')
			.notNull()
			.references(() => linkedAccounts.id, { onDelete: 'cascade' }),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
		dailyExpiresAt: timestamp('daily_expires_at', { withTimezone: true }).notNull(),
		bonusExpiresAt: timestamp('bonus_expires_at', { withTimezone: true }),
		offersJson: jsonb('offers_json').notNull(),
		walletJson: jsonb('wallet_json'),
		parserVersion: integer('parser_version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('store_snapshots_account_fetched_idx').on(table.linkedAccountId, table.fetchedAt.desc())
	]
);

export const inventorySnapshots = pgTable(
	'inventory_snapshots',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		linkedAccountId: uuid('linked_account_id')
			.notNull()
			.references(() => linkedAccounts.id, { onDelete: 'cascade' }),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
		skinLevelIdsJson: jsonb('skin_level_ids_json').notNull(),
		chromaIdsJson: jsonb('chroma_ids_json').notNull(),
		buddyCount: integer('buddy_count'),
		matchesJson: jsonb('matches_json'),
		parserVersion: integer('parser_version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('inventory_snapshots_account_fetched_idx').on(
			table.linkedAccountId,
			table.fetchedAt.desc()
		)
	]
);

export const trackerSnapshots = pgTable(
	'tracker_snapshots',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		linkedAccountId: uuid('linked_account_id')
			.notNull()
			.references(() => linkedAccounts.id, { onDelete: 'cascade' }),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
		profileJson: jsonb('profile_json').notNull(),
		matchesJson: jsonb('matches_json').notNull(),
		parserVersion: integer('parser_version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('tracker_snapshots_account_fetched_idx').on(table.linkedAccountId, table.fetchedAt.desc())
	]
);
