import { neon } from '@neondatabase/serverless';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFile } from 'node:fs/promises';

interface SnapshotTable {
	name: string;
	columns: Record<
		string,
		{ name: string; type: string; notNull: boolean; primaryKey: boolean; default?: unknown }
	>;
	foreignKeys: Record<
		string,
		{ name: string; columnsFrom: string[]; tableTo: string; columnsTo: string[]; onDelete: string }
	>;
	uniqueConstraints: Record<string, { name: string; columns: string[] }>;
	indexes: Record<
		string,
		{
			name: string;
			columns: { expression: string; asc: boolean; nulls: string }[];
			isUnique: boolean;
			method: string;
		}
	>;
}

// For databases created before Drizzle migrations existed. Never use on a partially migrated DB.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED is required');
const sql = neon(url);
const snapshot = JSON.parse(await readFile('drizzle/meta/0001_snapshot.json', 'utf8')) as {
	tables: Record<string, SnapshotTable>;
};
const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
if (migrations.length !== 2) throw new Error('Expected exactly the baseline and cache migrations');

const [journal] = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
if (journal.name) throw new Error('Migration journal already exists; refusing to baseline');

const columns = await sql`select table_name, column_name, data_type, is_nullable, column_default
	from information_schema.columns where table_schema = 'public'`;
const constraints = await sql`select c.conrelid::regclass::text as table_name, c.conname as name,
	pg_get_constraintdef(c.oid) as definition from pg_constraint c
	where c.connamespace = 'public'::regnamespace and c.contype in ('p', 'f', 'u')`;
const indexes = await sql`select tablename as table_name, indexname as name, indexdef as definition
	from pg_indexes where schemaname = 'public'`;
const normalizeDefault = (value: unknown) => String(value ?? '').replace(/::text/g, '');
const problems: string[] = [];

for (const table of Object.values(snapshot.tables)) {
	const actualColumns = columns.filter((column) => column.table_name === table.name);
	for (const column of Object.values(table.columns)) {
		const actual = actualColumns.find((row) => row.column_name === column.name);
		if (
			!actual ||
			actual.data_type !== column.type ||
			(actual.is_nullable === 'NO') !== column.notNull ||
			normalizeDefault(actual.column_default) !== normalizeDefault(column.default)
		) {
			problems.push(`${table.name}.${column.name} differs or is missing`);
		}
		if (
			column.primaryKey &&
			!constraints.some(
				(row) => row.table_name === table.name && row.definition === `PRIMARY KEY (${column.name})`
			)
		) {
			problems.push(`${table.name}.${column.name} primary key differs or is missing`);
		}
	}
	for (const fk of Object.values(table.foreignKeys)) {
		const expected =
			`FOREIGN KEY (${fk.columnsFrom.join(', ')}) REFERENCES ${fk.tableTo}(${fk.columnsTo.join(', ')})` +
			(fk.onDelete === 'cascade' ? ' ON DELETE CASCADE' : '');
		if (
			!constraints.some(
				(row) =>
					row.table_name === table.name && row.name === fk.name && row.definition === expected
			)
		) {
			problems.push(`${table.name}.${fk.name} foreign key differs or is missing`);
		}
	}
	for (const unique of Object.values(table.uniqueConstraints)) {
		if (
			!constraints.some(
				(row) =>
					row.table_name === table.name &&
					row.name === unique.name &&
					row.definition === `UNIQUE (${unique.columns.join(', ')})`
			)
		) {
			problems.push(`${table.name}.${unique.name} unique constraint differs or is missing`);
		}
	}
	for (const index of Object.values(table.indexes)) {
		const expectedColumns = index.columns
			.map(
				(column) =>
					column.expression +
					(column.asc ? '' : ' DESC') +
					(!column.asc && column.nulls === 'last' ? ' NULLS LAST' : '')
			)
			.join(', ');
		const expected = `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${index.name} ON public.${table.name} USING ${index.method} (${expectedColumns})`;
		if (
			!indexes.some(
				(row) =>
					row.table_name === table.name && row.name === index.name && row.definition === expected
			)
		) {
			problems.push(`${table.name}.${index.name} index differs or is missing`);
		}
	}
}
if (problems.length)
	throw new Error(`Schema does not match migration snapshot:\n${problems.join('\n')}`);
if (!process.argv.includes('--apply')) {
	console.log('Schema matches the first two migrations. Run with --apply to record them.');
} else {
	await sql.transaction([
		sql`create schema if not exists drizzle`,
		sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
		...migrations.map(
			(migration) => sql`insert into drizzle.__drizzle_migrations (hash, created_at)
			values (${migration.hash}, ${migration.folderMillis})`
		)
	]);
	console.log('Recorded the verified baseline and cache migrations.');
}
