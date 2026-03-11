const https = require('https');

module.exports = function (req, res) {
    // Kích hoạt CORS (Cho phép giao tiếp từ nền tảng Front-end khác)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Xử lý request dạng preflight (bảo mật của trình duyệt web)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { netflixId, secureNetflixId } = req.body || {};

    if (!netflixId) {
        return res.status(400).json({ error: 'Dữ liệu không có cookie NetflixId' });
    }

    // Gộp Cookie lại thành chuỗi Netscape String cho request
    let cookieStr = `NetflixId=${netflixId};`;
    if (secureNetflixId) {
        cookieStr += ` SecureNetflixId=${secureNetflixId};`;
    }

    const payload = JSON.stringify({
        "operationName": "CreateAutoLoginToken",
        "variables": {
            "scope": "WEBVIEW_MOBILE_STREAMING",
        },
        "extensions": {
            "persistedQuery": {
                "version": 102,
                "id": "76e97129-f4b5-41a0-a73c-12e674896849",
            }
        },
    });

    const options = {
        hostname: 'android13.prod.ftl.netflix.com',
        port: 443,
        path: '/graphql',
        method: 'POST',
        headers: {
            'User-Agent': 'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Cookie': cookieStr,
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const netflixReq = https.request(options, (netflixRes) => {
        let responseData = '';

        netflixRes.on('data', (d) => {
            responseData += d;
        });

        netflixRes.on('end', () => {
            try {
                const jsonBase = JSON.parse(responseData);
                if (jsonBase.errors) {
                    return res.status(400).json({ error: jsonBase.errors[0]?.message || 'Lỗi trả về từ server Netflix' });
                }

                const token = jsonBase.data?.createAutoLoginToken;
                if (token) {
                    return res.status(200).json({ nftoken: token });
                } else {
                    return res.status(500).json({ error: 'Không tìm thấy URL tạo Token. Có thể Cookie đã hết hạn hoặc bị đổi mật khẩu.' });
                }
            } catch (e) {
                return res.status(500).json({ error: 'Không thể phân tích dữ liệu trả về từ Netflix' });
            }
        });
    });

    netflixReq.on('error', (e) => {
        return res.status(500).json({ error: `Lỗi kết nối máy chủ: ${e.message}` });
    });

    netflixReq.write(payload);
    netflixReq.end();
};
