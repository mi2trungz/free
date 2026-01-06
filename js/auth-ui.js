// Authentication UI Handler
import { registerUser, loginUser, logoutUser, initAuthStateObserver } from './auth.js';
import { loadContinueWatching } from './continue-watching-ui.js';

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const userProfile = document.getElementById('userProfile');
const userBtn = document.getElementById('userBtn');
const userEmail = document.getElementById('userEmail');
const userDropdown = document.getElementById('userDropdown');
const logoutBtn = document.getElementById('logoutBtn');

const loginModal = document.getElementById('loginModal');
const registerModal = document.getElementById('registerModal');
const loginClose = document.getElementById('loginClose');
const registerClose = document.getElementById('registerClose');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');

// Initialize auth state observer
initAuthStateObserver((user) => {
    updateUIForUser(user);
    // Load continue watching when auth state changes
    loadContinueWatching();
});

// Update UI based on user state
function updateUIForUser(user) {
    if (user) {
        // User is logged in
        loginBtn.style.display = 'none';
        userProfile.style.display = 'block';

        // Display user email or display name
        const displayText = user.displayName || user.email.split('@')[0];
        userEmail.textContent = displayText;
    } else {
        // User is logged out
        loginBtn.style.display = 'block';
        userProfile.style.display = 'none';
    }
}

// Modal controls
loginBtn.addEventListener('click', () => {
    openModal(loginModal);
});

loginClose.addEventListener('click', () => {
    closeModal(loginModal);
});

registerClose.addEventListener('click', () => {
    closeModal(registerModal);
});

showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal(loginModal);
    openModal(registerModal);
});

showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal(registerModal);
    openModal(loginModal);
});

// Close modals when clicking outside
loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) {
        closeModal(loginModal);
    }
});

registerModal.addEventListener('click', (e) => {
    if (e.target === registerModal) {
        closeModal(registerModal);
    }
});

// User dropdown toggle
userBtn.addEventListener('click', () => {
    userProfile.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!userProfile.contains(e.target)) {
        userProfile.classList.remove('active');
    }
});

// Login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    // Disable submit button
    const submitBtn = loginForm.querySelector('.auth-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang đăng nhập...';

    // Clear previous errors
    hideError(loginError);

    // Attempt login
    const result = await loginUser(email, password);

    if (result.success) {
        // Success
        closeModal(loginModal);
        loginForm.reset();
        showToast('Đăng nhập thành công!', 'success');
    } else {
        // Error
        showError(loginError, result.error);
    }

    // Re-enable submit button
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đăng nhập';
});

// Register form submission
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;

    // Clear previous errors
    hideError(registerError);

    // Validate passwords match
    if (password !== confirmPassword) {
        showError(registerError, 'Mật khẩu xác nhận không khớp');
        return;
    }

    // Validate password length
    if (password.length < 6) {
        showError(registerError, 'Mật khẩu phải có ít nhất 6 ký tự');
        return;
    }

    // Disable submit button
    const submitBtn = registerForm.querySelector('.auth-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang đăng ký...';

    // Attempt registration
    const result = await registerUser(email, password, name);

    if (result.success) {
        // Success
        closeModal(registerModal);
        registerForm.reset();
        showToast('Đăng ký thành công!', 'success');
    } else {
        // Error
        showError(registerError, result.error);
    }

    // Re-enable submit button
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đăng ký';
});

// Logout
logoutBtn.addEventListener('click', async () => {
    const result = await logoutUser();

    if (result.success) {
        userProfile.classList.remove('active');
        showToast('Đã đăng xuất', 'success');
    } else {
        showToast('Không thể đăng xuất', 'error');
    }
});

// Helper functions
function openModal(modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function showError(errorElement, message) {
    errorElement.textContent = message;
    errorElement.classList.add('show');
}

function hideError(errorElement) {
    errorElement.textContent = '';
    errorElement.classList.remove('show');
}
