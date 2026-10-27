import { describe, expect, it } from 'vitest';
import { summarizeTrackerScopes, type StoredMatchRecord } from './tracker';

describe('tracker scope summaries', () => {
	it('aggregates the full sample separately by queue and season', () => {
		const match = (queueId: string, seasonId: string, kills: number) =>
			({
				queueId,
				seasonId,
				outcome: 'win',
				roundsPlayed: 10,
				kills,
				deaths: 5,
				assists: 2,
				score: 1000,
				damageDealt: 1000,
				damageReceived: 800,
				headshots: 5,
				bodyshots: 10,
				legshots: 1,
				kastRounds: 8,
				firstBloods: 1,
				flawlessRounds: 0,
				aces: 0,
				durationSeconds: 600
			}) as StoredMatchRecord;
		const matches = [
			...Array.from({ length: 40 }, () => match('competitive', 'current', 10)),
			match('competitive', 'old', 20),
			match('standard', 'old', 30)
		];
		const stats = summarizeTrackerScopes(matches);
		expect(stats.all.all).toMatchObject({ count: 42, kills: 450, rounds: 420 });
		expect(stats.competitive.all).toMatchObject({ count: 41, kills: 420 });
		expect(stats.competitive.old).toMatchObject({ count: 1, kills: 20 });
		expect(stats.unrated.old).toMatchObject({ count: 1, kills: 30 });
	});
});
