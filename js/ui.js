// UI Rendering Functions

// Create movie card HTML
function createMovieCard(movie) {
    const posterUrl = movie.thumb_url || movie.poster_url || 'https://via.placeholder.com/300x450?text=No+Image';
    const title = movie.name || 'Không có tiêu đề';
    const year = movie.year || 'N/A';
    const quality = movie.quality || movie.lang || 'HD';
    const episodeCurrent = movie.episode_current || movie.current_episode || '';

    return `
        <div class="movie-card" data-slug="${movie.slug}">
            <div class="movie-poster">
                <img src="${posterUrl}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450?text=No+Image'">
                <span class="movie-badge">${quality}</span>
            </div>
            <div class="movie-info">
                <h3 class="movie-title">${title}</h3>
                <div class="movie-meta">
                    <span class="movie-year">${year}</span>
                    ${episodeCurrent ? `<span class="movie-status">${episodeCurrent}</span>` : ''}
                </div>
            </div>
        </div>
    `;
}

// Render movies grid
function renderMoviesGrid(movies) {
    const grid = document.getElementById('moviesGrid');

    if (!movies || movies.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-secondary);">
                <p style="font-size: 1.25rem;">Không tìm thấy phim nào</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = movies.map(movie => createMovieCard(movie)).join('');

    // Add click event to all movie cards
    const cards = grid.querySelectorAll('.movie-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const slug = card.dataset.slug;
            openMovieDetail(slug);
        });
    });
}

// Show loading state
function showLoading() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('moviesGrid');
    loading.classList.add('active');
    grid.style.display = 'none';
}

// Hide loading state
function hideLoading() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('moviesGrid');
    loading.classList.remove('active');
    grid.style.display = 'grid';
}

// Update pagination
function updatePagination(currentPage, totalPages) {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    pageInfo.textContent = `Trang ${currentPage}${totalPages ? ` / ${totalPages}` : ''}`;

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = totalPages && currentPage >= totalPages;
}

// Show toast notification
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: ${type === 'error' ? '#ef4444' : '#8b5cf6'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 9999;
        animation: slideInRight 0.3s ease;
    `;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add animation styles
if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// Update section title
function updateSectionTitle(title) {
    const sectionTitle = document.getElementById('sectionTitle');
    sectionTitle.textContent = title;
}

// Scroll to movies section smoothly
function scrollToTop() {
    const sectionTitle = document.getElementById('sectionTitle');
    if (sectionTitle) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = sectionTitle.offsetTop - headerHeight - 20;

        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    } else {
        // Fallback to top if section title not found
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
}
