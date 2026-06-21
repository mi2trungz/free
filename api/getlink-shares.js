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
    SHARE_COOKIE_SLOTS
} = require('./_getlink-share-store');
const { evaluateGetlinkCookie } = require('./_getlink-cookie-health');
const {
    createAutoFixOperation,
    createOverloadFixOperation,
    advanceGetlinkOperation,
    shapeOperationPayload
} = require('./_getlink-operation-store');

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

function getDeadSlotsFromHealth(checks = []) {
    const failedSlots = Array.isArray(checks)
        ? checks
            .filter((item) => item && item.ok === false && SHARE_COOKIE_SLOTS.includes(item.slot))
            .map((item) => item.slot)
        : [];
    const seen = new Set(failedSlots);
    SHARE_COOKIE_SLOTS.forEach((slot) => {
        if (seen.size >= 2) return;
        if (!seen.has(slot)) {
            const matched = Array.isArray(checks) ? checks.find((item) => item && item.slot === slot) : null;
            if (!matched || matched.ok !== true) {
                seen.add(slot);
            }
        }
    });
    return Array.from(seen).slice(0, 2);
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
                    status: 'completed',
                    rotatedToSlot: 'backup1',
                    cookieStr: rotated.cookieRaw || '',
                    share: shareDto(rotated, req)
                });
            }

            const overloadFixMatch = pathname.match(/^\/api\/getlink-shares\/([^/]+)\/overload-fix$/);
            if (overloadFixMatch) {
                const shareId = decodeURIComponent(overloadFixMatch[1] || '');
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
                if (health.liveCount <= 0) {
                    return res.status(422).json({
                        error: 'Khong du cookie song truoc khi rotate. liveCount=0',
                        liveCount: 0,
                        checks: health.checks
                    });
                }

                if (health.liveCount >= 2) {
                    const rotated = await rotateShareCookies(shareId, 'guest-overload-fix-direct');
                    return res.status(200).json({
                        success: true,
                        status: 'completed',
                        id: rotated.id,
                        liveCount: health.liveCount,
                        assigned: [],
                        assignedCount: 0,
                        unfilledSlots: [],
                        cookieStr: rotated.cookieRaw || '',
                        share: shareDto(rotated, req),
                        timings: {
                            sheetFetchMs: 0,
                            cookieCheckMs: 0,
                            sheetUpdateMs: 0,
                            shareUpdateMs: 0,
                            totalMs: 0
                        }
                    });
                }

                const deadSlots = getDeadSlotsFromHealth(health.checks);
                if (deadSlots.length < 2) {
                    return res.status(422).json({
                        error: `Khong du cookie song truoc khi rotate. liveCount=${health.liveCount}`,
                        liveCount: health.liveCount,
                        checks: health.checks
                    });
                }

                const operation = await createOverloadFixOperation(shareId, deadSlots, health.liveCount);
                const advanced = await advanceGetlinkOperation(operation);
                const payload = shapeOperationPayload(advanced);
                if (advanced.status === 'failed') {
                    return res.status(422).json({
                        ...payload,
                        error: String(advanced.lastError || advanced.message || 'Khong the sua loi qua tai tu dong.').trim() || 'Khong the sua loi qua tai tu dong.'
                    });
                }
                return res.status(200).json(payload);
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

                const operation = await createAutoFixOperation(shareId);
                const advanced = await advanceGetlinkOperation(operation);
                const payload = shapeOperationPayload(advanced);
                if (advanced.status === 'failed') {
                    return res.status(422).json({
                        ...payload,
                        error: String(advanced.lastError || advanced.message || 'Khong lay duoc cookie PASS nao tu Google Sheet.').trim() || 'Khong lay duoc cookie PASS nao tu Google Sheet.'
                    });
                }
                return res.status(200).json(payload);
            }
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(error.httpStatus || 500).json({ error: error.message || 'Internal server error' });
    }
};
