import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const HASH_PREFIX = 'scryptv1';

export const MIN_PASSWORD_LENGTH = 4;

export type PasswordValidationResult = { ok: true; value: string } | { ok: false; error: string };

export function validatePassword(input: unknown): PasswordValidationResult {
	if (typeof input !== 'string' || input.length < MIN_PASSWORD_LENGTH) {
		return {
			ok: false,
			error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
		};
	}
	if (input.length > 128) return { ok: false, error: 'Password must be at most 128 characters.' };
	return { ok: true, value: input };
}

export function validateUsername(input: unknown): PasswordValidationResult {
	if (typeof input !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(input.trim())) {
		return { ok: false, error: 'Username must be 3-32 letters, numbers, or underscores.' };
	}
	return { ok: true, value: input.trim().toLowerCase() };
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scryptCallback(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
			if (err) reject(err);
			else resolve(derivedKey);
		});
	});
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const derived = await deriveScryptKey(password, salt);
	return `${HASH_PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	const parts = storedHash.split('$');
	if (parts.length !== 3 || parts[0] !== HASH_PREFIX) {
		return false;
	}

	const salt = Buffer.from(parts[1], 'hex');
	const expected = Buffer.from(parts[2], 'hex');
	if (salt.length !== SALT_BYTES || expected.length !== KEY_LENGTH) {
		return false;
	}

	const actual = await deriveScryptKey(password, salt);
	return timingSafeEqual(actual, expected);
}
