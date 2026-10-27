import { defineEnvVars } from '@sveltejs/kit/env';

const optionalNonEmpty = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Pooled Neon Serverless PostgreSQL connection string.',
		schema: optionalNonEmpty
	},
	DATABASE_URL_UNPOOLED: {
		description: 'Direct (unpooled) Neon PostgreSQL connection string for migrations.',
		schema: optionalNonEmpty
	},
	ENCRYPTION_MASTER_KEY: {
		description: '64-character hex master key (32 bytes) for AES-256-GCM Riot session encryption.',
		schema: optionalNonEmpty
	},
	HENRIKDEV_API_KEY: {
		description:
			'Optional HenrikDev API key (HDEV-...) for rich VALORANT tracker & stored match history.',
		schema: optionalNonEmpty
	}
});
