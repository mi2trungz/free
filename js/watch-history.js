// Watch History Service
import { db } from './firebase-config.js';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    where,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Save or update watch progress for a user
 * @param {string} userId - User ID
 * @param {object} movieData - Movie information {slug, title, posterUrl}
 * @param {object} episodeData - Episode information {name, serverName}
 * @param {number} progress - Current playback position in seconds
 * @param {number} duration - Total video duration in seconds
 */
export async function saveWatchProgress(userId, movieData, episodeData, progress, duration) {
    console.log('🎬 saveWatchProgress called:', { userId, movieData, episodeData, progress, duration });

    if (!userId || !movieData || !episodeData) {
        console.error('❌ Missing required data for saving watch progress');
        return { success: false, error: 'Missing required data' };
    }

    try {
        // Create unique document ID: userId_movieSlug_episodeName
        const docId = `${userId}_${movieData.slug}_${episodeData.name}`;
        const watchHistoryRef = doc(db, 'watchHistory', docId);

        const watchData = {
            userId,
            movieSlug: movieData.slug,
            movieTitle: movieData.title,
            posterUrl: movieData.posterUrl || '',
            episodeName: episodeData.name,
            serverName: episodeData.serverName || '',
            progress: Math.floor(progress),
            duration: Math.floor(duration),
            progressPercent: duration > 0 ? Math.floor((progress / duration) * 100) : 0,
            timestamp: Date.now(),
            lastUpdated: new Date().toISOString()
        };

        await setDoc(watchHistoryRef, watchData, { merge: true });
        console.log('✅ Watch progress saved successfully:', watchData);

        return { success: true, data: watchData };
    } catch (error) {
        console.error('❌ Error saving watch progress:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get watch history for a user
 * @param {string} userId - User ID
 * @param {number} limitCount - Maximum number of items to retrieve
 * @returns {Promise<Array>} Array of watch history items
 */
export async function getWatchHistory(userId, limitCount = 10) {
    if (!userId) {
        return [];
    }

    try {
        const watchHistoryRef = collection(db, 'watchHistory');
        // Simplified query without orderBy to avoid index requirement
        const q = query(
            watchHistoryRef,
            where('userId', '==', userId)
        );

        const querySnapshot = await getDocs(q);
        const history = [];

        querySnapshot.forEach((doc) => {
            history.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort by timestamp descending and limit client-side
        return history
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, limitCount);
    } catch (error) {
        console.error('Error getting watch history:', error);
        return [];
    }
}

/**
 * Get progress for a specific movie episode
 * @param {string} userId - User ID
 * @param {string} movieSlug - Movie slug
 * @param {string} episodeName - Episode name
 * @returns {Promise<object|null>} Watch progress data or null
 */
export async function getMovieProgress(userId, movieSlug, episodeName) {
    if (!userId || !movieSlug || !episodeName) {
        return null;
    }

    try {
        const docId = `${userId}_${movieSlug}_${episodeName}`;
        const watchHistoryRef = doc(db, 'watchHistory', docId);
        const docSnap = await getDoc(watchHistoryRef);

        if (docSnap.exists()) {
            return {
                id: docSnap.id,
                ...docSnap.data()
            };
        }

        return null;
    } catch (error) {
        console.error('Error getting movie progress:', error);
        return null;
    }
}

/**
 * Remove an item from watch history
 * @param {string} userId - User ID
 * @param {string} movieSlug - Movie slug
 * @param {string} episodeName - Episode name
 */
export async function removeFromHistory(userId, movieSlug, episodeName) {
    if (!userId || !movieSlug || !episodeName) {
        return { success: false, error: 'Missing required data' };
    }

    try {
        const docId = `${userId}_${movieSlug}_${episodeName}`;
        const watchHistoryRef = doc(db, 'watchHistory', docId);
        await deleteDoc(watchHistoryRef);

        return { success: true };
    } catch (error) {
        console.error('Error removing from history:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Clear all watch history for a user
 * @param {string} userId - User ID
 */
export async function clearAllHistory(userId) {
    if (!userId) {
        return { success: false, error: 'User ID required' };
    }

    try {
        const watchHistoryRef = collection(db, 'watchHistory');
        const q = query(watchHistoryRef, where('userId', '==', userId));
        const querySnapshot = await getDocs(q);

        const deletePromises = [];
        querySnapshot.forEach((doc) => {
            deletePromises.push(deleteDoc(doc.ref));
        });

        await Promise.all(deletePromises);

        return { success: true, count: deletePromises.length };
    } catch (error) {
        console.error('Error clearing history:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Format time in seconds to MM:SS or HH:MM:SS
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format progress as percentage or time remaining
 * @param {number} progress - Current progress in seconds
 * @param {number} duration - Total duration in seconds
 * @returns {string} Formatted progress string
 */
export function formatProgress(progress, duration) {
    if (!duration || duration <= 0) return '0%';

    const percent = Math.floor((progress / duration) * 100);
    const remaining = duration - progress;

    if (percent >= 95) {
        return 'Đã xem xong';
    } else if (percent < 5) {
        return 'Mới bắt đầu';
    } else {
        return `${percent}% • Còn ${formatTime(remaining)}`;
    }
}
