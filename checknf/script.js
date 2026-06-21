document.addEventListener('DOMContentLoaded', () => {
    const cookieInput = document.getElementById('cookieInput');
    const generateBtn = document.getElementById('generateBtn');
    const outputContainer = document.getElementById('outputContainer');
    const resultUrl = document.getElementById('resultUrl');
    const copyBtn = document.getElementById('copyBtn');
    const openLinkBtn = document.getElementById('openLinkBtn');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    // Make the textarea glow based on input content
    cookieInput.addEventListener('input', (e) => {
        if (e.target.value.trim().length > 0) {
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        } else {
            e.target.style.borderColor = 'var(--glass-border)';
        }
    });

    generateBtn.addEventListener('click', () => {
        // Reset states
        errorMessage.style.display = 'none';
        outputContainer.style.display = 'none';

        // Add a slight click animation scale
        generateBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            generateBtn.style.transform = '';
        }, 150);

        const text = cookieInput.value.trim();

        if (!text) {
            showError('Please paste your Netscape cookies first.');
            return;
        }

        generateToken(text).then(result => {
            if (result.error) {
                showError(result.error);
            } else {
                // Show Success
                resultUrl.value = result.url;
                openLinkBtn.href = result.url;
                outputContainer.style.display = 'block';

                // Scroll to output smoothly
                setTimeout(() => {
                    outputContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 50);
            }
        }).catch(err => {
            showError('Network error. Make sure the local server is running.');
        });
    });

    copyBtn.addEventListener('click', () => {
        resultUrl.select();
        document.execCommand('copy');

        // Show tooltip temporarily
        copyBtn.classList.add('show-tooltip');
        copyBtn.querySelector('.tooltiptext').innerText = 'Copied!';

        setTimeout(() => {
            copyBtn.classList.remove('show-tooltip');
            setTimeout(() => {
                copyBtn.querySelector('.tooltiptext').innerText = 'Copy';
            }, 300); // Reset text after fade out
        }, 2000);
    });

    function showError(msg) {
        errorText.innerText = msg;
        errorMessage.style.display = 'flex';
        // Re-trigger animation
        errorMessage.style.animation = 'none';
        errorMessage.offsetHeight; /* trigger reflow */
        errorMessage.style.animation = null;
    }

    async function generateToken(cookieText) {
        try {
            // Parse cookies from Netscape or JSON format
            let netflixId = '';
            let secureNetflixId = '';

            const lines = cookieText.split('\n');

            // If the user pasted the JSON format by mistake
            if (cookieText.trim().startsWith('[') && cookieText.trim().endsWith(']')) {
                try {
                    const cookies = JSON.parse(cookieText);
                    const nId = cookies.find(c => c.name === 'NetflixId');
                    const sNid = cookies.find(c => c.name === 'SecureNetflixId');
                    if (nId) netflixId = nId.value;
                    if (sNid) secureNetflixId = sNid.value;
                } catch (e) {
                    console.warn("Mismatched JSON format", e);
                }
            } else {
                // Parse Netscape format
                for (const line of lines) {
                    const parts = line.split('\t');
                    if (parts.length >= 7) {
                        const name = parts[5].trim();
                        const value = parts[6].trim();
                        if (name === 'NetflixId') netflixId = value;
                        if (name === 'SecureNetflixId') secureNetflixId = value;
                    } else if (line.includes('NetflixId=')) {
                        // Extract from raw string like Cookies: NetflixId=...
                        const match = cookieText.match(/NetflixId=([^;\s]+)/);
                        if (match) netflixId = match[1];
                        const match2 = cookieText.match(/SecureNetflixId=([^;\s]+)/);
                        if (match2) secureNetflixId = match2[1];
                    }
                }
            }

            // Fallback checking for raw ct= value pasted directly
            if (!netflixId && (cookieText.includes('v=3') || cookieText.includes('Bgj'))) {
                netflixId = cookieText.trim();
            }

            if (!netflixId) {
                return { error: 'No "NetflixId" cookie found in the input. Please ensure you copied correctly.' };
            }

            // Make API call to our local proxy backend
            generateBtn.innerHTML = '<span>Processing...</span><ion-icon name="sync-outline" class="spin"></ion-icon>';
            generateBtn.disabled = true;

            const response = await fetch('/api/nftoken', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    netflixId: netflixId,
                    secureNetflixId: secureNetflixId
                })
            });

            const data = await response.json();

            // Reset button
            generateBtn.innerHTML = '<span>Generate URL</span><ion-icon name="flash-outline"></ion-icon>';
            generateBtn.disabled = false;

            if (!response.ok || data.error) {
                return { error: data.error || 'Failed to generate token from Netflix. The cookie may be expired.' };
            }

            return {
                url: `https://netflix.com/unsupported?nftoken=${data.nftoken}`
            };
        } catch (err) {
            generateBtn.innerHTML = '<span>Generate URL</span><ion-icon name="flash-outline"></ion-icon>';
            generateBtn.disabled = false;
            return { error: 'An error occurred connecting to the server: ' + err.message };
        }
    }
});
