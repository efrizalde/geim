import { error } from '@sveltejs/kit';
import { loadSharedProfile } from '#lib/server/sharing.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'no-store',
		'x-robots-tag': 'noindex, nofollow',
		'referrer-policy': 'no-referrer'
	});
	const share = await loadSharedProfile(params.token);
	if (!share) error(404, 'This shared profile does not exist or is no longer available.');
	return share;
};
