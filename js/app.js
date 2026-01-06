// Main Application Logic

// App State
const appState = {
    currentPage: 1,
    totalPages: null,
    currentCategory: null,
    currentGenre: null,
    currentCountry: null,
    currentYear: null,
    searchKeyword: null,
    isLoading: false
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Initialize hero slider
    initHeroSlider();

    // Load initial movies
    loadLatestMovies();

    // Setup event listeners
    setupEventListeners();

    // Setup back to top button
    setupBackToTop();
}

// Setup event listeners
function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const keyword = e.target.value.trim();
            if (keyword.length >= 2) {
                performSearch(keyword);
            } else if (keyword.length === 0) {
                loadLatestMovies();
            }
        }, 500);
    });

    searchBtn.addEventListener('click', () => {
        const keyword = searchInput.value.trim();
        if (keyword) {
            performSearch(keyword);
        }
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const keyword = searchInput.value.trim();
            if (keyword) {
                performSearch(keyword);
            }
        }
    });

    // Navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            const page = link.dataset.page;
            const category = link.dataset.category;

            if (page === 'home') {
                resetFilters();
                loadLatestMovies();
            } else if (category) {
                resetFilters();
                loadMoviesByCategory(category);
            }
        });
    });

    // Logo click - navigate to home
    const logoLink = document.getElementById('logoLink');
    if (logoLink) {
        logoLink.addEventListener('click', (e) => {
            e.preventDefault();

            // Remove active state from all nav links
            navLinks.forEach(l => l.classList.remove('active'));

            // Reset and load home
            resetFilters();
            loadLatestMovies();
        });
    }

    // Filters
    const genreFilter = document.getElementById('genreFilter');
    const countryFilter = document.getElementById('countryFilter');
    const yearFilter = document.getElementById('yearFilter');

    genreFilter.addEventListener('change', (e) => {
        const genre = e.target.value;
        if (genre) {
            resetOtherFilters('genre');
            loadMoviesByGenre(genre);
        } else {
            loadLatestMovies();
        }
    });

    countryFilter.addEventListener('change', (e) => {
        const country = e.target.value;
        if (country) {
            resetOtherFilters('country');
            loadMoviesByCountry(country);
        } else {
            loadLatestMovies();
        }
    });

    yearFilter.addEventListener('change', (e) => {
        const year = e.target.value;
        if (year) {
            resetOtherFilters('year');
            loadMoviesByYear(year);
        } else {
            loadLatestMovies();
        }
    });

    // Pagination
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    prevBtn.addEventListener('click', () => {
        if (appState.currentPage > 1) {
            appState.currentPage--;
            loadCurrentView();
            scrollToTop();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (!appState.totalPages || appState.currentPage < appState.totalPages) {
            appState.currentPage++;
            loadCurrentView();
            scrollToTop();
        }
    });

    // Modal close
    const modalOverlay = document.getElementById('modalOverlay');
    const modalClose = document.getElementById('modalClose');

    modalOverlay.addEventListener('click', closeModal);
    modalClose.addEventListener('click', closeModal);

    // Mobile search toggle
    const mobileSearchToggle = document.getElementById('mobileSearchToggle');
    const searchBox = document.getElementById('searchBox');

    if (mobileSearchToggle) {
        mobileSearchToggle.addEventListener('click', () => {
            searchBox.classList.toggle('active');
        });

        // Close search box when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchBox.contains(e.target) && !mobileSearchToggle.contains(e.target)) {
                searchBox.classList.remove('active');
            }
        });
    }
}

// Load latest movies
async function loadLatestMovies() {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        showLoading();

        const data = await getLatestMovies(appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);
            updateSectionTitle('Phim mới cập nhật');

            // Update pagination info
            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading movies:', error);
        showToast('Không thể tải danh sách phim', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Load movies by category
async function loadMoviesByCategory(slug) {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        appState.currentCategory = slug;
        showLoading();

        const data = await getMoviesByCategory(slug, appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);

            const categoryNames = {
                'phim-bo': 'Phim bộ',
                'phim-le': 'Phim lẻ'
            };
            updateSectionTitle(categoryNames[slug] || slug);

            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading category:', error);
        showToast('Không thể tải danh mục phim', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Load movies by genre
async function loadMoviesByGenre(slug) {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        appState.currentGenre = slug;
        showLoading();

        const data = await getMoviesByGenre(slug, appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);
            updateSectionTitle(`Thể loại: ${slug}`);

            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading genre:', error);
        showToast('Không thể tải thể loại phim', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Load movies by country
async function loadMoviesByCountry(slug) {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        appState.currentCountry = slug;
        showLoading();

        const data = await getMoviesByCountry(slug, appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);
            updateSectionTitle(`Quốc gia: ${slug}`);

            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading country:', error);
        showToast('Không thể tải phim theo quốc gia', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Load movies by year
async function loadMoviesByYear(year) {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        appState.currentYear = year;
        showLoading();

        const data = await getMoviesByYear(year, appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);
            updateSectionTitle(`Năm phát hành: ${year}`);

            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading year:', error);
        showToast('Không thể tải phim theo năm', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Perform search
async function performSearch(keyword) {
    if (appState.isLoading) return;

    try {
        appState.isLoading = true;
        appState.searchKeyword = keyword;
        showLoading();

        const data = await searchMovies(keyword, appState.currentPage);

        if (data && data.items) {
            renderMoviesGrid(data.items);
            updateSectionTitle(`Kết quả tìm kiếm: "${keyword}"`);

            const pagination = data.paginate || data.pagination;
            if (pagination) {
                appState.totalPages = pagination.total_page || pagination.totalPages;
                updatePagination(appState.currentPage, appState.totalPages);
            }
        } else {
            renderMoviesGrid([]);
        }

        hideLoading();
    } catch (error) {
        console.error('Error searching:', error);
        showToast('Không thể tìm kiếm phim', 'error');
        hideLoading();
    } finally {
        appState.isLoading = false;
    }
}

// Load current view (for pagination)
function loadCurrentView() {
    if (appState.searchKeyword) {
        performSearch(appState.searchKeyword);
    } else if (appState.currentCategory) {
        loadMoviesByCategory(appState.currentCategory);
    } else if (appState.currentGenre) {
        loadMoviesByGenre(appState.currentGenre);
    } else if (appState.currentCountry) {
        loadMoviesByCountry(appState.currentCountry);
    } else if (appState.currentYear) {
        loadMoviesByYear(appState.currentYear);
    } else {
        loadLatestMovies();
    }
}

// Reset filters
function resetFilters() {
    appState.currentPage = 1;
    appState.totalPages = null;
    appState.currentCategory = null;
    appState.currentGenre = null;
    appState.currentCountry = null;
    appState.currentYear = null;
    appState.searchKeyword = null;

    document.getElementById('genreFilter').value = '';
    document.getElementById('countryFilter').value = '';
    document.getElementById('yearFilter').value = '';
    document.getElementById('searchInput').value = '';
}

// Reset other filters
function resetOtherFilters(keepFilter) {
    appState.currentPage = 1;
    appState.totalPages = null;
    appState.currentCategory = null;
    appState.searchKeyword = null;

    if (keepFilter !== 'genre') {
        appState.currentGenre = null;
        document.getElementById('genreFilter').value = '';
    }
    if (keepFilter !== 'country') {
        appState.currentCountry = null;
        document.getElementById('countryFilter').value = '';
    }
    if (keepFilter !== 'year') {
        appState.currentYear = null;
        document.getElementById('yearFilter').value = '';
    }

    document.getElementById('searchInput').value = '';
}

// Setup back to top button
function setupBackToTop() {
    const backToTopBtn = document.getElementById('backToTop');

    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    });

    backToTopBtn.addEventListener('click', scrollToTop);
}
