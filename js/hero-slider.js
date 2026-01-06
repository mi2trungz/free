// Hero Slider Functionality

let heroSliderState = {
    currentSlide: 0,
    slides: [],
    autoPlayInterval: null,
    autoPlayDelay: 5000 // 5 seconds
};

// Initialize hero slider
async function initHeroSlider() {
    try {
        // Fetch latest movies for slider
        const data = await getLatestMovies(1);

        if (data && data.items && data.items.length > 0) {
            // Take first 5 movies for slider
            heroSliderState.slides = data.items.slice(0, 5);
            renderHeroSlides();
            setupHeroSliderControls();
            startAutoPlay();
        }
    } catch (error) {
        console.error('Error loading hero slider:', error);
    }
}

// Render hero slides
function renderHeroSlides() {
    const container = document.querySelector('.hero-slider-container');
    const dotsContainer = document.getElementById('heroSliderDots');

    if (!container || !dotsContainer) return;

    // Clear existing content
    container.innerHTML = '';
    dotsContainer.innerHTML = '';

    // Create slides
    heroSliderState.slides.forEach((movie, index) => {
        // Create slide
        const slide = document.createElement('div');
        slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;
        slide.dataset.slug = movie.slug;

        const posterUrl = movie.poster_url || movie.thumb_url || 'https://via.placeholder.com/1920x500?text=No+Image';

        slide.innerHTML = `
            <div class="hero-slide-bg" style="background-image: url('${posterUrl}')"></div>
            <div class="hero-slide-content">
                <div class="hero-slide-info">
                    <h2 class="hero-slide-title">${movie.name || 'Không có tên'}</h2>
                    <div class="hero-slide-meta">
                        <span class="hero-slide-rank">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                            </svg>
                            Top ${index + 1}
                        </span>
                        ${movie.year ? `<span class="hero-slide-year">${movie.year}</span>` : ''}
                        ${movie.quality ? `<span class="hero-slide-quality">${movie.quality}</span>` : ''}
                    </div>
                    <p class="hero-slide-description">${movie.content || movie.description || 'Khám phá bộ phim hấp dẫn này ngay!'}</p>
                    <div class="hero-slide-buttons">
                        <button class="hero-btn hero-btn-play" onclick="event.stopPropagation(); openMovieDetail('${movie.slug}')">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            Phát
                        </button>
                        <button class="hero-btn hero-btn-info" onclick="event.stopPropagation(); openMovieDetail('${movie.slug}')">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                            Thông tin khác
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add click handler
        slide.addEventListener('click', () => {
            openMovieDetail(movie.slug);
        });

        container.appendChild(slide);

        // Create dot
        const dot = document.createElement('button');
        dot.className = `hero-slider-dot ${index === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToSlide(index));
        dotsContainer.appendChild(dot);
    });
}

// Setup slider controls
function setupHeroSliderControls() {
    const prevBtn = document.getElementById('heroSliderPrev');
    const nextBtn = document.getElementById('heroSliderNext');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            stopAutoPlay();
            previousSlide();
            startAutoPlay();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            stopAutoPlay();
            nextSlide();
            startAutoPlay();
        });
    }
}

// Go to specific slide
function goToSlide(index) {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-slider-dot');

    if (!slides.length) return;

    // Remove active class from all
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));

    // Add active class to current
    slides[index].classList.add('active');
    dots[index].classList.add('active');

    heroSliderState.currentSlide = index;
}

// Next slide
function nextSlide() {
    const nextIndex = (heroSliderState.currentSlide + 1) % heroSliderState.slides.length;
    goToSlide(nextIndex);
}

// Previous slide
function previousSlide() {
    const prevIndex = (heroSliderState.currentSlide - 1 + heroSliderState.slides.length) % heroSliderState.slides.length;
    goToSlide(prevIndex);
}

// Start auto play
function startAutoPlay() {
    stopAutoPlay(); // Clear any existing interval
    heroSliderState.autoPlayInterval = setInterval(() => {
        nextSlide();
    }, heroSliderState.autoPlayDelay);
}

// Stop auto play
function stopAutoPlay() {
    if (heroSliderState.autoPlayInterval) {
        clearInterval(heroSliderState.autoPlayInterval);
        heroSliderState.autoPlayInterval = null;
    }
}

// Pause auto play on hover
document.addEventListener('DOMContentLoaded', () => {
    const heroSlider = document.getElementById('heroSlider');

    if (heroSlider) {
        heroSlider.addEventListener('mouseenter', stopAutoPlay);
        heroSlider.addEventListener('mouseleave', startAutoPlay);
    }
});
