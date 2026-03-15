const {
    readCookiesFromLegacyDoc,
    listAllCookies,
    upsertCookiesBulk,
    deleteCookiesByIds
} = require('../api/_nf-store');

async function run() {
    const args = new Set(process.argv.slice(2));
    const writeMode = args.has('--write');
    const pruneMode = args.has('--prune');

    const legacy = await readCookiesFromLegacyDoc();
    const v2Before = await listAllCookies();

    const legacyIds = new Set(legacy.map((item) => item.id));
    const v2Ids = new Set(v2Before.map((item) => item.id));

    const missingInV2 = legacy.filter((item) => !v2Ids.has(item.id));
    const extraInV2 = v2Before.filter((item) => !legacyIds.has(item.id));

    console.log('[migrate-nf-cookies-v2] Legacy count:', legacy.length);
    console.log('[migrate-nf-cookies-v2] V2 current count:', v2Before.length);
    console.log('[migrate-nf-cookies-v2] Missing in V2:', missingInV2.length);
    console.log('[migrate-nf-cookies-v2] Extra in V2:', extraInV2.length);

    if (!writeMode) {
        console.log('[migrate-nf-cookies-v2] Dry run mode. Re-run with --write to migrate.');
        return;
    }

    const okUpsert = await upsertCookiesBulk(legacy);
    if (!okUpsert) {
        console.error('[migrate-nf-cookies-v2] Failed during upsert to V2 collection.');
        process.exitCode = 1;
        return;
    }

    if (pruneMode && extraInV2.length > 0) {
        const okDelete = await deleteCookiesByIds(extraInV2.map((item) => item.id));
        if (!okDelete) {
            console.error('[migrate-nf-cookies-v2] Failed pruning extra docs in V2.');
            process.exitCode = 1;
            return;
        }
        console.log('[migrate-nf-cookies-v2] Pruned extra docs:', extraInV2.length);
    }

    const v2After = await listAllCookies();
    console.log('[migrate-nf-cookies-v2] V2 count after migrate:', v2After.length);
    console.log('[migrate-nf-cookies-v2] Done.');
}

run().catch((error) => {
    console.error('[migrate-nf-cookies-v2] Fatal:', error && error.message ? error.message : error);
    process.exitCode = 1;
});
