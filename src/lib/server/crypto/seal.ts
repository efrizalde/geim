import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_HEX_LENGTH = 64; // 32 bytes

function decodeMasterKey(hexKey: string): Buffer {
	const normalized = hexKey.trim();
	if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
		throw new Error(
			`ENCRYPTION_MASTER_KEY must be a ${KEY_HEX_LENGTH}-character hex string (32 bytes).`
		);
	}
	return Buffer.from(normalized, 'hex');
}

/**
 * Encrypt sensitive session JSON using AES-256-GCM.
 * Pass `aad` (e.g. `linkedAccountId`) to cryptographically bind ciphertext to a single account row.
 */
export function sealPayload(plaintext: string, hexKey: string, aad?: string): string {
	const key = decodeMasterKey(hexKey);
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });

	if (aad) {
		cipher.setAAD(Buffer.from(aad, 'utf8'));
	}

	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return [
		ENVELOPE_VERSION,
		iv.toString('base64url'),
		authTag.toString('base64url'),
		encrypted.toString('base64url')
	].join('.');
}

/**
 * Decrypt and verify an AES-256-GCM envelope produced by `sealPayload`.
 */
export function openPayload(sealed: string, hexKey: string, aad?: string): string {
	const parts = sealed.split('.');
	if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
		throw new Error('Unsupported or malformed encrypted payload envelope.');
	}

	const [, ivB64, tagB64, dataB64] = parts;
	const key = decodeMasterKey(hexKey);
	const iv = Buffer.from(ivB64, 'base64url');
	const authTag = Buffer.from(tagB64, 'base64url');
	const ciphertext = Buffer.from(dataB64, 'base64url');

	if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
		throw new Error('Invalid IV or authentication tag length in sealed payload.');
	}

	const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
	decipher.setAuthTag(authTag);

	if (aad) {
		decipher.setAAD(Buffer.from(aad, 'utf8'));
	}

	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString('utf8');
}
