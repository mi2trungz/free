(function() {
    var form = document.getElementById('fetchForm');
    var urlInput = document.getElementById('url');
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
    var errorOverlay = document.getElementById('errorOverlay');
    var errorTitle = document.getElementById('errorTitle');
    var errorMsg = document.getElementById('errorMsg');
    var errorHint = document.getElementById('errorHint');

    var queueId = null;
    var queueInterval = null;
    var QUEUE_HEARTBEAT_MS = 10000;
    var API_BASE = window.location.origin;

    function setButtonState(isLoading, label) {
        btn.disabled = !!isLoading;
        btn.querySelector('span').textContent = label;
    }

    function reset() {
        if (queueInterval) {
            clearInterval(queueInterval);
        }
        queueInterval = null;
        queueId = null;
        setButtonState(false, 'Tải file ngay');
        statusBox.style.display = 'none';
        progressInfo.style.display = 'none';
        queueStatus.style.display = 'none';
        progressBar.style.width = '0%';
        progressLabel.textContent = '0 / 0 trang';
        progressPct.textContent = '0%';
        queueBar.style.width = '0%';
        queueDetail.textContent = '';
    }

    function updateStatus(message) {
        statusBox.style.display = 'flex';
        statusText.textContent = message;
    }

    function showError(title, message, hint) {
        errorTitle.textContent = title || 'Đã xảy ra lỗi';
        errorMsg.textContent = message || 'Không thể xử lý yêu cầu lúc này.';
        errorHint.textContent = hint || 'Bạn hãy thử lại sau ít phút.';
        errorOverlay.classList.add('visible');
    }

    document.getElementById('errorCloseBtn').addEventListener('click', function() {
        errorOverlay.classList.remove('visible');
    });

    errorOverlay.addEventListener('click', function(event) {
        if (event.target === errorOverlay) {
            errorOverlay.classList.remove('visible');
        }
    });

    function showQueueState(queueState) {
        var pos = Number(queueState.position || 0);
        var total = Number(queueState.total || 0);
        var ahead = Number(queueState.ahead || Math.max(pos - 1, 0));

        queueStatus.style.display = 'block';
        statusBox.style.display = 'none';

        if (pos === 1) {
            queueText.textContent = 'Đã đến lượt của bạn, hệ thống đang bắt đầu tải.';
        } else {
            queueText.textContent = 'Đang chờ đến lượt xử lý.';
        }

        var pct = total > 0 ? Math.max(5, ((total - pos + 1) / total) * 100) : 0;
        queueBar.style.width = pct + '%';
        queueDetail.textContent = 'Còn ' + ahead + ' người phía trước | Vị trí của bạn: ' + pos;
    }

    function updateProgress(done, total) {
        progressInfo.style.display = 'block';
        statusBox.style.display = 'none';
        queueStatus.style.display = 'none';

        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progressBar.style.width = pct + '%';
        progressLabel.textContent = done + ' / ' + total + ' trang';
        progressPct.textContent = pct + '%';
    }

    function buildResponseError(prefix, response, bodyText) {
        var safePrefix = prefix || 'Yêu cầu thất bại';
        var statusSuffix = response ? ' (HTTP ' + response.status + ')' : '';
        var snippet = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        return new Error(snippet ? (safePrefix + statusSuffix + ': ' + snippet) : (safePrefix + statusSuffix));
    }

    function parseJsonSafely(text, prefix, response) {
        var rawText = String(text || '');
        if (!rawText.trim()) {
            throw buildResponseError(prefix || 'Phản hồi JSON rỗng', response, rawText);
        }
        try {
            return JSON.parse(rawText);
        } catch (err) {
            throw buildResponseError(prefix || 'Phản hồi JSON không hợp lệ', response, rawText);
        }
    }

    function mapErrorMessage(message) {
        var raw = String(message || '').trim();
        var lower = raw.toLowerCase();

        if (!raw) return 'Hệ thống tạm thời chưa xử lý được yêu cầu.';
        if (lower.indexOf('could not find document id in url') !== -1) {
            return 'Không tìm thấy mã tài liệu trong liên kết. Hãy dán đúng link Studocu của một tài liệu cụ thể.';
        }
        if (lower.indexOf('queue join failed') !== -1) {
            return 'Không thể tham gia hàng đợi lúc này. Bạn vui lòng thử lại sau ít phút.';
        }
        if (lower.indexOf('queue heartbeat failed') !== -1) {
            return 'Không cập nhật được trạng thái hàng đợi. Hãy thử lại một lần nữa.';
        }
        if (lower.indexOf('studocu fetch failed') !== -1) {
            return 'Không thể lấy dữ liệu tài liệu từ Studocu lúc này. Bạn hãy kiểm tra link và thử lại.';
        }
        if (lower.indexOf('failed to fetch') !== -1 || lower.indexOf('networkerror') !== -1) {
            return 'Không kết nối được đến máy chủ xử lý. Bạn hãy kiểm tra mạng rồi thử lại.';
        }
        return raw;
    }

    function fetchJson(url, options, errorPrefix) {
        return fetch(url, options).then(function(response) {
            return response.text().then(function(bodyText) {
                var data = parseJsonSafely(bodyText, errorPrefix, response);
                if (!response.ok) {
                    if (data && data.error) {
                        throw new Error(data.error);
                    }
                    throw buildResponseError(errorPrefix || 'Yêu cầu thất bại', response, bodyText);
                }
                return data;
            });
        });
    }

    function normalizeStudocuInput(rawValue) {
        var value = String(rawValue || '').trim();
        if (!value) {
            return '';
        }

        if (!/^[a-z]+:\/\//i.test(value)) {
            value = 'https://' + value.replace(/^\/+/, '');
        } else if (/^http:\/\//i.test(value)) {
            value = value.replace(/^http:\/\//i, 'https://');
        }

        try {
            var parsed = new URL(value);
            parsed.protocol = 'https:';
            if (/\.studocu\.vn$/i.test(parsed.hostname)) {
                parsed.hostname = parsed.hostname.replace(/\.vn$/i, '.com');
            }
            return parsed.toString();
        } catch (error) {
            return value;
        }
    }

    function isStudocuHost(hostname) {
        var host = String(hostname || '').toLowerCase();
        return host === 'studocu.com' ||
            host === 'www.studocu.com' ||
            host === 'studocu.vn' ||
            host === 'www.studocu.vn' ||
            /\.studocu\.com$/i.test(host) ||
            /\.studocu\.vn$/i.test(host);
    }

    function getValidatedStudocuUrl(rawValue) {
        var normalized = normalizeStudocuInput(rawValue);
        if (!normalized) {
            return { ok: false, value: '', reason: 'empty' };
        }

        try {
            var parsed = new URL(normalized);
            if (parsed.protocol !== 'https:' || !isStudocuHost(parsed.hostname)) {
                return { ok: false, value: normalized, reason: 'invalid_domain' };
            }
            return { ok: true, value: parsed.toString(), parsed: parsed };
        } catch (error) {
            return { ok: false, value: normalized, reason: 'invalid_url' };
        }
    }

    function applyNormalizedValue() {
        var normalized = normalizeStudocuInput(urlInput.value);
        if (normalized) {
            urlInput.value = normalized;
        }
    }

    urlInput.addEventListener('blur', applyNormalizedValue);

    function doFetch(docUrl) {
        updateStatus('Đang xác thực và lấy dữ liệu tài liệu...');

        fetchJson(API_BASE + '/ads/serve/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: docUrl, queue_id: queueId })
        }, 'Không thể tải tài liệu Studocu')
            .then(function(data) {
                if (data.error) {
                    reset();
                    showError('Tài liệu chưa sẵn sàng', mapErrorMessage(data.error), 'Bạn hãy kiểm tra lại liên kết Studocu rồi thử lại.');
                    return;
                }
                downloadDocument(data);
            })
            .catch(function(err) {
                reset();
                showError('Không tải được tài liệu', mapErrorMessage(err && err.message), 'Nếu link đúng mà vẫn lỗi, hãy đợi ít phút rồi tải lại.');
            });
    }

    function startQueuedFetch(docUrl) {
        queueId = 'q_' + Math.random().toString(36).slice(2, 14) + '_' + Date.now();
        updateStatus('Đang tham gia hàng đợi xử lý...');

        fetchJson(API_BASE + '/api/queue/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queue_id: queueId })
        }, 'Không thể vào hàng đợi')
            .then(function(qData) {
                if (qData.error) {
                    reset();
                    showError('Hàng đợi tạm thời đầy', mapErrorMessage(qData.error), 'Bạn hãy quay lại sau ít phút để thử lại.');
                    return;
                }

                showQueueState(qData);

                if (qData.position === 1) {
                    doFetch(docUrl);
                    return;
                }

                queueInterval = setInterval(function() {
                    fetchJson(API_BASE + '/api/queue/heartbeat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ queue_id: queueId })
                    }, 'Không cập nhật được hàng đợi')
                        .then(function(hb) {
                            showQueueState(hb);
                            if (hb.position === 1) {
                                clearInterval(queueInterval);
                                queueInterval = null;
                                doFetch(docUrl);
                            }
                        })
                        .catch(function(err) {
                            if (queueInterval) {
                                clearInterval(queueInterval);
                                queueInterval = null;
                            }
                            reset();
                            showError('Lỗi hàng đợi', mapErrorMessage(err && err.message), 'Bạn hãy tải lại trang và thử lại một lần nữa.');
                        });
                }, QUEUE_HEARTBEAT_MS);
            })
            .catch(function(err) {
                reset();
                showError('Không vào được hàng đợi', mapErrorMessage(err && err.message), 'Bạn hãy thử lại sau ít phút.');
            });
    }

    form.addEventListener('submit', function(event) {
        event.preventDefault();

        var result = getValidatedStudocuUrl(urlInput.value);
        if (result.value) {
            urlInput.value = result.value;
        }

        if (!result.ok) {
            if (result.reason === 'empty') {
                showError('Thiếu liên kết', 'Bạn chưa nhập liên kết Studocu.', 'Hãy dán link tài liệu rồi thử lại.');
                return;
            }

            showError(
                'Liên kết chưa đúng',
                'Bạn vui lòng dán đúng một liên kết thuộc hệ Studocu. Ô nhập sẽ tự đổi sang dạng https nếu cần.',
                'Ví dụ hợp lệ: https://www.studocu.com/... hoặc studocu.vn/...'
            );
            return;
        }

        setButtonState(true, 'Đang xử lý...');
        startQueuedFetch(result.value);
    });

    function normalizeFetchUrl(fetchUrl) {
        var url = String(fetchUrl || '').trim();
        if (!url) return '';
        if (url.indexOf('https://api.getthispdf.com') === 0) {
            return url.replace('https://api.getthispdf.com', API_BASE);
        }
        if (url.indexOf('http://api.getthispdf.com') === 0) {
            return url.replace('http://api.getthispdf.com', API_BASE);
        }
        if (url.charAt(0) === '/') {
            return API_BASE + url;
        }
        return url;
    }

    function downloadDocument(data) {
        var title = data.title || 'Tài liệu Studocu';
        var totalPages = Number(data.total_pages || 0);
        var docCss = data.doc_css || '';
        var pngSig = data.png_sig || '';
        var assetBase = data.asset_base || '';
        var currentPages = Array.isArray(data.pages) ? data.pages : [];
        var pageResults = {};
        var completed = 0;

        currentPages.forEach(function(page) {
            if (page.embedded_html) {
                pageResults[page.num] = { status: 'ok', html: page.embedded_html };
                completed++;
            }
        });

        var needDownload = currentPages.filter(function(page) {
            return !page.embedded_html;
        });

        if (needDownload.length === 0) {
            finishDocument(pageResults, docCss, title, totalPages);
            return;
        }

        updateProgress(completed, totalPages);
        var SEND_GAP = 150;

        function rewritePageUrls(html) {
            html = html.replace(/src="(?!https?:\/\/|data:)([^"]*\.png)"/gi, function(match, file) {
                return 'src="' + assetBase + file + pngSig + '"';
            });
            html = html.replace(/src="(?!https?:\/\/|data:)([^"]*\.jpe?g)"/gi, function(match, file) {
                return 'src="' + assetBase + file + pngSig + '"';
            });
            html = html.replace(/url\(["']?(?!https?:\/\/|data:)([^"')\s]*\.png)["']?\)/gi, function(match, file) {
                return 'url("' + assetBase + file + pngSig + '")';
            });
            return html;
        }

        function fetchWithRetry(page) {
            var fetchUrl = normalizeFetchUrl(page.url);

            return fetch(fetchUrl)
                .then(function(resp) {
                    if (!resp.ok) {
                        throw new Error('HTTP ' + resp.status);
                    }
                    return resp.text();
                })
                .then(function(html) {
                    pageResults[page.num] = { status: 'ok', html: rewritePageUrls(html) };
                    completed++;
                    updateProgress(completed, totalPages);
                })
                .catch(function() {
                    pageResults[page.num] = { status: 'error' };
                    completed++;
                    updateProgress(completed, totalPages);
                });
        }

        var promises = needDownload.map(function(page, index) {
            return new Promise(function(resolve) {
                setTimeout(resolve, index * SEND_GAP);
            }).then(function() {
                return fetchWithRetry(page);
            });
        });

        Promise.all(promises).then(function() {
            finishDocument(pageResults, docCss, title, totalPages);
        });
    }

    function escapeHtml(value) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(value || '')));
        return div.innerHTML;
    }

    function finishDocument(pageResults, docCss, title, totalPages) {
        updateProgress(totalPages, totalPages);

        setTimeout(function() {
            var pagesHtml = '';
            for (var i = 1; i <= totalPages; i++) {
                var page = pageResults[i];
                if (page && page.status === 'ok' && page.html) {
                    pagesHtml += '<div class="pf w0 h0" id="pf' + i + '"><div class="page-num">Trang ' + i + '</div>' + page.html + '</div>';
                } else {
                    pagesHtml += '<div class="pf w0 h0" id="pf' + i + '" style="height:842px;"><div class="page-num">Trang ' + i + '</div><div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font:600 16px/1.6 sans-serif;">Không tải được nội dung trang này</div></div>';
                }
            }

            var viewerHtml = '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">' +
                '<meta name="viewport" content="width=device-width, initial-scale=1">' +
                '<title>' + escapeHtml(title) + '</title>' +
                '<style>' + docCss.replace(/<\//gi, '<\\/') + '</style>' +
                '<style>' +
                'html,body{margin:0;padding:0;background:#f3f4f6;}' +
                'body{font-family:"Be Vietnam Pro",sans-serif;color:#111827;min-height:100vh;}' +
                '.p2hv #page-container{position:relative;padding:24px 0 52px;width:100%;display:flex;flex-direction:column;align-items:center;}' +
                '.p2hv .pf{margin:20px auto!important;box-shadow:0 16px 36px rgba(15,23,42,.12);overflow:hidden!important;border-radius:14px;background:#fff;position:relative;}' +
                '.page-num{position:absolute;top:12px;right:12px;background:rgba(16,185,129,.92);color:#fff;font:700 12px/1 "Be Vietnam Pro",sans-serif;padding:7px 12px;border-radius:999px;z-index:10;pointer-events:none;}' +
                '@media print{html,body{background:#fff!important;margin:0;padding:0;}.page-num{display:none!important}.p2hv #page-container{padding:0}.p2hv .pf{margin:0!important;box-shadow:none!important;border:none!important;border-radius:0!important;page-break-after:always;}}' +
                '</style></head><body>' +
                '<div class="p2hv"><div id="page-container">' + pagesHtml + '</div></div>' +
                '<scr' + 'ipt>' +
                'window.addEventListener("message",function(e){if(e.data==="print"){window.print();}});' +
                '<\/scr' + 'ipt></body></html>';

            showViewer(viewerHtml, title, totalPages);
        }, 450);
    }

    function showViewer(html, title, totalPages) {
        document.getElementById('app-wrapper').style.display = 'none';

        var wrap = document.getElementById('viewerWrap');
        wrap.innerHTML = '';
        wrap.style.display = 'flex';

        var header = document.createElement('div');
        header.id = 'viewerHeader';
        header.innerHTML =
            '<div style="display:flex;align-items:center;gap:14px;min-width:0;">' +
                '<button id="viewerBackBtn" title="Quay lại"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>' +
                '<div style="min-width:0;">' +
                    '<div style="font-weight:800;font-size:15px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(title) + '</div>' +
                    '<div style="font-size:12px;color:#6b7280;">' + totalPages + ' trang tài liệu</div>' +
                '</div>' +
            '</div>' +
            '<button id="viewerPrintBtn">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                'Lưu hoặc in PDF' +
            '</button>';

        var iframe = document.createElement('iframe');
        iframe.id = 'viewerFrame';
        iframe.sandbox = 'allow-scripts allow-modals allow-same-origin';
        iframe.srcdoc = html;

        var printModal = document.createElement('div');
        printModal.id = 'printTipModal';
        printModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.36);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:18px;';
        printModal.innerHTML =
            '<div style="background:rgba(255,255,255,0.97);border:1px solid rgba(255,255,255,0.42);border-radius:24px;padding:30px;max-width:520px;width:100%;box-shadow:0 22px 50px rgba(15,23,42,0.14);font-family:Be Vietnam Pro,sans-serif;">' +
                '<div style="width:58px;height:58px;border-radius:18px;background:rgba(16,185,129,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;color:#059669;">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                '</div>' +
                '<div style="text-align:center;color:#111827;font-size:24px;font-weight:900;margin-bottom:14px;">Mẹo lưu PDF rõ hơn</div>' +
                '<div style="color:#4b5563;font-size:15px;line-height:1.8;margin-bottom:24px;">' +
                    'Khi hộp thoại in xuất hiện, bạn nên mở <strong style="color:#111827;">Cài đặt khác</strong>, đổi <strong style="color:#111827;">Tỷ lệ</strong> sang <strong style="color:#111827;">Tùy chỉnh</strong> và nhập <strong style="color:#059669;">200</strong> để file PDF sắc nét hơn.' +
                '</div>' +
                '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
                    '<button id="printTipCancel" style="padding:13px 22px;border-radius:999px;background:rgba(148,163,184,0.12);color:#334155;border:1px solid rgba(148,163,184,0.2);font-size:15px;font-weight:700;cursor:pointer;">Để sau</button>' +
                    '<button id="printTipOk" style="padding:13px 22px;border-radius:999px;background:linear-gradient(135deg,#10b981 0%,#0d9488 100%);color:#fff;border:none;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 12px 24px rgba(16,185,129,0.22);">Mở hộp thoại in</button>' +
                '</div>' +
            '</div>';

        wrap.appendChild(header);
        wrap.appendChild(iframe);
        wrap.appendChild(printModal);

        document.getElementById('viewerBackBtn').addEventListener('click', function() {
            wrap.style.display = 'none';
            document.getElementById('app-wrapper').style.display = 'block';
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
