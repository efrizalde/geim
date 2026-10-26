import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { maskPuuid, safeErrorMessage } from '../src/lib/server/crypto/redact';
import { RIOT_AUTH_AUTHORIZE_URL } from '../src/lib/server/providers/valorant/constants';
import {
	attemptDirectLogin,
	fetchCatalogSkinPrices,
	fetchEntitlementsToken,
	fetchMatchHistory,
	fetchOwnedCategory,
	fetchPlayerLoadout,
	fetchRiotClientVersion,
	fetchRiotIdentity,
	fetchStorefront,
	fetchWallet,
	renewSessionWithCookies,
	resolveValorantAffinity,
	submitDirectMfa,
	type ValorantSessionContext
} from '../src/lib/server/providers/valorant/client';
import {
	parseAuthRedirectUrl,
	type ParsedAuthTokens
} from '../src/lib/server/providers/valorant/schemas';

async function checkModule<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
	try {
		const result = await fn();
		console.log(`  [PASS] ${label}`);
		return result;
	} catch (err) {
		console.log(`  [FAIL] ${label}: ${safeErrorMessage(err)}`);
		return null;
	}
}

async function main() {
	const rl = createInterface({ input, output });

	console.log('\n============================================================');
	console.log(' geim :: Milestone 0 VALORANT Live Feasibility Spike');
	console.log(' Secrets are held in memory only and never logged or saved.');
	console.log('============================================================\n');

	console.log('Select authentication mode to test:');
	console.log('  1) OAuth Redirect URL paste (fastest, bypasses server Captcha)');
	console.log('  2) ssid Cookie renewal test (verifies silent cookie-reauth)');
	console.log('  3) Direct Riot username/password + MFA (tests host IP / Captcha behavior)\n');

	const mode = (await rl.question('Choice [1/2/3]: ')).trim();
	let tokens: ParsedAuthTokens;

	try {
		if (mode === '1') {
			console.log('\n1. Open this official Riot login URL in your browser:');
			console.log(`   ${RIOT_AUTH_AUTHORIZE_URL}`);
			console.log(
				'2. Sign in, then copy the final https://playvalorant.com/opt_in#access_token=... URL.\n'
			);
			const redirectUrl = await rl.question('Paste redirect URL: ');
			tokens = parseAuthRedirectUrl(redirectUrl);
			console.log(
				`  [PASS] Parsed short-lived token (expires in ~${tokens.expiresInSeconds}s; no ssid cookie).`
			);
		} else if (mode === '2') {
			const ssid = (await rl.question('\nPaste auth.riotgames.com ssid cookie value: ')).trim();
			const outcome = await renewSessionWithCookies({ ssid });
			if (outcome.status !== 'ok') {
				console.log(`\n  [STOP] Cookie renewal returned "${outcome.status}".`);
				if ('reason' in outcome) console.log(`         Reason: ${outcome.reason}`);
				return;
			}
			tokens = outcome.tokens;
			console.log(
				`  [PASS] Silent ssid cookie-reauth succeeded (${Object.keys(outcome.cookies).length} cookies in jar).`
			);
		} else if (mode === '3') {
			const username = (await rl.question('\nRiot username: ')).trim();
			const password = await rl.question('Riot password (ensure terminal history is private): ');
			let outcome = await attemptDirectLogin(username, password);

			if (outcome.status === 'mfa_required') {
				console.log(
					`  [INFO] MFA challenge requested (${outcome.emailHint ?? 'authenticator/email'}).`
				);
				const mfaCode = await rl.question('Enter 6-digit MFA code: ');
				outcome = await submitDirectMfa(mfaCode, outcome.cookies);
			}

			if (outcome.status !== 'ok') {
				console.log(`\n  [STOP] Direct login returned "${outcome.status}".`);
				if ('detail' in outcome) console.log(`         Detail: ${outcome.detail}`);
				if ('reason' in outcome) console.log(`         Reason: ${outcome.reason}`);
				return;
			}

			tokens = outcome.tokens;
			console.log(
				`  [PASS] Direct login succeeded (ssid present: ${Boolean(outcome.cookies.ssid)}).`
			);
		} else {
			console.log('Invalid selection. Exiting.');
			return;
		}

		const resolvedTokens = tokens;

		console.log('\n--- Step 1: Client Version, Entitlements & Identity ---');
		const clientVersion = await checkModule('valorant-api.com clientVersion', () =>
			fetchRiotClientVersion()
		);
		const entitlementsToken = await checkModule('Riot entitlements JWT', () =>
			fetchEntitlementsToken(resolvedTokens.accessToken)
		);
		const identity = await checkModule('Riot /userinfo identity', () =>
			fetchRiotIdentity(resolvedTokens.accessToken)
		);
		const affinity = await checkModule('Riot VALORANT region/shard affinity', () =>
			resolveValorantAffinity(resolvedTokens.accessToken, resolvedTokens.idToken, 'ap')
		);

		if (!clientVersion || !entitlementsToken || !identity || !affinity) {
			console.log('\n[ABORT] Prerequisite session context incomplete.');
			return;
		}

		console.log(
			`  Account: ${identity.gameName}#${identity.tagLine} (${maskPuuid(identity.puuid)}) | Region: ${affinity.region} -> PD Shard: ${affinity.shard}`
		);

		const ctx: ValorantSessionContext = {
			puuid: identity.puuid,
			shard: affinity.shard,
			region: affinity.region,
			accessToken: tokens.accessToken,
			entitlementsToken,
			clientVersion
		};

		console.log('\n--- Step 2: Storefront, Wallet & Catalog Base Prices ---');
		const storefront = await checkModule('POST /store/v3/storefront/{puuid}', () =>
			fetchStorefront(ctx)
		);
		if (storefront) {
			console.log(
				`    Daily offers: ${storefront.dailyOffers.length} | Expires at: ${storefront.dailyExpiresAt}`
			);
			for (const offer of storefront.dailyOffers) {
				console.log(`      - SkinLevel ${offer.skinLevelId}: ${offer.vpPrice ?? 'null'} VP`);
			}
			if (storefront.nightMarket.status === 'active') {
				console.log(
					`    Night Market: VERIFIED ACTIVE (${storefront.nightMarket.offers.length} offers, expires ${storefront.nightMarket.expiresAt})`
				);
			} else {
				console.log(
					'    Night Market: ABSENT (BonusStore null/omitted — Night Market parsing remains unverified until an active event)'
				);
			}
		}

		const wallet = await checkModule('GET /store/v1/wallet/{puuid}', () => fetchWallet(ctx));
		if (wallet) {
			console.log(
				`    Balances -> VP: ${wallet.vp ?? 'null'} | Radianite: ${wallet.radianite ?? 'null'} | Kingdom Credits: ${wallet.kingdomCredits ?? 'null'}`
			);
		}

		const catalogPrices = await checkModule('GET /store/v1/offers/ (catalog VP prices)', () =>
			fetchCatalogSkinPrices(ctx)
		);
		if (catalogPrices) {
			console.log(`    Indexed ${catalogPrices.size} single-item skin level VP offers.`);
		}

		console.log('\n--- Step 3: Inventory Entitlements & Equipped Loadout ---');
		const ownedSkins = await checkModule('GET /store/v1/entitlements (SKIN_LEVELS)', () =>
			fetchOwnedCategory(ctx, 'SKIN_LEVELS')
		);
		const ownedChromas = await checkModule('GET /store/v1/entitlements (SKIN_CHROMAS)', () =>
			fetchOwnedCategory(ctx, 'SKIN_CHROMAS')
		);
		const ownedBuddies = await checkModule('GET /store/v1/entitlements (BUDDIES)', () =>
			fetchOwnedCategory(ctx, 'BUDDIES')
		);
		if (ownedSkins) {
			console.log(
				`    Owned entitlements -> Skin Levels: ${ownedSkins.Entitlements.length} | Chromas: ${ownedChromas?.Entitlements.length ?? 'err'} | Buddy Instances: ${ownedBuddies?.Entitlements.length ?? 'err'}`
			);
		}

		const loadout = await checkModule('GET /personalization/v2/players/{puuid}/playerloadout', () =>
			fetchPlayerLoadout(ctx)
		);
		if (loadout) {
			console.log(
				`    Equipped guns: ${loadout.Guns.length} | Sprays: ${loadout.Sprays.length} | Account Level: ${loadout.Identity.AccountLevel ?? 'n/a'}`
			);
		}

		console.log('\n--- Step 4: Tracker Match History ---');
		const history = await checkModule('GET /match-history/v1/history/{puuid}', () =>
			fetchMatchHistory(ctx, 5)
		);
		if (history) {
			console.log(
				`    Total indexed matches: ${history.Total} | Returned sample: ${history.History.length}`
			);
		}

		console.log('\n============================================================');
		console.log(' Milestone 0 local run complete. Compare outputs with game!');
		console.log('============================================================\n');
	} catch (err) {
		console.error(`\n[ERROR] ${safeErrorMessage(err)}`);
		process.exitCode = 1;
	} finally {
		rl.close();
	}
}

void main();
