import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/account/password/+page.server';
import { consumeLoginAttempt } from './auth/shared-rate-limit';
import { hashPassword, verifyPassword } from './auth/password';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));
vi.mock('./auth/shared-rate-limit', () => ({ consumeLoginAttempt: vi.fn() }));
vi.mock('./auth/password', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock('./db/index', () => ({
	getDb: () => ({ select: mocks.select, execute: mocks.execute }),
	schema: { users: { id: {}, passwordHash: {} } }
}));

function event(fields: Record<string, string>, signedIn = true) {
	return {
		locals: {
			user: signedIn ? { id: 'user-id', username: 'user' } : null,
			sessionId: signedIn ? 'session-id' : null
		},
		request: new Request('http://localhost/account/password', {
			method: 'POST',
			body: new URLSearchParams(fields)
		})
	} as never;
}
const valid = {
	currentPassword: 'old-password',
	newPassword: 'a-strong-new-password',
	confirmPassword: 'a-strong-new-password'
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(consumeLoginAttempt).mockResolvedValue(true);
	vi.mocked(verifyPassword).mockResolvedValue(true);
	vi.mocked(hashPassword).mockResolvedValue('new-hash');
	mocks.select.mockReturnValue({
		from: () => ({ where: () => ({ limit: async () => [{ passwordHash: 'old-hash' }] }) })
	});
	mocks.execute.mockResolvedValue({ rows: [{ id: 'user-id' }] });
});
describe('password change', () => {
	it('requires authentication and matching strong passwords before touching the database', async () => {
		expect(await actions.default(event(valid, false))).toMatchObject({ status: 401 });
		expect(
			await actions.default(event({ ...valid, newPassword: 'short', confirmPassword: 'short' }))
		).toMatchObject({ status: 400 });
		expect(await actions.default(event({ ...valid, confirmPassword: 'different' }))).toMatchObject({
			status: 400
		});
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it('rejects incorrect passwords and rate-limited attempts', async () => {
		vi.mocked(verifyPassword).mockResolvedValueOnce(false);
		expect(await actions.default(event(valid))).toMatchObject({
			status: 400,
			data: { error: 'Current password is incorrect.' }
		});
		vi.mocked(consumeLoginAttempt).mockResolvedValueOnce(false);
		expect(await actions.default(event(valid))).toMatchObject({ status: 429 });
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it('changes the password only after verifying the current password and handles concurrent changes', async () => {
		expect(await actions.default(event(valid))).toEqual({ success: true });
		expect(verifyPassword).toHaveBeenCalledWith(valid.currentPassword, 'old-hash');
		expect(hashPassword).toHaveBeenCalledWith(valid.newPassword);
		mocks.execute.mockResolvedValueOnce({ rows: [] });
		expect(await actions.default(event(valid))).toMatchObject({ status: 409 });
	});
});
