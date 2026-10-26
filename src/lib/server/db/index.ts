import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

let cachedDb: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Lazily initialize the Neon HTTP Drizzle client so importing server modules during
 * builds, unit tests, or initial setup does not throw before a query executes.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
	if (cachedDb) return cachedDb;
	if (!DATABASE_URL) {
		throw new Error('DATABASE_URL is not configured. Set your Neon connection string in .env.');
	}

	const client = neon(DATABASE_URL);
	cachedDb = drizzle(client, { schema });
	return cachedDb;
}

export { schema };
