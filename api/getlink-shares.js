const { parseBody } = require('./_nf-store');
const {
    createShare,
    readShareById,
    isValidShareId,
    isShareExpired,
    normalizeExpiryInput,
    getCookieListFromRecord,
    promoteShareCookieSlot,
    rotateShareCookies,
    updateShareCookies,
    SHARE_COOKIE_SLOTS
} = require('./_getlink-share-store');
const { evaluateGetlinkCookie } = require('./_getlink-cookie-health');
const sheetCookieImport = require('./_getlink-sheet-cookie-import');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getRequestOrigin(req) {
    const proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || '').trim();
    const host = String((req.headers && req.headers.host) || '').trim();
    if (proto && host) return `${proto}://${host}`;
    const origin = String((req.headers && req.headers.origin) || '').trim();
    if (origin) return origin.replace(/\/+$/, '');
    if (host) return `http://${host}`;
    return 'http://localhost:3005';
}

function shareDto(record, req) {
    const origin = getRequestOrigin(req);
    return {
        id: record.id,
        status: record.status,
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
        revokedAt: record.revokedAt || '',
        expiresAt: record.expiresAt || '',
        desktopOnly: !!record.desktopOnly,
        shareUrl: `${origin}/getlink?s=${encodeURIComponent(record.id)}`
    };
}

async function resolveShareCookie(record) {
    const candidates = getCookieListFromRecord(record);
    const checks = [];

    for (const candidate of candidates) {
        if (!candidate.cookieRaw) {
            checks.push({ slot: candidate.slot, ok: false, error: 'Cookie trong.' });
            continue;
        }
        const result = await evaluateGetlinkCookie(candidate.cookieRaw);
        checks.push({
            slot: candidate.slot,
            ok: !!result.ok,
            error: String(result.error || '').trim(),
            summary: result.summary || null
        });
        if (!result.ok) continue;

        let promotedShare = record;
        if (candidate.slot !== 'primary') {
            promotedShare = await promoteShareCookieSlot(record.id, candidate.slot, 'guest-resolve');
        }

        return {
            ok: true,
            cookieStr: candidate.cookieRaw,
            slot: candidate.slot,
            checks,
            share: promotedShare
        };
    }

    return {
        ok: false,
        error: 'Het cookie hop le. Vui long lien he admin de duoc bao hanh.',
        checks
    };
}

async function checkShareCookiesHealth(record) {
    const candidates = getCookieListFromRecord(record);
    const checks = [];

    for (const candidate of candidates) {
        if (!candidate.cookieRaw) {
            checks.push({ slot: candidate.slot, ok: false, error: 'Cookie trong.', summary: null });
            continue;
        }
        const result = await evaluateGetlinkCookie(candidate.cookieRaw);
        checks.push({
            slot: candidate.slot,
            ok: !!result.ok,
            error: String(result.error || '').trim(),
            summary: result.summary || null
        });
    }

    return {
        checks,
        liveCount: checks.filter((item) => item && item.ok).length
    };
}

function buildAutoFixedCookies(assigned = []) {
    const nextCookies = {
        primary: '',
        backup1: '',
        backup2: ''
    };

    const safeAssigned = Array.isArray(assigned) ? assigned : [];
    safeAssigned.forEach((item) => {
        const slot = String(item && item.slot ? item.slot : '').trim();
        const cookie = String(item && item.cookie ? item.cookie : '').trim();
        if (!SHARE_COOKIE_SLOTS.includes(slot) || !cookie) return;
        nextCookies[slot] = cookie;
    });

    return nextCookies;
}

module.exports = async function (req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pathname = String((req.url || '').split('?')[0] || '').trim();

        if (req.method === 'POST' && pathname === '/api/getlink-shares') {
            const body = parseBody(req.body);
            const expiresAt = body.expiresAt !== undefined ? normalizeExpiryInput(body.expiresAt) : '';
            const created = await createShare('', 'guest', expiresAt, body.desktopOnly === true);
            const dto = shareDto(created, req);
            return res.status(200).json({ success: true, ...dto, share: dto });
        }

        if (req.method === 'GET' && pathname.startsWith('/api/getlink-shares/')) {
            const shareId = decodeURIComponent(pathname.slice('/api/getlink-shares/'.length));
            if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

            const record = await readShareById(shareId);
            if (!record) return res.status(404).json({ error: 'Share link not found' });
            if (record.status !== 'active') {
                return res.status(410).json({ error: 'Share link has been revoked' });
            }
            if (isShareExpired(record)) {
                return res.status(410).json({ error: 'Share link has expired' });
            }

            const resolved = await resolveShareCookie(record);
            if (!resolved.ok) {
                return res.status(410).json({
                    error: resolved.error,
                    checks: resolved.checks || []
                });
            }

            return res.status(200).json({
                success: true,
                id: record.id,
                cookieStr: resolved.cookieStr,
                resolvedSlot: resolved.slot,
                desktopOnly: !!(resolved.share || record).desktopOnly,
                checks: resolved.checks || [],
                share: shareDto(resolved.share || record, req)
            });
        }

        if (req.method === 'POST') {
            const checkHealthMatch = pathname.match(/^\/api\/getlink-shares\/([^/]+)\/check-cookies-health$/);
            if (checkHealthMatch) {
                const shareId = decodeURIComponent(checkHealthMatch[1] || '');
                if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

                const record = await readShareById(shareId);
                if (!record) return res.status(404).json({ error: 'Share link not found' });
                if (record.status !== 'active') {
                    return res.status(410).json({ error: 'Share link has been revoked' });
                }
                if (isShareExpired(record)) {
                    return res.status(410).json({ error: 'Share link has expired' });
                }

                const health = await checkShareCookiesHealth(record);
                return res.status(200).json({
                    success: true,
                    id: record.id,
                    liveCount: health.liveCount,
                    checks: health.checks
                });
            }

            const rotateMatch = pathname.match(/^\/api\/getlink-shares\/([^/]+)\/rotate-cookie$/);
            if (rotateMatch) {
                const shareId = decodeURIComponent(rotateMatch[1] || '');
                if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

                const record = await readShareById(shareId);
                if (!record) return res.status(404).json({ error: 'Share link not found' });
                if (record.status !== 'active') {
                    return res.status(410).json({ error: 'Share link has been revoked' });
                }
                if (isShareExpired(record)) {
                    return res.status(410).json({ error: 'Share link has expired' });
                }

                const rotated = await rotateShareCookies(shareId, 'guest-overload-fix');
                return res.status(200).json({
                    success: true,
                    id: rotated.id,
                    rotatedToSlot: 'backup1',
                    cookieStr: rotated.cookieRaw || '',
                    share: shareDto(rotated, req)
                });
            }

            const autoFixMatch = pathname.match(/^\/api\/getlink-shares\/([^/]+)\/auto-fix-cookies$/);
            if (autoFixMatch) {
                const shareId = decodeURIComponent(autoFixMatch[1] || '');
                if (!isValidShareId(shareId)) return res.status(400).json({ error: 'Invalid share id' });

                const record = await readShareById(shareId);
                if (!record) return res.status(404).json({ error: 'Share link not found' });
                if (record.status !== 'active') {
                    return res.status(410).json({ error: 'Share link has been revoked' });
                }
                if (isShareExpired(record)) {
                    return res.status(410).json({ error: 'Share link has expired' });
                }

                const health = await checkShareCookiesHealth(record);
                if (health.liveCount > 0) {
                    return res.status(409).json({
                        error: 'Share still has live cookies',
                        liveCount: health.liveCount,
                        checks: health.checks
                    });
                }

                const allocation = await sheetCookieImport.allocateCookiesFromSheetForSlots(SHARE_COOKIE_SLOTS);
                const assigned = Array.isArray(allocation.assigned) ? allocation.assigned : [];
                if (assigned.length === 0) {
                    return res.status(422).json({
                        error: 'Khong lay duoc cookie PASS nao tu Google Sheet.',
                        assignedCount: 0,
                        assigned: [],
                        unfilledSlots: Array.isArray(allocation.unfilledSlots) ? allocation.unfilledSlots : SHARE_COOKIE_SLOTS,
                        checks: health.checks
                    });
                }

                const nextCookies = buildAutoFixedCookies(assigned);
                const updatedShare = await updateShareCookies(shareId, nextCookies, 'guest-auto-fix');
                return res.status(200).json({
                    success: true,
                    id: updatedShare.id,
                    assignedCount: assigned.length,
                    assigned,
                    unfilledSlots: Array.isArray(allocation.unfilledSlots) ? allocation.unfilledSlots : [],
                    share: shareDto(updatedShare, req)
                });
            }
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};
