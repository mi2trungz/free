const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(cookieParser());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Configure the proxy middleware
const proxyOptions = {
    target: 'https://api.getthispdf.com',
    changeOrigin: true, // Changes the host header to the target URL
    onProxyReq: (proxyReq, req, res) => {
        // Spoof the Origin and Referer
        proxyReq.setHeader('Origin', 'https://getthispdf.com');
        proxyReq.setHeader('Referer', 'https://getthispdf.com/');
    },
    cookieDomainRewrite: {
        '*': 'localhost' // Rewrite cookies so they work locally
    }
};

// Mount proxies
app.use('/api', createProxyMiddleware(proxyOptions));
app.use('/ads', createProxyMiddleware(proxyOptions));

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
