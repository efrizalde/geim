import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isInstanceOwner, registrationIsOpen, requireOwner } from './admin';
import { actions, load } from '../../routes/admin/+page.server';

const state = vi.hoisted(() => ({ rows: [] as unknown[], calls: 0 }));
vi.mock('$app/env/private', () => ({ OWNER_USER_ID: '11111111-1111-4111-8111-111111111111' }));
vi.mock('./db', async () => ({
	schema: await import('./db/schema'),
	getDb: () => ({
		select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }),
		execute: async () => {
			state.calls++;
			return { rows: [] };
		}
	})
}));

const owner = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'owner',
	displayCurrency: 'IDR' as const,
	purchaseRegion: 'ID'
};
const other = { ...owner, id: '22222222-2222-4222-8222-222222222222' };
beforeEach(() => {
	state.rows = [];
	state.calls = 0;
});

describe('owner authorization and registration policy', () => {
	it('requires both the configured identity and provisioned password', async () => {
		expect(await isInstanceOwner(null)).toBe(false);
		expect(await isInstanceOwner(other)).toBe(false);
		expect(await isInstanceOwner(owner)).toBe(false);
		state.rows = [{ ready: true }];
		expect(await isInstanceOwner(owner)).toBe(true);
		await expect(requireOwner(null)).rejects.toMatchObject({ status: 401 });
		await expect(requireOwner(other)).rejects.toMatchObject({ status: 403 });
	});

	it('defaults a missing policy to open and rejects corrupt values', async () => {
		expect(await registrationIsOpen()).toBe(true);
		state.rows = [{ value: false }];
		expect(await registrationIsOpen()).toBe(false);
		state.rows = [{ value: 'invalid' }];
		await expect(registrationIsOpen()).rejects.toThrow();
	});

	it('rejects direct admin reads and mutations before any query', async () => {
		const request = new Request('http://localhost/admin?/registration', {
			method: 'POST',
			body: new URLSearchParams({ open: 'false', confirmed: 'yes' })
		});
		await expect(
			load({ locals: { user: other }, url: new URL('http://localhost/admin') } as never)
		).rejects.toMatchObject({ status: 403 });
		await expect(
			actions.registration({ locals: { user: other }, request } as never)
		).rejects.toMatchObject({ status: 403 });
		expect(state.calls).toBe(0);
	});

	it('requires explicit confirmation before changing registration', async () => {
		state.rows = [{ ready: true }];
		const request = new Request('http://localhost/admin?/registration', {
			method: 'POST',
			body: new URLSearchParams({ open: 'false' })
		});
		expect(await actions.registration({ locals: { user: owner }, request } as never)).toMatchObject(
			{ status: 400 }
		);
		expect(state.calls).toBe(0);
	});
});
