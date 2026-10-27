import { error, json } from '@sveltejs/kit';
import {
	loadMatchScoreboard,
	loadTrackerMatchesPage
} from '#lib/server/providers/valorant/service.js';
import type { RequestHandler } from './$types';

/** Owner-only match feed: paged match summaries, or one match's scoreboard via ?match=. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const accountId = url.searchParams.get('account')?.trim();
	if (!accountId) error(400, 'Missing account parameter');

	const matchId = url.searchParams.get('match')?.trim();
	if (matchId) {
		const scoreboard = await loadMatchScoreboard(locals.user.id, accountId, matchId);
		if (!scoreboard) error(404, 'Match scoreboard not found');
		return json({ scoreboard });
	}

	const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
	const limit = Number(url.searchParams.get('limit') ?? 40) || 40;
	const page = await loadTrackerMatchesPage(locals.user.id, accountId, offset, limit);
	if (!page) error(404, 'Account not found');
	return json(page);
};
