import { error, json } from '@sveltejs/kit';
import { loadSkinInspectorDetail } from '#lib/server/providers/valorant/service.js';
import type { RequestHandler } from './$types';

/** Owner-only skin detail: full level/chroma payloads (incl. videos) for the inspector modal. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const accountId = url.searchParams.get('account')?.trim();
	const skinUuid = url.searchParams.get('skin')?.trim();
	if (!accountId || !skinUuid) error(400, 'Missing account or skin parameter');
	const detail = await loadSkinInspectorDetail(locals.user.id, accountId, skinUuid);
	if (!detail) error(404, 'Skin not found in this account inventory');
	return json(detail);
};
