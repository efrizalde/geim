import { sql } from 'drizzle-orm';
import {
	index,
	boolean,
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
	displayUsername: text('display_username'),
	name: text('name').notNull().default(''),
	email: text('email')
		.notNull()
		.unique()
		.default(sql`(gen_random_uuid()::text || '@users.geim.local')`),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	passwordHash: text('password_hash').notNull().default(''),
	displayCurrency: text('display_currency').notNull().default('IDR'),
	purchaseRegion: text('purchase_region').notNull().default('ID'),
	ownerPasswordReady: boolean('owner_password_ready').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_user_id_idx').on(table.userId)]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('account_user_id_idx').on(table.userId),
		uniqueIndex('account_provider_account_idx').on(table.providerId, table.accountId),
		uniqueIndex('account_user_provider_idx').on(table.userId, table.providerId)
	]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const passkey = pgTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull().unique(),
		counter: integer('counter').notNull().default(0),
		deviceType: text('device_type').notNull(),
		backedUp: boolean('backed_up').notNull().default(false),
		transports: text('transports'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
		aaguid: text('aaguid')
	},
	(table) => [
		index('passkey_user_id_idx').on(table.userId),
		index('passkey_credential_id_idx').on(table.credentialID)
	]
);

export const adminSettings = pgTable('admin_settings', {
	key: text('key').primaryKey(),
	registrationOpen: boolean('registration_open').notNull().default(true),
	changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const adminAudit = pgTable('admin_audit', {
	id: uuid('id').defaultRandom().primaryKey(),
	actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
	oldValue: boolean('old_value').notNull(),
	newValue: boolean('new_value').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const loginAttempts = pgTable('login_attempts', {
	key: text('key').primaryKey(),
	count: integer('count').notNull(),
	resetAt: timestamp('reset_at', { withTimezone: true }).notNull()
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
