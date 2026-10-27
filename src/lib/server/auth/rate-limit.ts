const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

interface AttemptRecord {
	count: number;
	resetAt: number;
}

// ponytail: per-instance throttle; use a shared store before scaling across workers.
const failedLoginAttempts = new Map<string, AttemptRecord>();

export function checkLoginRateLimit(
	key: string,
	now = Date.now()
): {
	allowed: boolean;
	retryAfterSeconds: number;
} {
	const record = failedLoginAttempts.get(key);
	if (!record || record.resetAt <= now) {
		if (record) failedLoginAttempts.delete(key);
		return { allowed: true, retryAfterSeconds: 0 };
	}

	if (record.count >= MAX_FAILED_ATTEMPTS) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000))
		};
	}

	return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedLogin(key: string, now = Date.now()): void {
	// Bound memory in long-lived processes: sweep dead keys once the map grows.
	if (failedLoginAttempts.size > 500) {
		for (const [k, r] of failedLoginAttempts) {
			if (r.resetAt <= now) failedLoginAttempts.delete(k);
		}
	}
	const existing = failedLoginAttempts.get(key);
	if (!existing || existing.resetAt <= now) {
		failedLoginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return;
	}
	existing.count += 1;
}

export function clearFailedLogins(key: string): void {
	failedLoginAttempts.delete(key);
}
