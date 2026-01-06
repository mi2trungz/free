// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC125h8reLICnchwjO1DD86eA6lAQZWx_g",
    authDomain: "phim-5f080.firebaseapp.com",
    projectId: "phim-5f080",
    storageBucket: "phim-5f080.firebasestorage.app",
    messagingSenderId: "673632774138",
    appId: "1:673632774138:web:9981e73b3936b590266643"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
