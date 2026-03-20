const nfCustomersHandler = require('./nf-customers');
const nfCookiesHandler = require('./nf-cookies');
const nfCookiesImportHandler = require('./nf-cookies/import');
const nfCookiesCheckHandler = require('./nf-cookies/check');
const nfCustomerLookupHandler = require('./nf-customer-lookup');
const nfGenerateLinkHandler = require('./nf-generate-link');
const nfSupportOverloadCheckHandler = require('./nf-support-overload-check');
const nfCookieToLinkHandler = require('./nf-cookie-to-link');
const nfTvActivateHandler = require('./nf-tv-activate');
const nftokenHandler = require('./nftoken');
const netflixCookieHandler = require('./netflix-cookie');

function getRequestPath(req) {
    return String((req && req.url) || '/').split('?')[0];
}

function sendTempDisabledGetlink(res) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(503).json({
        error: 'Getlink API is temporarily disabled',
        code: 'GETLINK_TEMP_DISABLED'
    });
}

module.exports = async function (req, res) {
    try {
        const requestPath = getRequestPath(req);

        if (requestPath === '/api/getlink-shares' || requestPath.startsWith('/api/getlink-shares/')) {
            return sendTempDisabledGetlink(res);
        }
        if (requestPath.startsWith('/api/getlink-admin')) {
            return sendTempDisabledGetlink(res);
        }

        if (requestPath === '/api/nf-cookies/import') {
            return nfCookiesImportHandler(req, res);
        }
        if (requestPath === '/api/nf-cookies/check') {
            return nfCookiesCheckHandler(req, res);
        }
        if (requestPath === '/api/nf-cookies') {
            return nfCookiesHandler(req, res);
        }
        if (requestPath === '/api/nf-customers') {
            return nfCustomersHandler(req, res);
        }
        if (requestPath === '/api/nf-customer-lookup') {
            return nfCustomerLookupHandler(req, res);
        }
        if (requestPath === '/api/nf-generate-link') {
            return nfGenerateLinkHandler(req, res);
        }
        if (requestPath === '/api/nf-support-overload-check') {
            return nfSupportOverloadCheckHandler(req, res);
        }
        if (requestPath === '/api/nf-cookie-to-link') {
            return nfCookieToLinkHandler(req, res);
        }
        if (requestPath === '/api/nf-tv-activate') {
            return nfTvActivateHandler(req, res);
        }
        if (requestPath === '/api/nftoken') {
            return nftokenHandler(req, res);
        }
        if (requestPath === '/api/netflix-cookie') {
            return netflixCookieHandler(req, res);
        }

        return res.status(404).json({ error: 'Not found' });
    } catch (error) {
        return res.status(500).json({ error: error && error.message ? error.message : 'Internal server error' });
    }
};
