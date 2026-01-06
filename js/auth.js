// Authentication Functions
import { auth } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Current user state
let currentUser = null;

// Register new user
export async function registerUser(email, password, displayName = '') {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Update display name if provided
        if (displayName) {
            await updateProfile(userCredential.user, {
                displayName: displayName
            });
        }

        return {
            success: true,
            user: userCredential.user
        };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error.code)
        };
    }
}

// Login existing user
export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return {
            success: true,
            user: userCredential.user
        };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error.code)
        };
    }
}

// Logout current user
export async function logoutUser() {
    try {
        await signOut(auth);
        return {
            success: true
        };
    } catch (error) {
        return {
            success: false,
            error: 'Không thể đăng xuất. Vui lòng thử lại.'
        };
    }
}

// Monitor auth state changes
export function initAuthStateObserver(callback) {
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (callback) {
            callback(user);
        }
    });
}

// Get current user
export function getCurrentUser() {
    return currentUser;
}

// Convert Firebase error codes to Vietnamese messages
function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'Email này đã được sử dụng',
        'auth/invalid-email': 'Email không hợp lệ',
        'auth/operation-not-allowed': 'Chức năng này chưa được kích hoạt',
        'auth/weak-password': 'Mật khẩu quá yếu (tối thiểu 6 ký tự)',
        'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa',
        'auth/user-not-found': 'Không tìm thấy tài khoản',
        'auth/wrong-password': 'Sai mật khẩu',
        'auth/invalid-credential': 'Thông tin đăng nhập không hợp lệ',
        'auth/network-request-failed': 'Lỗi kết nối mạng',
        'auth/too-many-requests': 'Quá nhiều yêu cầu. Vui lòng thử lại sau',
        'auth/requires-recent-login': 'Vui lòng đăng nhập lại để thực hiện thao tác này'
    };

    return errorMessages[errorCode] || 'Đã xảy ra lỗi. Vui lòng thử lại.';
}
