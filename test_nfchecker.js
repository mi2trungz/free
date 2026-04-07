// DOM Elements
const cookieInput = document.getElementById('cookie-input');
const loadFileBtn = document.getElementById('load-file-btn');
const pasteBtn = document.getElementById('paste-btn');
const clearBtn = document.getElementById('clear-btn');
const generateBtn = document.getElementById('generate-btn');
const progress = document.getElementById('progress');
const status = document.getElementById('status');
const results = document.getElementById('results');
const copyResultsBtn = document.getElementById('copy-results-btn');
const modeOptions = document.querySelectorAll('.mode-option');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const batchFiles = document.getElementById('batch-files');
const fileList = document.getElementById('file-list');
const processBatchBtn = document.getElementById('process-batch-btn');
const batchProgress = document.getElementById('batch-progress');
const batchStatus = document.getElementById('batch-status');
const batchResults = document.getElementById('batch-results');
const saveResultsBtn = document.getElementById('save-results-btn');
const totalFiles = document.getElementById('total-files');
const validFiles = document.getElementById('valid-files');
const invalidFiles = document.getElementById('invalid-files');
const notification = document.getElementById('notification');

// Telegram Elements
const telegramToggle = document.getElementById('telegram-toggle');
const telegramConfig = document.getElementById('telegram-config');
const botTokenInput = document.getElementById('bot-token');
const chatIdInput = document.getElementById('chat-id');
const testTelegramBtn = document.getElementById('test-telegram-btn');
const telegramStatus = document.getElementById('telegram-status');

// Global variables
let currentMode = 'fullinfo';
let selectedFiles = [];
let batchResultsData = [];

// Event Listeners
document.addEventListener('DOMContentLoaded', initApp);
loadFileBtn.addEventListener('click', handleLoadFile);
pasteBtn.addEventListener('click', handlePaste);
clearBtn.addEventListener('click', handleClear);
generateBtn.addEventListener('click', handleGenerate);
copyResultsBtn.addEventListener('click', handleCopyResults);
modeOptions.forEach(option => {
    option.addEventListener('click', handleModeChange);
});
tabs.forEach(tab => {
    tab.addEventListener('click', handleTabChange);
});
batchFiles.addEventListener('change', handleBatchFilesChange);
processBatchBtn.addEventListener('click', handleProcessBatch);
saveResultsBtn.addEventListener('click', handleSaveResults);

// Initialize the application
function initApp() {
    updateFileList();
    initTelegram();
    handleResponsive();

    // Add resize listener
    window.addEventListener('resize', handleResponsive);
}

// Handle responsive behavior
function handleResponsive() {
    const width = window.innerWidth;

    if (width < 768) {
        // Mobile optimizations
        document.body.classList.add('mobile');

        // Adjust card padding for mobile
        document.querySelectorAll('.card').forEach(card => {
            card.style.padding = '15px';
        });

    } else {
        document.body.classList.remove('mobile');

        // Reset card padding for desktop
        document.querySelectorAll('.card').forEach(card => {
            card.style.padding = '25px';
        });
    }
}

// Handle mode change (Full Info / Token Only)
function handleModeChange(e) {
    const mode = e.target.dataset.mode;
    currentMode = mode;

    modeOptions.forEach(option => {
        option.classList.remove('active');
    });

    e.target.classList.add('active');
}

// Handle tab change
function handleTabChange(e) {
    const tabId = e.target.dataset.tab;

    tabs.forEach(tab => {
        tab.classList.remove('active');
    });

    tabContents.forEach(content => {
        content.classList.remove('active');
    });

    e.target.classList.add('active');
    document.getElementById(`${tabId}-tab`).classList.add('active');
}

// Handle load file
function handleLoadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json,.zip';

    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
            cookieInput.value = e.target.result;
            showNotification('File loaded successfully');
        };
        reader.readAsText(file);
    };

    input.click();
}

// Handle paste from clipboard
function handlePaste() {
    navigator.clipboard.readText()
        .then(text => {
            cookieInput.value = text;
            showNotification('Content pasted from clipboard');
        })
        .catch(err => {
            showNotification('Failed to read clipboard', true);
        });
}

// Handle clear input
function handleClear() {
    cookieInput.value = '';
    showNotification('Input cleared');
}

// Handle generate token
async function handleGenerate() {
    const content = cookieInput.value.trim();
    if (!content) {
        showNotification('Please enter some content first', true);
        return;
    }

    // Disable button and show progress
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<div class="spinner"></div> Processing...';
    progress.style.width = '0%';
    status.textContent = 'Extracting NetflixId...';

    try {
        const response = await fetch('/api/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content,
                mode: currentMode
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            progress.style.width = '100%';
            status.textContent = 'Processing complete';
            displayResults(data);
            showNotification('Token generated successfully');
        } else {
            progress.style.width = '100%';
            status.textContent = 'Processing failed';
            displayError(data.message);
            showNotification(data.message, true);
        }
    } catch (error) {
        progress.style.width = '100%';
        status.textContent = 'Processing failed';
        displayError('Network error: ' + error.message);
        showNotification('Network error: ' + error.message, true);
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-key"></i> Generate Token';
    }
}

// Handle copy results
function handleCopyResults() {
    const resultsText = results.innerText;
    navigator.clipboard.writeText(resultsText)
        .then(() => {
            showNotification('Results copied to clipboard');
        })
        .catch(err => {
            showNotification('Failed to copy results', true);
        });
}

// Handle batch files change
function handleBatchFilesChange(e) {
    selectedFiles = Array.from(e.target.files);
    updateFileList();
}

// Update file list display
function updateFileList() {
    fileList.innerHTML = '';

    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<div class="file-item"><span>No files selected</span></div>';
        return;
    }

    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name}</span>
            <span class="file-status">Pending</span>
        `;
        fileList.appendChild(fileItem);
    });

    totalFiles.textContent = selectedFiles.length;
    validFiles.textContent = '0';
    invalidFiles.textContent = '0';
}

// Update file list to show processing status
function updateFileListProcessing() {
    fileList.innerHTML = '';

    selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name}</span>
            <span class="file-status processing">Processing...</span>
        `;
        fileList.appendChild(fileItem);
    });
}

// Handle process batch
async function handleProcessBatch() {
    if (selectedFiles.length === 0) {
        showNotification('Please select files first', true);
        return;
    }

    // Reset results
    batchResultsData = [];
    batchResults.innerHTML = '';
    saveResultsBtn.disabled = true;

    // Disable button and show progress
    processBatchBtn.disabled = true;
    processBatchBtn.innerHTML = '<div class="spinner"></div> Processing...';
    batchProgress.style.width = '0%';
    batchStatus.textContent = 'Processing batch...';

    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });
    formData.append('mode', currentMode);

    try {
        // Update file list status to processing
        updateFileListProcessing();

        const response = await fetch('/api/batch-check', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.status === 'success') {
            batchResultsData = data.results;
            displayBatchResults(batchResultsData);
            batchProgress.style.width = '100%';
            batchStatus.textContent = 'Batch processing complete';
            saveResultsBtn.disabled = false;
            showNotification(`Batch processing completed: ${batchResultsData.filter(r => r.status === 'success').length} valid, ${batchResultsData.filter(r => r.status === 'error').length} invalid`);
        } else {
            batchProgress.style.width = '100%';
            batchStatus.textContent = 'Batch processing failed';
            showNotification(data.message, true);
        }
    } catch (error) {
        batchProgress.style.width = '100%';
        batchStatus.textContent = 'Batch processing failed';
        showNotification('Network error: ' + error.message, true);
    } finally {
        processBatchBtn.disabled = false;
        processBatchBtn.innerHTML = '<i class="fas fa-cogs"></i> Process Batch';
    }
}

// Display batch results in detailed single line format
function displayBatchResults(results) {
    batchResults.innerHTML = '';

    let validCount = 0;
    let invalidCount = 0;

    results.forEach(result => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item single-line-result';

        if (result.status === 'success') {
            const account = result.account_info;
            const token = result.token_result;

            let statusText = `✅ ${result.filename} | `;
            statusText += `Status: ${account.ok ? 'Valid' : 'Invalid'} | `;
            statusText += `Premium: ${account.premium ? 'Yes' : 'No'} | `;
            statusText += `Country: ${account.country} | `;
            statusText += `Plan: ${account.plan} | `;
            statusText += `Price: ${account.plan_price} | `;
            statusText += `Payment Hold: ${account.on_payment_hold} | `;
            statusText += `Max Streams: ${account.max_streams}`;

            if (token.status === 'Success') {
                statusText += ` | Token: ${token.token.substring(0, 15)}...`;
            }

            fileItem.innerHTML = `
                <div class="file-info">
                    <span>${statusText}</span>
                </div>
                <span class="file-status valid">Valid</span>
            `;
            validCount++;
        } else {
            fileItem.innerHTML = `
                <div class="file-info">
                    <span>❌ ${result.filename}: ${result.message}</span>
                </div>
                <span class="file-status invalid">Invalid</span>
            `;
            invalidCount++;
        }

        batchResults.appendChild(fileItem);
    });

    validFiles.textContent = validCount;
    invalidFiles.textContent = invalidCount;

    // Update success rate
    const successRate = ((validCount / results.length) * 100).toFixed(2);
    batchStatus.textContent = `Complete - Success Rate: ${successRate}%`;
}

// Handle save results
function handleSaveResults() {
    if (batchResultsData.length === 0) {
        showNotification('No results to save', true);
        return;
    }

    let content = 'Netflix Cookies Checker - Batch Results\n';
    content += 'Generated on: ' + new Date().toLocaleString() + '\n';
    content += 'Created by: https://t.me/firet_official (FireT)\n\n';
    content += '='.repeat(80) + '\n\n';

    let validCount = 0;
    let invalidCount = 0;

    batchResultsData.forEach(result => {
        if (result.status === 'success') {
            validCount++;
            const account = result.account_info;
            const token = result.token_result;

            content += `✅ ${result.filename}\n`;
            content += `NetflixId: ${result.netflix_id}\n`;
            content += `Status: ${account.ok ? 'Valid' : 'Invalid'}\n`;
            content += `Premium: ${account.premium ? 'Yes' : 'No'}\n`;
            content += `Country: ${account.country}\n`;
            content += `Plan: ${account.plan}\n`;
            content += `Price: ${account.plan_price}\n`;
            content += `Member Since: ${account.member_since}\n`;
            content += `Payment Method: ${account.payment_method}\n`;
            content += `Phone: ${account.phone}\n`;
            content += `Phone Verified: ${account.phone_verified}\n`;
            content += `Video Quality: ${account.video_quality}\n`;
            content += `Max Streams: ${account.max_streams}\n`;
            content += `Payment Hold: ${account.on_payment_hold}\n`;
            content += `Extra Member: ${account.extra_member}\n`;
            content += `Email: ${account.email}\n`;
            content += `Email Verified: ${account.email_verified}\n`;
            content += `Profiles: ${account.profiles}\n`;
            content += `Billing: ${account.next_billing}\n`;

            if (token.status === 'Success') {
                content += `Token: ${token.token}\n`;
                content += `Login URL: ${token.direct_login_url}\n`;
                content += `Token Expires: ${new Date(token.expires * 1000).toLocaleString()}\n`;
                content += `Time Remaining: ${Math.floor(token.time_remaining / 86400)}d ${Math.floor((token.time_remaining % 86400) / 3600)}h ${Math.floor((token.time_remaining % 3600) / 60)}m\n`;
            } else {
                content += `Token Error: ${token.error}\n`;
            }

            content += '\n' + '─'.repeat(80) + '\n\n';
        } else {
            invalidCount++;
            content += `❌ ${result.filename}: ${result.message}\n\n`;
            content += '─'.repeat(80) + '\n\n';
        }
    });

    content += `\nSUMMARY\n`;
    content += `Total Files: ${batchResultsData.length}\n`;
    content += `Valid: ${validCount}\n`;
    content += `Invalid: ${invalidCount}\n`;
    content += `Success Rate: ${((validCount / batchResultsData.length) * 100).toFixed(2)}%\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netflix_batch_results_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('Results saved successfully');
}

// Enhanced displayResults function with dropdown and scroll
function displayResults(data) {
    let html = '';

    if (currentMode === 'fullinfo') {
        const account = data.account_info;

        html = `
            <div class="result-item">
                <div class="result-title">
                    <i class="fas fa-user-circle"></i>
                    ACCOUNT OVERVIEW
                    ${data.telegram_sent ? '<span class="telegram-hit-indicator"><i class="fab fa-telegram"></i> Telegram</span>' : ''}
                </div>
                <div class="result-content">
                    <div class="quick-stats">
                        <div class="stat-badge ${account.ok ? 'valid' : 'invalid'}">${account.ok ? 'VALID' : 'INVALID'}</div>
                        <div class="stat-badge ${account.premium ? 'premium' : 'basic'}">${account.premium ? 'PREMIUM' : 'BASIC'}</div>
                        <div class="stat-badge country">${account.country}</div>
                    </div>
                    
                    <button class="dropdown-toggle" onclick="toggleResults(this)">
                        <i class="fas fa-chevron-down"></i>
                        Show Full Account Details
                    </button>
                    <div class="dropdown-content" style="display: none;">
                        <div class="section-header">
                            <i class="fas fa-id-card"></i>
                            ACCOUNT INFORMATION
                        </div>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Status:</span>
                                <span class="info-value ${account.ok ? 'status-valid' : 'status-invalid'}">${account.ok ? 'Valid' : 'Invalid'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Premium:</span>
                                <span class="info-value ${account.premium ? 'status-premium' : ''}">${account.premium ? 'Yes' : 'No'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Country:</span>
                                <span class="info-value">${account.country}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Plan:</span>
                                <span class="info-value">${account.plan}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Price:</span>
                                <span class="info-value">${account.plan_price}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Member Since:</span>
                                <span class="info-value">${account.member_since}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Payment Method:</span>
                                <span class="info-value">${account.payment_method}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Phone:</span>
                                <span class="info-value">${account.phone}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Phone Verified:</span>
                                <span class="info-value">${account.phone_verified}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Video Quality:</span>
                                <span class="info-value">${account.video_quality}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Max Streams:</span>
                                <span class="info-value">${account.max_streams}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Payment Hold:</span>
                                <span class="info-value">${account.on_payment_hold}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Extra Member:</span>
                                <span class="info-value">${account.extra_member}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Email:</span>
                                <span class="info-value">${account.email.replace(/\\x40/g, '@')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Email Verified:</span>
                                <span class="info-value">${account.email_verified}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Profiles:</span>
                                <span class="info-value">${account.profiles}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Billing:</span>
                                <span class="info-value">${account.next_billing}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    const token = data.token_result;
    if (token.status === 'Success') {
        const genTime = new Date(token.generation_time * 1000).toLocaleString();
        const expTime = new Date(token.expires * 1000).toLocaleString();

        const days = Math.floor(token.time_remaining / 86400);
        const hours = Math.floor((token.time_remaining % 86400) / 3600);
        const minutes = Math.floor((token.time_remaining % 3600) / 60);
        const seconds = token.time_remaining % 60;

        html += `
            <div class="result-item">
                <div class="result-title">
                    <i class="fas fa-key"></i>
                    TOKEN INFORMATION
                </div>
                <div class="result-content">
                    <div class="token-info">
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Status:</span>
                                <span class="info-value status-valid">${token.status}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Generation Time:</span>
                                <span class="info-value">${genTime}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Expiry:</span>
                                <span class="info-value">${expTime}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Time Remaining:</span>
                                <span class="info-value">${days}d ${hours}h ${minutes}m ${seconds}s</span>
                            </div>
                        </div>
                        
                        <div style="margin-top: 15px;">
                            <div class="info-label" style="margin-bottom: 8px;">Direct Login URL:</div>
                            <div class="token-url">${token.direct_login_url}</div>
                            <button class="copy-btn" data-text="${token.direct_login_url}">
                                <i class="fas fa-copy"></i> Copy Login URL
                            </button>
                        </div>
                        
                        <div style="margin-top: 15px;">
                            <div class="info-label" style="margin-bottom: 8px;">Token:</div>
                            <div class="token-url">${token.token}</div>
                            <button class="copy-btn" data-text="${token.token}">
                                <i class="fas fa-copy"></i> Copy Token
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="result-item">
                <div class="result-title">
                    <i class="fas fa-times-circle" style="color: var(--danger);"></i>
                    TOKEN GENERATION FAILED
                </div>
                <div class="result-content">
                    <div class="info-item">
                        <span class="info-label">Error:</span>
                        <span class="info-value">${token.error}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Update the results container
    results.innerHTML = html;

    // Enable copy buttons
    copyResultsBtn.disabled = false;

    // Add event listeners to copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const text = this.dataset.text;
            navigator.clipboard.writeText(text)
                .then(() => {
                    showNotification('Copied to clipboard');
                })
                .catch(err => {
                    showNotification('Failed to copy', true);
                });
        });
    });
}

// Display error
function displayError(message) {
    results.innerHTML = `
        <div class="result-item">
            <div class="result-title">
                <i class="fas fa-times-circle" style="color: var(--danger);"></i>
                Error
            </div>
            <div class="result-content">
                ${message}
            </div>
        </div>
    `;
    copyResultsBtn.disabled = false;
}

// Show notification
function showNotification(message, isError = false) {
    notification.textContent = message;
    notification.className = 'notification';

    if (isError) {
        notification.classList.add('error');
    }

    notification.classList.add('show');

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Toggle dropdown for results
function toggleResults(button) {
    const dropdownContent = button.nextElementSibling;
    const isVisible = dropdownContent.style.display === 'block';

    if (isVisible) {
        dropdownContent.style.display = 'none';
        button.classList.remove('active');
        button.innerHTML = '<i class="fas fa-chevron-down"></i> Show Account Details';
    } else {
        dropdownContent.style.display = 'block';
        button.classList.add('active');
        button.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Account Details';
    }
}

// Close all dropdowns when clicking outside
document.addEventListener('click', function (event) {
    if (!event.target.closest('.dropdown-toggle')) {
        document.querySelectorAll('.dropdown-content').forEach(content => {
            content.style.display = 'none';
        });
        document.querySelectorAll('.dropdown-toggle').forEach(button => {
            button.classList.remove('active');
            button.innerHTML = '<i class="fas fa-chevron-down"></i> Show Account Details';
        });
    }
});

// Telegram Hit Sender functionality

// Load saved Telegram config
function loadTelegramConfig() {
    const savedConfig = localStorage.getItem('telegramConfig');
    if (savedConfig) {
        const config = JSON.parse(savedConfig);
        telegramToggle.checked = config.enabled || false;
        botTokenInput.value = config.bot_token || '';
        chatIdInput.value = config.chat_id || '';
        updateTelegramUI();
    }
}

// Update Telegram UI based on toggle state
function updateTelegramUI() {
    if (telegramToggle.checked) {
        telegramConfig.style.display = 'block';
        telegramStatus.className = 'telegram-status enabled';
        telegramStatus.innerHTML = '<i class="fas fa-check-circle"></i> Telegram hits are enabled';
    } else {
        telegramConfig.style.display = 'none';
        telegramStatus.className = 'telegram-status disabled';
        telegramStatus.innerHTML = '<i class="fas fa-times-circle"></i> Telegram hits are disabled';
    }
}

// Save Telegram config
function saveTelegramConfig() {
    const config = {
        enabled: telegramToggle.checked,
        bot_token: botTokenInput.value,
        chat_id: chatIdInput.value
    };
    localStorage.setItem('telegramConfig', JSON.stringify(config));

    // Send to server
    fetch('/api/telegram-config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(config)
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showNotification('Telegram configuration saved');
            } else {
                showNotification('Error saving Telegram config', true);
            }
        })
        .catch(error => {
            showNotification('Error saving Telegram config', true);
        });
}

// Test Telegram connection
function testTelegramConnection() {
    if (!botTokenInput.value || !chatIdInput.value) {
        showNotification('Please enter both Bot Token and Chat ID', true);
        return;
    }

    testTelegramBtn.disabled = true;
    testTelegramBtn.innerHTML = '<div class="spinner"></div> Testing...';
    telegramStatus.className = 'telegram-status testing';
    telegramStatus.innerHTML = '<i class="fas fa-sync-alt"></i> Testing Telegram connection...';

    // Simple test by sending a test message
    const testMessage = {
        chat_id: chatIdInput.value,
        text: '✅ Netflix Cookies Checker Test\n\nThis is a test message from your Netflix Cookies Checker. If you receive this, your Telegram configuration is working correctly!',
        parse_mode: 'Markdown'
    };

    fetch(`https://api.telegram.org/bot${botTokenInput.value}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(testMessage)
    })
        .then(response => response.json())
        .then(data => {
            if (data.ok) {
                telegramStatus.className = 'telegram-status enabled';
                telegramStatus.innerHTML = '<i class="fas fa-check-circle"></i> Telegram connection successful!';
                showNotification('Telegram test successful!');
            } else {
                telegramStatus.className = 'telegram-status disabled';
                telegramStatus.innerHTML = `<i class="fas fa-times-circle"></i> Telegram error: ${data.description || 'Unknown error'}`;
                showNotification('Telegram test failed: ' + (data.description || 'Unknown error'), true);
            }
        })
        .catch(error => {
            telegramStatus.className = 'telegram-status disabled';
            telegramStatus.innerHTML = '<i class="fas fa-times-circle"></i> Telegram connection failed';
            showNotification('Telegram test failed: Network error', true);
        })
        .finally(() => {
            testTelegramBtn.disabled = false;
            testTelegramBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test Connection';
        });
}

// Initialize Telegram functionality
function initTelegram() {
    loadTelegramConfig();

    telegramToggle.addEventListener('change', function () {
        updateTelegramUI();
        saveTelegramConfig();
    });

    botTokenInput.addEventListener('input', saveTelegramConfig);
    chatIdInput.addEventListener('input', saveTelegramConfig);
    testTelegramBtn.addEventListener('click', testTelegramConnection);

    updateTelegramUI();
}