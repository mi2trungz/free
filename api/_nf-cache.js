const CACHE = new Map();

function nowMs() {
    return Date.now();
}

function normalizeTtlMs(ttlMs, fallbackMs = 30000) {
    const value = Number(ttlMs);
    if (!Number.isFinite(value) || value <= 0) return fallbackMs;
    return Math.floor(value);
}

function cloneJsonSafe(value) {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return value;
    }
}

function getCache(key) {
    const cacheKey = String(key || '').trim();
    if (!cacheKey) return undefined;
    const entry = CACHE.get(cacheKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs()) {
        CACHE.delete(cacheKey);
        return undefined;
    }
    return cloneJsonSafe(entry.value);
}

function setCache(key, value, ttlMs = 30000) {
    const cacheKey = String(key || '').trim();
    if (!cacheKey) return;
    const ttl = normalizeTtlMs(ttlMs, 30000);
    CACHE.set(cacheKey, {
        value: cloneJsonSafe(value),
        expiresAt: nowMs() + ttl
    });
}

function deleteCache(key) {
    const cacheKey = String(key || '').trim();
    if (!cacheKey) return;
    CACHE.delete(cacheKey);
}

function invalidatePrefix(prefix) {
    const needle = String(prefix || '').trim();
    if (!needle) return;
    Array.from(CACHE.keys()).forEach((key) => {
        if (key.startsWith(needle)) CACHE.delete(key);
    });
}

module.exports = {
    getCache,
    setCache,
    deleteCache,
    invalidatePrefix
};
