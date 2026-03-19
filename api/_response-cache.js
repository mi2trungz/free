const DEFAULT_TTL_MS = 60 * 1000;

const store = new Map();

function now() {
    return Date.now();
}

function getEntryKey(namespace, key) {
    return `${String(namespace || 'default')}::${String(key || 'default')}`;
}

function get(namespace, key) {
    const entryKey = getEntryKey(namespace, key);
    const entry = store.get(entryKey);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
        store.delete(entryKey);
        return null;
    }
    return entry.value;
}

function set(namespace, key, value, ttlMs = DEFAULT_TTL_MS) {
    const safeTtl = Math.max(0, Number(ttlMs || DEFAULT_TTL_MS));
    const entryKey = getEntryKey(namespace, key);
    store.set(entryKey, {
        value,
        expiresAt: now() + safeTtl
    });
    return value;
}

async function getOrSet(namespace, key, resolver, ttlMs = DEFAULT_TTL_MS) {
    const cached = get(namespace, key);
    if (cached !== null) return { value: cached, cacheHit: true };
    const value = await resolver();
    set(namespace, key, value, ttlMs);
    return { value, cacheHit: false };
}

function invalidateNamespace(namespace) {
    const prefix = `${String(namespace || 'default')}::`;
    Array.from(store.keys()).forEach((entryKey) => {
        if (entryKey.startsWith(prefix)) store.delete(entryKey);
    });
}

function invalidateMany(namespaces = []) {
    const unique = new Set((Array.isArray(namespaces) ? namespaces : []).map((item) => String(item || '').trim()).filter(Boolean));
    unique.forEach((ns) => invalidateNamespace(ns));
}

module.exports = {
    get,
    set,
    getOrSet,
    invalidateNamespace,
    invalidateMany
};
