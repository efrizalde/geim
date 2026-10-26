import { defineConfig } from 'drizzle-kit';

const migrationUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!migrationUrl) {
	throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED must be set');
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: migrationUrl },
	verbose: true,
	strict: true
});
