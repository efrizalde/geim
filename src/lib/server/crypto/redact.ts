const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const HDEV_KEY_PATTERN = /\bHDEV-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_TOKEN_PARAM_PATTERN =
	/((?:access_token|id_token|refresh_token|entitlements_token|code|api_key)=)[^&\s#"']+/gi;
const COOKIE_SECRET_PATTERN = /\b((?:ssid|tdid|clid|csid|sub|__cf_bm|cf_clearance)=)[^;\s"']+/gi;
const JSON_SECRET_FIELD_PATTERN =
	/("(?:password|access_token|accessToken|id_token|idToken|entitlements_token|entitlementsToken|ssid|tdid|clid|csid|sealedPayload|captcha)"\s*:\s*)"[^"]*"/gi;

/**
 * Scrub Riot credentials, JWTs, OAuth redirect fragments, and session cookies from any string
 * before logging or surfacing error diagnostics.
 */
export function redactSecrets(input: string): string {
	return input
		.replace(JSON_SECRET_FIELD_PATTERN, '$1"[REDACTED]"')
		.replace(URL_TOKEN_PARAM_PATTERN, '$1[REDACTED]')
		.replace(COOKIE_SECRET_PATTERN, '$1[REDACTED]')
		.replace(BEARER_PATTERN, '$1[REDACTED]')
		.replace(HDEV_KEY_PATTERN, '[REDACTED_HDEV_KEY]')
		.replace(JWT_PATTERN, '[REDACTED_JWT]');
}

/**
 * Mask a Riot PUUID for terminal diagnostics (e.g. "7f8e9d0c…1a2b").
 */
export function maskPuuid(puuid: string): string {
	const trimmed = puuid.trim();
	if (trimmed.length <= 12) return '***';
	return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

/**
 * Convert an unknown error into a safe, secret-redacted message.
 */
export function safeErrorMessage(err: unknown): string {
	if (err instanceof Error) {
		return redactSecrets(err.message);
	}
	return redactSecrets(String(err));
}
