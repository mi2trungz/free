// API Configuration
const API_BASE_URL = 'https://phim.nguonc.com/api';

// API Endpoints
const API_ENDPOINTS = {
    latestMovies: (page = 1) => `/films/phim-moi-cap-nhat?page=${page}`,
    moviesByCategory: (slug, page = 1) => `/films/danh-sach/${slug}?page=${page}`,
    movieDetail: (slug) => `/film/${slug}`,
    moviesByGenre: (slug, page = 1) => `/films/the-loai/${slug}?page=${page}`,
    moviesByCountry: (slug, page = 1) => `/films/quoc-gia/${slug}?page=${page}`,
    moviesByYear: (slug, page = 1) => `/films/nam-phat-hanh/${slug}?page=${page}`,
    searchMovies: (keyword, page = 1) => `/films/search?keyword=${keyword}&page=${page}`
};

// Fetch wrapper with error handling
async function fetchAPI(endpoint) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Get latest movies
async function getLatestMovies(page = 1) {
    return await fetchAPI(API_ENDPOINTS.latestMovies(page));
}

// Get movies by category
async function getMoviesByCategory(slug, page = 1) {
    return await fetchAPI(API_ENDPOINTS.moviesByCategory(slug, page));
}

// Get movie details
async function getMovieDetail(slug) {
    return await fetchAPI(API_ENDPOINTS.movieDetail(slug));
}

// Get movies by genre
async function getMoviesByGenre(slug, page = 1) {
    return await fetchAPI(API_ENDPOINTS.moviesByGenre(slug, page));
}

// Get movies by country
async function getMoviesByCountry(slug, page = 1) {
    return await fetchAPI(API_ENDPOINTS.moviesByCountry(slug, page));
}

// Get movies by year
async function getMoviesByYear(year, page = 1) {
    return await fetchAPI(API_ENDPOINTS.moviesByYear(year, page));
}

// Search movies
async function searchMovies(keyword, page = 1) {
    return await fetchAPI(API_ENDPOINTS.searchMovies(keyword, page));
}
