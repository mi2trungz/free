// Continue Watching UI Module
import { getWatchHistory, removeFromHistory, formatProgress, formatTime } from './watch-history.js';
import { getCurrentUser } from './auth.js';

/**
 * Render continue watching section
 * @param {Array} watchHistory - Array of watch history items
 */
export function renderContinueWatching(watchHistory) {
    const continueWatchingSection = document.getElementById('continueWatchingSection');

    if (!continueWatchingSection) {
        console.error('Continue watching section not found');
        return;
    }

    // Hide section if no history
    if (!watchHistory || watchHistory.length === 0) {
        continueWatchingSection.style.display = 'none';
        return;
    }

    // Filter out completed items (>95% watched)
    const activeHistory = watchHistory.filter(item => item.progressPercent < 95);

    if (activeHistory.length === 0) {
        continueWatchingSection.style.display = 'none';
        return;
    }

    continueWatchingSection.style.display = 'block';

    const container = continueWatchingSection.querySelector('.continue-watching-container');
    if (!container) {
        console.error('Continue watching container not found');
        return;
    }

    container.innerHTML = `
        <div class="section-header">
            <h2 class="section-title">🎬 Đang xem dở</h2>
        </div>
        <div class="continue-watching-grid">
            ${activeHistory.map(item => createContinueWatchingCard(item)).join('')}
        </div>
    `;

    // Add event listeners
    attachContinueWatchingListeners();
}

/**
 * Create a continue watching card
 * @param {object} item - Watch history item
 * @returns {string} HTML string for the card
 */
function createContinueWatchingCard(item) {
    const progressPercent = item.progressPercent || 0;
    const progressText = formatProgress(item.progress, item.duration);
    const timeText = `${formatTime(item.progress)} / ${formatTime(item.duration)}`;

    return `
        <div class="continue-watching-card" data-slug="${item.movieSlug}" data-episode="${item.episodeName}">
            <div class="continue-watching-poster">
                <img src="${item.posterUrl || 'https://via.placeholder.com/300x450?text=No+Image'}" 
                     alt="${item.movieTitle}"
                     onerror="this.src='https://via.placeholder.com/300x450?text=No+Image'">
                <div class="continue-watching-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                    <div class="progress-text">${progressPercent}%</div>
                </div>
                <button class="continue-watching-remove" data-slug="${item.movieSlug}" data-episode="${item.episodeName}" title="Xóa khỏi lịch sử">
                    ✕
                </button>
            </div>
            <div class="continue-watching-info">
                <h3 class="continue-watching-title">${item.movieTitle}</h3>
                <p class="continue-watching-episode">${item.episodeName}</p>
                <p class="continue-watching-time">${timeText}</p>
            </div>
        </div>
    `;
}

/**
 * Attach event listeners to continue watching cards
 */
function attachContinueWatchingListeners() {
    // Click on card to resume watching
    const cards = document.querySelectorAll('.continue-watching-card');
    cards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger if clicking remove button
            if (e.target.closest('.continue-watching-remove')) {
                return;
            }

            const slug = card.dataset.slug;
            if (slug && typeof openMovieDetail === 'function') {
                openMovieDetail(slug);
            }
        });
    });

    // Remove from history
    const removeButtons = document.querySelectorAll('.continue-watching-remove');
    removeButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();

            const slug = btn.dataset.slug;
            const episode = btn.dataset.episode;
            const user = getCurrentUser();

            if (!user) return;

            const result = await removeFromHistory(user.uid, slug, episode);
            if (result.success) {
                // Remove card from UI
                const card = btn.closest('.continue-watching-card');
                if (card) {
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.9)';
                    setTimeout(() => {
                        card.remove();

                        // Check if any cards left
                        const remainingCards = document.querySelectorAll('.continue-watching-card');
                        if (remainingCards.length === 0) {
                            const section = document.getElementById('continueWatchingSection');
                            if (section) {
                                section.style.display = 'none';
                            }
                        }
                    }, 300);
                }

                if (typeof showToast === 'function') {
                    showToast('Đã xóa khỏi lịch sử', 'success');
                }
            }
        });
    });
}

/**
 * Load and display continue watching section
 */
export async function loadContinueWatching() {
    const user = getCurrentUser();

    if (!user) {
        const section = document.getElementById('continueWatchingSection');
        if (section) {
            section.style.display = 'none';
        }
        return;
    }

    const history = await getWatchHistory(user.uid, 10);
    renderContinueWatching(history);
}

/**
 * Refresh continue watching section
 */
export async function refreshContinueWatching() {
    await loadContinueWatching();
}
