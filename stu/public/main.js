(function() {
    var form = document.getElementById('fetchForm');
    var btn = document.getElementById('fetchBtn');
    var statusBox = document.getElementById('status');
    var statusText = document.getElementById('statusText');
    var progressInfo = document.getElementById('progressInfo');
    var progressBar = document.getElementById('progressBar');
    var progressLabel = document.getElementById('progressLabel');
    var progressPct = document.getElementById('progressPct');
    var queueStatus = document.getElementById('queueStatus');
    var queueBar = document.getElementById('queueBar');
    var queueText = document.getElementById('queueText');
    var queueDetail = document.getElementById('queueDetail');
    
    var currentDocUrl = '';
    var _queueId = null;
    var _queueInterval = null;
    var QUEUE_HEARTBEAT_MS = 10000;

    // Use current host since we proxy backend
    var API_BASE = window.location.origin;

    function reset() {
        if (_queueInterval) clearInterval(_queueInterval);
        _queueInterval = null;
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Get PDF';
        statusBox.style.display = 'none';
        progressInfo.style.display = 'none';
        queueStatus.style.display = 'none';
    }

    function updateStatus(msg) {
        statusBox.style.display = 'flex';
        statusText.textContent = msg;
    }

    function showError(title, message) {
        document.getElementById('errorTitle').textContent = title || 'Error';
        document.getElementById('errorMsg').textContent = message || 'Something went wrong.';
        document.getElementById('errorOverlay').classList.add('visible');
    }

    document.getElementById('errorCloseBtn').addEventListener('click', function() {
        document.getElementById('errorOverlay').classList.remove('visible');
    });

    function showQueueState(queueState) {
        var pos = Number(queueState.position || 0);
        var total = Number(queueState.total || 0);
        var ahead = Number(queueState.ahead || Math.max(pos - 1, 0));
        
        queueStatus.style.display = 'flex';
        statusBox.style.display = 'none'; // hide normal status when in queue

        if (pos === 1) {
            queueText.textContent = 'Your turn! Starting download...';
        } else {
            queueText.textContent = 'Waiting in queue...';
        }

        var pct = total > 0 ? Math.max(5, ((total - pos + 1) / total) * 100) : 0;
        queueBar.style.width = pct + '%';
        queueDetail.textContent = ahead + ' users ahead of you | Your spot: ' + pos;
    }

    function updateProgress(done, total) {
        progressInfo.style.display = 'flex';
        statusBox.style.display = 'none';
        queueStatus.style.display = 'none';

        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progressBar.style.width = pct + '%';
        progressLabel.textContent = done + ' / ' + total + ' pages';
        progressPct.textContent = pct + '%';
    }

    function doFetch(docUrl) {
        updateStatus('Authenticating & getting pages...');
        
        // Use our proxy
        fetch(API_BASE + '/ads/serve/fetch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: docUrl, queue_id: _queueId})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                reset();
                showError('Server Error', data.error);
                return;
            }
            downloadDocument(data);
        })
        .catch(function(err) {
            reset();
            showError('Network Error', err.message || 'Could not connect to the proxy server.');
        });
    }

    function startQueuedFetch(docUrl) {
        _queueId = 'q_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now();

        updateStatus('Joining verification queue...');

        fetch(API_BASE + '/api/queue/join', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({queue_id: _queueId})
        })
        .then(function(r) { return r.json(); })
        .then(function(qData) {
            if (qData.error) {
                reset();
                showError('Queue Full', qData.error);
                return;
            }
            showQueueState(qData);

            if (qData.position === 1) {
                doFetch(docUrl);
                return;
            }

            // Poll
            _queueInterval = setInterval(function() {
                fetch(API_BASE + '/api/queue/heartbeat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({queue_id: _queueId})
                })
                .then(function(r) { return r.json(); })
                .then(function(hb) {
                    showQueueState(hb);
                    if (hb.position === 1) {
                        clearInterval(_queueInterval);
                        _queueInterval = null;
                        doFetch(docUrl);
                    }
                })
                .catch(function() {});
            }, QUEUE_HEARTBEAT_MS);
        })
        .catch(function(err) {
            reset();
            showError('Queue Error', 'Could not join download queue. Please try again.');
        });
    }

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var url = document.getElementById('url').value.trim();
        if (!url || !url.startsWith('https://')) {
            showError('Invalid URL', 'Please paste a valid HTTPS Studocu link.');
            return;
        }

        currentDocUrl = url;
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Fetching...';
        
        startQueuedFetch(url);
    });

    function downloadDocument(data) {
        var docId = data.doc_id, title = data.title, totalPages = data.total_pages;
        var docCss = data.doc_css || '', pngSig = data.png_sig || '', assetBase = data.asset_base || '';
        var currentPages = data.pages || [];
        var pageResults = {}, completed = 0;

        currentPages.forEach(function(p) {
            if (p.embedded_html) {
                pageResults[p.num] = { status: 'ok', html: p.embedded_html };
                completed++;
            }
        });

        var needDownload = currentPages.filter(function(p) { return !p.embedded_html; });

        if (needDownload.length === 0) {
            finishDocument(pageResults, docCss, title, totalPages);
            return;
        }

        updateProgress(completed, totalPages);
        var SEND_GAP = 150;

        function rewritePageUrls(html) {
            html = html.replace(/src="(?!https?:\/\/|data:)([^"]*\.png)"/gi, function(m, f) {
                return 'src="' + assetBase + f + pngSig + '"';
            });
            html = html.replace(/src="(?!https?:\/\/|data:)([^"]*\.jpe?g)"/gi, function(m, f) {
                return 'src="' + assetBase + f + pngSig + '"';
            });
            html = html.replace(/url\(["']?(?!https?:\/\/|data:)([^"')\s]*\.png)["']?\)/gi, function(m, f) {
                return 'url("' + assetBase + f + pngSig + '")';
            });
            return html;
        }

        function fetchWithRetry(p) {
            // Check if URL is absolute to getthispdf. If so, map it to local proxy
            var fetchUrl = p.url;
            if (fetchUrl.startsWith('https://api.getthispdf.com')) {
                fetchUrl = fetchUrl.replace('https://api.getthispdf.com', API_BASE);
            }

            return fetch(fetchUrl).then(function(resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.text();
            }).then(function(html) {
                html = rewritePageUrls(html);
                pageResults[p.num] = { status: 'ok', html: html };
                completed++;
                updateProgress(completed, totalPages);
            }).catch(function() {
                pageResults[p.num] = { status: 'error' };
                completed++;
                updateProgress(completed, totalPages);
            });
        }

        var promises = needDownload.map(function(p, i) {
            return new Promise(function(resolve) { setTimeout(resolve, i * SEND_GAP); })
                   .then(function() { return fetchWithRetry(p); });
        });

        Promise.all(promises).then(function() {
            finishDocument(pageResults, docCss, title, totalPages);
        });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function finishDocument(pageResults, docCss, title, totalPages) {
        updateProgress(totalPages, totalPages);
        setTimeout(function() {
            var pagesHtml = '';
            for (var i = 1; i <= totalPages; i++) {
                var page = pageResults[i];
                if (page && page.status === 'ok' && page.html) {
                    pagesHtml += '<div class="pf w0 h0" id="pf'+i+'"><div class="page-num">'+i+'</div>'+page.html+'</div>';
                } else {
                    pagesHtml += '<div class="pf w0 h0" id="pf'+i+'" style="height:842px;"><div class="page-num">'+i+'</div><div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9CA3AF;">Page failed to load</div></div>';
                }
            }

            var viewerHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
                '<meta name="viewport" content="width=device-width, initial-scale=1">' +
                '<title>' + escapeHtml(title) + '</title>' +
                '<style>' + docCss.replace(/<\//gi, '<\\/') + '</style>' +
                '<style>' +
                'html,body{margin:0;padding:0;background:#0F172A;}' +
                'body{font-family:sans-serif;color:#18181B;min-height:100vh;}' +
                '.p2hv #page-container{position:relative;padding:20px 0 50px;width:100%;display:flex;flex-direction:column;align-items:center;}' +
                '.p2hv .pf{margin:20px auto!important;box-shadow:0 8px 30px rgba(0,0,0,0.5);overflow:hidden!important;border-radius:12px;background:#fff;position:relative;}' +
                '.page-num{position:absolute;top:10px;right:10px;background:rgba(99,102,241,0.9);color:#fff;font:600 12px/1 sans-serif;padding:6px 12px;border-radius:20px;z-index:10;pointer-events:none;}' +
                '@media print{html,body{background:#fff!important;margin:0;padding:0;}.page-num{display:none!important}.p2hv #page-container{padding:0}.p2hv .pf{margin:0!important;box-shadow:none!important;border:none!important;border-radius:0!important;page-break-after:always;}}' +
                '</style></head><body>' +
                '<div class="p2hv"><div id="page-container">' + pagesHtml + '</div></div>' +
                '<scr'+'ipt>' +
                'window.addEventListener("message",function(e){if(e.data==="print"){window.print();}});' +
                '<\/scr'+'ipt></body></html>';

            showViewer(viewerHtml, title, totalPages);
        }, 500);
    }

    function showViewer(html, title, totalPages) {
        document.getElementById('app-wrapper').style.display = 'none';

        var wrap = document.getElementById('viewerWrap');
        wrap.innerHTML = '';
        wrap.style.display = 'flex';

        // Viewer Header
        var header = document.createElement('div');
        header.id = 'viewerHeader';
        header.innerHTML = 
            '<div style="display:flex;align-items:center;gap:16px;">' +
                '<button id="viewerBackBtn" title="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>' +
                '<div>' +
                    '<div style="font-weight:700;font-size:15px;color:#F8FAFC;">' + escapeHtml(title) + '</div>' +
                    '<div style="font-size:12px;color:#94A3B8;">' + totalPages + ' pages</div>' +
                '</div>' +
            '</div>' +
            '<button id="viewerPrintBtn">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                'Save as PDF' +
            '</button>';
        
        var iframe = document.createElement('iframe');
        iframe.id = 'viewerFrame';
        iframe.sandbox = 'allow-scripts allow-modals allow-same-origin';
        iframe.srcdoc = html;

        var printModal = document.createElement('div');
        printModal.id = 'printTipModal';
        printModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);align-items:center;justify-content:center;';
        printModal.innerHTML =
            '<div style="background:#1E293B;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:36px 40px;max-width:500px;width:90%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.5);font-family:inherit;">' +
                '<div style="width:56px;height:56px;border-radius:14px;background:rgba(129,140,248,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#818CF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                '</div>' +
                '<div style="color:#F8FAFC;font-size:22px;font-weight:700;margin-bottom:20px;">Mẹo in chuẩn xác</div>' +
                '<div style="color:#F1F5F9;font-size:16px;line-height:1.8;margin-bottom:30px;text-align:left;-webkit-font-smoothing:antialiased;">' +
                    'Để PDF tải về có kích thước lớn và rõ nét nhất, bạn hãy làm theo các bước sau trong hộp thoại in nhé:<br><br>' +
                    '<div style="padding-left:14px; border-left: 3px solid #818CF8; display:flex; flex-direction:column; gap:8px;">' +
                        '<div>1. Kéo xuống ấn mở mục <strong style="color:#ffffff;font-size:17px;">More settings</strong> (Cài đặt khác).</div>' +
                        '<div>2. Ở bảng thả xuống <strong style="color:#ffffff;font-size:17px;">Scale</strong> (Tỷ lệ), chọn <strong style="color:#818CF8;font-size:17px;">Custom</strong> (Tùy chỉnh).</div>' +
                        '<div>3. Gõ số <span style="background:rgba(129,140,248,0.2);color:#818CF8;padding:2px 8px;border-radius:6px;font-weight:800;letter-spacing:1px;font-size:17px;">200</span> vào ô trống rồi bấm Save.</div>' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;gap:12px;justify-content:center;">' +
                    '<button id="printTipCancel" style="padding:14px 28px;border-radius:12px;background:rgba(255,255,255,0.05);color:#F8FAFC;border:1px solid rgba(255,255,255,0.1);font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;">Huỷ bỏ</button>' +
                    '<button id="printTipOk" style="padding:14px 28px;border-radius:12px;background:linear-gradient(135deg, #818CF8, #6366F1);color:#fff;border:none;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;box-shadow:0 4px 15px rgba(99,102,241,0.3);">Tiếp tục</button>' +
                '</div>' +
            '</div>';

        wrap.appendChild(header);
        wrap.appendChild(iframe);
        wrap.appendChild(printModal);

        // Events
        document.getElementById('viewerBackBtn').addEventListener('click', function() {
            wrap.style.display = 'none';
            document.getElementById('app-wrapper').style.display = 'flex';
            reset();
        });

        document.getElementById('viewerPrintBtn').addEventListener('click', function() {
            printModal.style.display = 'flex';
        });

        document.getElementById('printTipCancel').addEventListener('click', function() {
            printModal.style.display = 'none';
        });

        document.getElementById('printTipOk').addEventListener('click', function() {
            printModal.style.display = 'none';
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage('print', '*');
            }
        });
    }

})();
