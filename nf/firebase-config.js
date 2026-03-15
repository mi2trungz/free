export const NF_FIREBASE_CONFIG = (() => {
    if (typeof window !== 'undefined' && window.NF_FIREBASE_CONFIG && typeof window.NF_FIREBASE_CONFIG === 'object') {
        return window.NF_FIREBASE_CONFIG;
    }
    return {
        apiKey: '',
        authDomain: '',
        projectId: '',
        appId: ''
    };
})();

export const NF_ADMIN_EMAILS = (() => {
    if (typeof window !== 'undefined' && Array.isArray(window.NF_ADMIN_EMAILS)) {
        return window.NF_ADMIN_EMAILS.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
    }
    return [];
})();

export function hasFirebaseConfig() {
    return !!(
        NF_FIREBASE_CONFIG
        && String(NF_FIREBASE_CONFIG.apiKey || '').trim()
        && String(NF_FIREBASE_CONFIG.projectId || '').trim()
        && String(NF_FIREBASE_CONFIG.appId || '').trim()
    );
}
