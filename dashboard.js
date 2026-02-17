// Dashboard JavaScript
let currentUser = null;
let alertSource = null;
let alertReconnectTimer = null;
let alertPollingTimer = null;
let alertReconnectAttempts = 0;
let beforeUnloadBound = false;
let attemptedLocationCapture = false;
let notificationItems = [];
let myFeedback = null;
const seenEmergencyAlerts = new Set();

const NOTIFICATION_STORAGE_KEY = 'appNotifications';
const NOTIFICATION_LIMIT = 40;
const ALERT_RADIUS_KM = 5;
const ALERT_POLL_INTERVAL_MS = 30000;
const ALERT_RECONNECT_BASE_MS = 2000;
const ALERT_RECONNECT_MAX_MS = 30000;
const MAX_TRACKED_EMERGENCY_ALERTS = 150;

const toDisplayValue = (value, fallback = '-') => {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    return String(value);
};

const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderUserProfile = (user) => {
    const location = user?.location ||
        [user?.city, user?.state].filter(value => typeof value === 'string' && value.trim()).join(', ');

    document.getElementById('userName').textContent = toDisplayValue(user?.name, 'User');
    document.getElementById('userEmail').textContent = toDisplayValue(user?.email, 'No email');
    document.getElementById('userBloodGroup').textContent = toDisplayValue(user?.blood_group, '-');
    document.getElementById('userLocation').textContent = toDisplayValue(location, 'Not specified');
    document.getElementById('userPhone').textContent = toDisplayValue(user?.phone, 'Not specified');
};

const loadNotificationState = () => {
    try {
        const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
        if (!raw) {
            notificationItems = [];
            return;
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            notificationItems = [];
            return;
        }

        notificationItems = parsed.slice(0, NOTIFICATION_LIMIT);
    } catch (error) {
        notificationItems = [];
    }
};

const saveNotificationState = () => {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notificationItems.slice(0, NOTIFICATION_LIMIT)));
};

const renderNotificationCenter = () => {
    const container = document.getElementById('notificationFeed');
    const countNode = document.getElementById('notificationCount');
    if (countNode) {
        countNode.textContent = String(notificationItems.length);
    }
    if (!container) {
        return;
    }

    if (notificationItems.length === 0) {
        container.innerHTML = '<div class="loading">No notifications yet.</div>';
        return;
    }

    container.innerHTML = notificationItems
        .map(item => `
            <div class="notification-item ${item.type || 'info'}">
                <div class="notification-meta">
                    <strong>${(item.type || 'info').toUpperCase()}</strong>
                    <span>${new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p>${item.message}</p>
            </div>
        `)
        .join('');
};

const pushNotification = (message, type = 'info') => {
    if (!message) {
        return;
    }

    notificationItems.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: String(message),
        type,
        created_at: new Date().toISOString()
    });
    notificationItems = notificationItems.slice(0, NOTIFICATION_LIMIT);
    saveNotificationState();
    renderNotificationCenter();
};

document.addEventListener('DOMContentLoaded', function() {
    loadNotificationState();
    renderNotificationCenter();
    initializeDashboard();
    setupEventListeners();
});

async function initializeDashboard() {
    try {
        const userData = localStorage.getItem('currentUser');
        if (!userData) {
            window.location.href = '/login';
            return;
        }

        try {
            currentUser = JSON.parse(userData);
        } catch (error) {
            localStorage.removeItem('currentUser');
            window.location.href = '/login';
            return;
        }

        if (!currentUser || !currentUser.id) {
            localStorage.removeItem('currentUser');
            window.location.href = '/login';
            return;
        }

        // Render cached data immediately so UI never remains on "Loading..."
        renderUserProfile(currentUser);

        const profileLoaded = await loadUserProfile();
        if (!profileLoaded) {
            renderUserProfile(currentUser);
        }

        await syncCurrentLocation({ silent: true, force: true });

        await Promise.all([
            loadStatistics(),
            loadRecentRequests(),
            loadRecentDonations(),
            loadNearbyDonors(),
            loadSuperheroes(),
            loadFeedbackSummary(),
            loadRecentFeedback(),
            loadMyFeedback()
        ]);

        await Promise.all([
            primeDonorLocationSearch(),
            primeReceiverLocationSearch()
        ]);

        startEmergencyAlerts();
    } catch (error) {
        console.error('Dashboard initialization error:', error);
        showMessage('Failed to load dashboard data', 'error');
    }
}

function setupEventListeners() {
    const requestBtn = document.getElementById('requestBloodBtn');
    const donationBtn = document.getElementById('scheduleDonationBtn');
    const inventoryBtn = document.getElementById('viewInventoryBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const refreshNearbyBtn = document.getElementById('refreshNearbyDonorsBtn');
    const requestForm = document.getElementById('bloodRequestForm');
    const donationForm = document.getElementById('donationForm');
    const donorLocationSearchForm = document.getElementById('donorLocationSearchForm');
    const receiverLocationSearchForm = document.getElementById('receiverLocationSearchForm');
    const feedbackForm = document.getElementById('feedbackForm');
    const clearNotificationsBtn = document.getElementById('clearNotificationsBtn');
    const refreshSuperheroesBtn = document.getElementById('refreshSuperheroesBtn');
    const refreshFeedbackBtn = document.getElementById('refreshFeedbackBtn');
    const refreshMyLocationBtn = document.getElementById('refreshMyLocationBtn');

    if (requestBtn) {
        requestBtn.addEventListener('click', () => openModal('requestModal'));
    }
    if (donationBtn) {
        donationBtn.addEventListener('click', () => openModal('donationModal'));
    }
    if (inventoryBtn) {
        inventoryBtn.addEventListener('click', viewInventory);
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    if (refreshNearbyBtn) {
        refreshNearbyBtn.addEventListener('click', loadNearbyDonors);
    }
    if (refreshSuperheroesBtn) {
        refreshSuperheroesBtn.addEventListener('click', loadSuperheroes);
    }
    if (refreshFeedbackBtn) {
        refreshFeedbackBtn.addEventListener('click', async () => {
            await Promise.all([loadFeedbackSummary(), loadRecentFeedback(), loadMyFeedback()]);
        });
    }
    if (refreshMyLocationBtn) {
        refreshMyLocationBtn.addEventListener('click', async () => {
            const updated = await syncCurrentLocation({ silent: false, force: true });
            if (updated) {
                showMessage('Location updated successfully', 'success');
                await Promise.all([loadNearbyDonors(), primeDonorLocationSearch(), primeReceiverLocationSearch()]);
            }
        });
    }

    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                closeModal(modal.id);
            }
        });
    });

    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            closeModal(event.target.id);
        }
    });

    if (requestForm) {
        requestForm.addEventListener('submit', handleBloodRequest);
    }
    if (donationForm) {
        donationForm.addEventListener('submit', handleDonation);
    }
    if (donorLocationSearchForm) {
        donorLocationSearchForm.addEventListener('submit', handleDonorLocationSearch);
    }
    if (receiverLocationSearchForm) {
        receiverLocationSearchForm.addEventListener('submit', handleReceiverLocationSearch);
    }
    if (feedbackForm) {
        feedbackForm.addEventListener('submit', handleFeedbackSubmit);
    }
    if (clearNotificationsBtn) {
        clearNotificationsBtn.addEventListener('click', () => {
            notificationItems = [];
            saveNotificationState();
            renderNotificationCenter();
        });
    }
}

async function loadUserProfile() {
    try {
        if (!currentUser || !currentUser.id) {
            return false;
        }

        const response = await fetch(`/api/auth/profile/${currentUser.id}`);
        let result = null;
        try {
            result = await response.json();
        } catch (error) {
            result = { success: false, message: 'Unexpected response from profile API' };
        }

        if (response.status === 400 || response.status === 401 || response.status === 404) {
            showMessage('Session expired. Please login again.', 'warning');
            setTimeout(() => logout(), 1200);
            return false;
        }

        if (!response.ok || !result.success) {
            return false;
        }

        currentUser = { ...currentUser, ...result.user };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        renderUserProfile(currentUser);

        return true;
    } catch (error) {
        console.error('Load profile error:', error);
        return false;
    }
}

async function syncCurrentLocation({ silent = true, force = false } = {}) {
    if (!currentUser) {
        return false;
    }

    const hasCoordinates = currentUser.latitude !== null && currentUser.latitude !== undefined &&
        currentUser.longitude !== null && currentUser.longitude !== undefined;
    if (hasCoordinates && !force) {
        return true;
    }

    if (!navigator.geolocation) {
        if (!silent) {
            showMessage('Geolocation is not supported by this browser.', 'warning');
        }
        return false;
    }

    if (attemptedLocationCapture && !force) {
        return false;
    }
    attemptedLocationCapture = true;

    const getBrowserLocation = () => new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 6000,
            maximumAge: 0
        });
    });

    try {
        const position = await getBrowserLocation();
        const latitude = Number.parseFloat(position.coords.latitude.toFixed(7));
        const longitude = Number.parseFloat(position.coords.longitude.toFixed(7));

        // Keep coordinates locally even if profile update fails, so matching can still run.
        currentUser.latitude = latitude;
        currentUser.longitude = longitude;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        const updateResponse = await fetch(`/api/auth/profile/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ latitude, longitude })
        });

        if (!updateResponse.ok && !silent) {
            showMessage('Location saved locally, but server profile update failed.', 'warning');
        }

        return true;
    } catch (error) {
        if (!silent) {
            showMessage('Location permission is required for nearby donor matching.', 'warning');
        }
        return false;
    }
}

async function loadStatistics() {
    try {
        const donationResponse = await fetch('/api/donations/statistics');
        const donationStats = await donationResponse.json();

        const requestsResponse = await fetch('/api/blood-requests/all');
        const requestsData = await requestsResponse.json();

        const urgentResponse = await fetch('/api/blood-requests/urgent/all');
        const urgentData = await urgentResponse.json();

        const donorsResponse = await fetch('/api/auth/users');
        const donorsData = await donorsResponse.json();

        document.getElementById('totalDonations').textContent = donationStats.success ? donationStats.statistics.totalDonations : 0;
        document.getElementById('totalRequests').textContent = requestsData.success ? requestsData.requests.length : 0;
        document.getElementById('availableDonors').textContent = donorsData.success ? donorsData.users.filter(u => u.is_donor).length : 0;
        document.getElementById('urgentRequests').textContent = urgentData.success ? urgentData.requests.length : 0;
    } catch (error) {
        console.error('Load statistics error:', error);
        document.getElementById('totalDonations').textContent = '0';
        document.getElementById('totalRequests').textContent = '0';
        document.getElementById('availableDonors').textContent = '0';
        document.getElementById('urgentRequests').textContent = '0';
    }
}

async function loadRecentRequests() {
    try {
        const response = await fetch('/api/blood-requests/all');
        const result = await response.json();
        const container = document.getElementById('recentRequests');

        if (result.success && result.requests && result.requests.length > 0) {
            const recentRequests = result.requests.slice(0, 5);
            container.innerHTML = recentRequests.map(request => `
                <div class="request-item">
                    <h4>${request.patient_name}</h4>
                    <p><strong>Blood Group:</strong> ${request.blood_group}</p>
                    <p><strong>Units Required:</strong> ${request.units_required}</p>
                    <p><strong>Hospital:</strong> ${request.hospital_name || 'Not specified'}</p>
                    <p><strong>Urgency:</strong> ${request.urgency_level}</p>
                    <span class="status ${request.status.toLowerCase()}">${request.status}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="loading">No blood requests found</div>';
        }
    } catch (error) {
        console.error('Load requests error:', error);
        document.getElementById('recentRequests').innerHTML = '<div class="loading">No blood requests found</div>';
    }
}

async function loadRecentDonations() {
    const container = document.getElementById('recentDonations');
    if (!container) {
        return;
    }

    if (!currentUser || !currentUser.id) {
        container.innerHTML = '<div class="loading">Please login again to view your donations.</div>';
        return;
    }

    try {
        const response = await fetch(`/api/donations/donor/${currentUser.id}`);
        const result = await response.json();

        if (result.success && result.donations && result.donations.length > 0) {
            const recentDonations = result.donations.slice(0, 5);
            container.innerHTML = recentDonations.map(donation => `
                <div class="donation-item">
                    <h4>${escapeHtml(currentUser.name || 'My Donation')}</h4>
                    <p><strong>Blood Group:</strong> ${escapeHtml(donation.blood_group)}</p>
                    <p><strong>Units Donated:</strong> ${escapeHtml(donation.units_donated)}</p>
                    <p><strong>Date:</strong> ${escapeHtml(new Date(donation.donation_date).toLocaleDateString())}</p>
                    <p><strong>Center:</strong> ${escapeHtml(donation.donation_center || 'Not specified')}</p>
                    <p><strong>Patient:</strong> ${escapeHtml(donation.patient_name || 'Not linked')}</p>
                    <span class="status ${String(donation.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(donation.status || 'Scheduled')}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="loading">You have not donated yet. Schedule your first donation.</div>';
        }
    } catch (error) {
        console.error('Load donations error:', error);
        container.innerHTML = '<div class="loading">Unable to load your donations right now.</div>';
    }
}

async function loadNearbyDonors() {
    const container = document.getElementById('nearbyDonors');
    if (!container) {
        return;
    }

    if (!currentUser || !currentUser.blood_group) {
        container.innerHTML = '<div class="loading">Please login again to load nearby donors.</div>';
        return;
    }

    if (!currentUser || currentUser.latitude === null || currentUser.latitude === undefined ||
        currentUser.longitude === null || currentUser.longitude === undefined) {
        const captured = await syncCurrentLocation({ silent: false, force: true });
        if (!captured) {
            container.innerHTML = '<div class="loading">Enable location permission, then click Refresh.</div>';
            return;
        }
    }

    container.innerHTML = '<div class="loading">Loading nearby donors...</div>';

    try {
        const params = new URLSearchParams({
            bloodGroup: currentUser.blood_group,
            latitude: currentUser.latitude,
            longitude: currentUser.longitude,
            radiusKm: '25',
            limit: '8'
        });

        const response = await fetch(`/api/matching/nearby-donors?${params.toString()}`);
        const result = await response.json();

        if (!result.success || !result.donors || result.donors.length === 0) {
            container.innerHTML = '<div class="loading">No eligible nearby donors found yet. Ask donors to register with location enabled.</div>';
            return;
        }

        container.innerHTML = result.donors.map(donor => `
            <div class="nearby-item">
                <h4>${donor.name}</h4>
                <p><strong>Blood Group:</strong> ${donor.blood_group}</p>
                <p><strong>Distance:</strong> ${donor.distance_km} km</p>
                <p><strong>Location:</strong> ${donor.city || donor.location || 'Not specified'}</p>
                <p><strong>Contact:</strong> ${donor.phone || donor.email || 'Not available'}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Nearby donor load error:', error);
        container.innerHTML = '<div class="loading">Unable to load nearby donors right now.</div>';
    }
}

async function primeDonorLocationSearch() {
    const locationInput = document.getElementById('donorLocationQuery');
    if (!locationInput || locationInput.value.trim()) {
        return;
    }

    const preferredLocation = currentUser?.city || currentUser?.location || currentUser?.state || '';
    if (!preferredLocation) {
        return;
    }

    locationInput.value = preferredLocation;
    await searchDonorsByLocation();
}

async function primeReceiverLocationSearch() {
    const locationInput = document.getElementById('receiverLocationQuery');
    if (!locationInput || locationInput.value.trim()) {
        return;
    }

    const preferredLocation = currentUser?.city || currentUser?.location || currentUser?.state || '';
    if (!preferredLocation) {
        return;
    }

    locationInput.value = preferredLocation;
    await searchReceiversByLocation();
}

async function handleDonorLocationSearch(event) {
    event.preventDefault();
    await searchDonorsByLocation();
}

async function handleReceiverLocationSearch(event) {
    event.preventDefault();
    await searchReceiversByLocation();
}

async function searchDonorsByLocation() {
    const locationInput = document.getElementById('donorLocationQuery');
    const bloodGroupSelect = document.getElementById('donorSearchBloodGroup');
    const limitSelect = document.getElementById('donorSearchLimit');
    const container = document.getElementById('donorLocationResults');

    if (!locationInput || !container) {
        return;
    }

    const location = locationInput.value.trim();
    const bloodGroup = bloodGroupSelect ? bloodGroupSelect.value : '';
    const limit = limitSelect ? limitSelect.value : '10';

    if (!location) {
        container.innerHTML = '<div class="loading">Enter a location to search donors.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Searching donors...</div>';

    try {
        const params = new URLSearchParams({
            location,
            limit
        });
        if (bloodGroup) {
            params.set('bloodGroup', bloodGroup);
        }

        const response = await fetch(`/api/matching/donors-by-location?${params.toString()}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to search donors.')}</div>`;
            return;
        }

        if (!result.donors || result.donors.length === 0) {
            container.innerHTML = '<div class="loading">No donor found for this location yet.</div>';
            return;
        }

        container.innerHTML = result.donors.map(donor => `
            <div class="search-item donor">
                <h4>${escapeHtml(donor.name)}</h4>
                <p><strong>Blood Group:</strong> ${escapeHtml(donor.blood_group)}</p>
                <p><strong>Location:</strong> ${escapeHtml(donor.city || donor.location || donor.state || 'Not specified')}</p>
                <p><strong>Contact:</strong> ${escapeHtml(donor.phone || donor.email || 'Not available')}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Search donors by location error:', error);
        container.innerHTML = '<div class="loading">Failed to search donors right now.</div>';
    }
}

async function searchReceiversByLocation() {
    const locationInput = document.getElementById('receiverLocationQuery');
    const bloodGroupSelect = document.getElementById('receiverSearchBloodGroup');
    const limitSelect = document.getElementById('receiverSearchLimit');
    const container = document.getElementById('receiverLocationResults');

    if (!locationInput || !container) {
        return;
    }

    const location = locationInput.value.trim();
    const bloodGroup = bloodGroupSelect ? bloodGroupSelect.value : '';
    const limit = limitSelect ? limitSelect.value : '10';

    if (!location) {
        container.innerHTML = '<div class="loading">Enter a location to search receivers.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Searching receivers...</div>';

    try {
        const params = new URLSearchParams({
            location,
            limit
        });
        if (bloodGroup) {
            params.set('bloodGroup', bloodGroup);
        }

        const response = await fetch(`/api/matching/receivers-by-location?${params.toString()}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to search receivers.')}</div>`;
            return;
        }

        if (!result.receivers || result.receivers.length === 0) {
            container.innerHTML = '<div class="loading">No active receiver request found in this location.</div>';
            return;
        }

        container.innerHTML = result.receivers.map(receiver => `
            <div class="search-item receiver">
                <h4>${escapeHtml(receiver.patient_name)}</h4>
                <p><strong>Blood Group:</strong> ${escapeHtml(receiver.blood_group)} | <strong>Units:</strong> ${escapeHtml(receiver.units_required)}</p>
                <p><strong>Urgency:</strong> ${escapeHtml(receiver.urgency_level)}</p>
                <p><strong>Hospital:</strong> ${escapeHtml(receiver.hospital_name || 'Not specified')}</p>
                <p><strong>Location:</strong> ${escapeHtml(receiver.requester_city || receiver.requester_location || receiver.requester_state || receiver.hospital_address || 'Not specified')}</p>
                <p><strong>Contact:</strong> ${escapeHtml(receiver.contact_phone || receiver.requester_phone || 'Not available')}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Search receivers by location error:', error);
        container.innerHTML = '<div class="loading">Failed to search receivers right now.</div>';
    }
}

async function loadSuperheroes() {
    const container = document.getElementById('superheroesList');
    if (!container) {
        return;
    }

    container.innerHTML = '<div class="loading">Loading heroes...</div>';
    try {
        const response = await fetch('/api/donations/superheroes?limit=8&days=180');
        const result = await response.json();

        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to load heroes')}</div>`;
            return;
        }

        if (!result.superheroes || result.superheroes.length === 0) {
            container.innerHTML = '<div class="loading">No completed donations yet. Be the first hero.</div>';
            return;
        }

        container.innerHTML = result.superheroes.map(hero => `
            <div class="hero-item">
                <div class="hero-rank">#${hero.rank}</div>
                <div class="hero-content">
                    <h4>${escapeHtml(hero.name)} <span class="badge">${escapeHtml(hero.badge)}</span></h4>
                    <p>${escapeHtml(hero.thank_you_note)}</p>
                    <p><strong>Donations:</strong> ${escapeHtml(hero.donation_count)} | <strong>Units:</strong> ${escapeHtml(hero.total_units)} | <strong>Location:</strong> ${escapeHtml([hero.city, hero.state].filter(Boolean).join(', ') || 'Not specified')}</p>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load superheroes error:', error);
        container.innerHTML = '<div class="loading">Failed to load donor leaderboard.</div>';
    }
}

async function loadFeedbackSummary() {
    const avgNode = document.getElementById('avgRatingValue');
    const countNode = document.getElementById('feedbackCountValue');
    const distributionNode = document.getElementById('ratingDistribution');
    if (!avgNode || !countNode || !distributionNode) {
        return;
    }

    try {
        const response = await fetch('/api/feedback/summary');
        const result = await response.json();

        if (!response.ok || !result.success) {
            avgNode.textContent = '-';
            countNode.textContent = '0';
            distributionNode.innerHTML = '<div class="loading">No rating summary available.</div>';
            return;
        }

        const summary = result.summary;
        avgNode.textContent = Number(summary.average_rating || 0).toFixed(2);
        countNode.textContent = String(summary.total_feedback || 0);

        const distribution = summary.distribution || {};
        const rows = [5, 4, 3, 2, 1].map(star => `
            <div class="rating-row">
                <span>${star}★</span>
                <span>${distribution[star] || 0}</span>
            </div>
        `).join('');
        distributionNode.innerHTML = rows;
    } catch (error) {
        console.error('Load feedback summary error:', error);
    }
}

async function loadRecentFeedback() {
    const container = document.getElementById('recentFeedbackList');
    if (!container) {
        return;
    }

    try {
        const response = await fetch('/api/feedback/recent?limit=6');
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = '<div class="loading">Unable to load feedback yet.</div>';
            return;
        }

        if (!result.feedback || result.feedback.length === 0) {
            container.innerHTML = '<div class="loading">No feedback submitted yet.</div>';
            return;
        }

        container.innerHTML = result.feedback.map(item => `
            <div class="feedback-item">
                <div class="feedback-head">
                    <strong>${escapeHtml(item.user_name || 'Anonymous User')}</strong>
                    <span>${'★'.repeat(Number(item.rating) || 0)}</span>
                </div>
                <p>${escapeHtml(item.feedback_text || 'Shared a rating')}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load recent feedback error:', error);
        container.innerHTML = '<div class="loading">Unable to load feedback yet.</div>';
    }
}

function setFeedbackFormState(feedback) {
    const feedbackForm = document.getElementById('feedbackForm');
    if (!feedbackForm) {
        return;
    }

    const ratingSelect = document.getElementById('feedbackRating');
    const categorySelect = document.getElementById('feedbackCategory');
    const feedbackTextarea = document.getElementById('feedbackText');
    const submitButton = feedbackForm.querySelector('button[type="submit"]');
    let hintNode = feedbackForm.querySelector('.feedback-form-hint');

    if (!hintNode) {
        hintNode = document.createElement('p');
        hintNode.className = 'feedback-form-hint';
        feedbackForm.insertBefore(hintNode, feedbackForm.firstChild);
    }

    if (!feedback) {
        if (submitButton) {
            submitButton.textContent = 'Submit Feedback';
        }
        hintNode.textContent = 'You can submit one rating. Submitting again will update your existing rating.';
        return;
    }

    if (ratingSelect) {
        ratingSelect.value = String(feedback.rating ?? '');
    }
    if (categorySelect) {
        categorySelect.value = feedback.category || 'General';
    }
    if (feedbackTextarea) {
        feedbackTextarea.value = feedback.feedback_text || '';
    }
    if (submitButton) {
        submitButton.textContent = 'Update Feedback';
    }
    hintNode.textContent = 'Your rating is saved. You can update it anytime.';
}

async function loadMyFeedback() {
    if (!currentUser || !currentUser.id) {
        return;
    }

    try {
        const response = await fetch(`/api/feedback/user/${currentUser.id}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            return;
        }

        myFeedback = result.feedback || null;
        setFeedbackFormState(myFeedback);
    } catch (error) {
        console.error('Load my feedback error:', error);
    }
}

async function handleFeedbackSubmit(event) {
    event.preventDefault();
    if (!currentUser || !currentUser.id) {
        showMessage('Please login again to submit feedback', 'warning');
        return;
    }

    const feedbackForm = event.target;
    const formData = new FormData(feedbackForm);
    const rating = Number.parseInt(formData.get('rating'), 10);
    const category = String(formData.get('category') || 'General').trim();
    const feedbackText = String(formData.get('feedback_text') || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        showMessage('Please provide a rating between 1 and 5', 'warning');
        return;
    }

    try {
        const payload = {
            user_id: currentUser.id,
            rating,
            category,
            feedback_text: feedbackText
        };

        const response = await fetch('/api/feedback/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to submit feedback', 'error');
            return;
        }

        const successMessage = result.action === 'updated'
            ? 'Your rating was updated successfully.'
            : 'Thanks for your feedback. It helps improve this app.';
        showMessage(successMessage, 'success');
        await Promise.all([loadFeedbackSummary(), loadRecentFeedback(), loadMyFeedback()]);
    } catch (error) {
        console.error('Submit feedback error:', error);
        showMessage('Failed to submit feedback right now.', 'error');
    }
}

const getEmergencyAlertKey = alert => {
    const requestId = alert?.request_id ?? alert?.id ?? 'unknown';
    const createdAt = alert?.created_at ?? alert?.timestamp ?? '';
    const hospital = alert?.hospital_name ?? '';
    return `${requestId}|${createdAt}|${hospital}`;
};

const rememberEmergencyAlert = key => {
    if (seenEmergencyAlerts.has(key)) {
        return false;
    }

    seenEmergencyAlerts.add(key);
    if (seenEmergencyAlerts.size > MAX_TRACKED_EMERGENCY_ALERTS) {
        const oldestKey = seenEmergencyAlerts.values().next().value;
        if (oldestKey) {
            seenEmergencyAlerts.delete(oldestKey);
        }
    }
    return true;
};

const toDistanceText = value => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(2)} km` : 'Distance unavailable';
};

function renderEmergencyAlert(alert, { prepend = true } = {}) {
    const alertsContainer = document.getElementById('liveAlerts');
    if (!alertsContainer || !alert) {
        return false;
    }

    const key = getEmergencyAlertKey(alert);
    if (!rememberEmergencyAlert(key)) {
        return false;
    }

    if (alertsContainer.querySelector('.loading')) {
        alertsContainer.innerHTML = '';
    }

    const item = document.createElement('div');
    item.className = 'alert-item';
    item.dataset.alertKey = key;
    item.innerHTML = `
        <h4>${escapeHtml(alert.patient_name || 'Emergency blood request')}</h4>
        <p><strong>Blood Group:</strong> ${escapeHtml(alert.blood_group || 'Unknown')}</p>
        <p><strong>Urgency:</strong> ${escapeHtml(alert.urgency_level || 'Emergency')}</p>
        <p><strong>Distance:</strong> ${escapeHtml(toDistanceText(alert.distance_km))}</p>
        <p><strong>Hospital:</strong> ${escapeHtml(alert.hospital_name || 'Not specified')}</p>
    `;

    if (prepend) {
        alertsContainer.prepend(item);
    } else {
        alertsContainer.append(item);
    }

    const items = alertsContainer.querySelectorAll('.alert-item');
    if (items.length > 8) {
        const lastItem = items[items.length - 1];
        if (lastItem && lastItem.dataset.alertKey) {
            seenEmergencyAlerts.delete(lastItem.dataset.alertKey);
        }
        lastItem?.remove();
    }

    return true;
}

async function loadRecentEmergencyAlerts({ suppressErrors = false } = {}) {
    const alertsContainer = document.getElementById('liveAlerts');
    if (!alertsContainer || !currentUser || !currentUser.id) {
        return;
    }

    try {
        const params = new URLSearchParams({
            userId: String(currentUser.id),
            radiusKm: String(ALERT_RADIUS_KM),
            limit: '8'
        });

        if (currentUser.blood_group) {
            params.set('bloodGroup', currentUser.blood_group);
        }
        if (currentUser.latitude !== null && currentUser.latitude !== undefined &&
            currentUser.longitude !== null && currentUser.longitude !== undefined) {
            params.set('latitude', String(currentUser.latitude));
            params.set('longitude', String(currentUser.longitude));
        }

        const response = await fetch(`/api/alerts/recent?${params.toString()}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            if (!suppressErrors && alertsContainer.querySelectorAll('.alert-item').length === 0) {
                alertsContainer.innerHTML = '<div class="loading">Unable to load alerts right now.</div>';
            }
            return;
        }

        if (!Array.isArray(result.alerts) || result.alerts.length === 0) {
            if (alertsContainer.querySelectorAll('.alert-item').length === 0) {
                alertsContainer.innerHTML = '<div class="loading">Listening for emergencies near you...</div>';
            }
            return;
        }

        result.alerts.forEach(alert => {
            renderEmergencyAlert(alert, { prepend: false });
        });
    } catch (error) {
        if (!suppressErrors) {
            console.error('Load recent emergency alerts error:', error);
        }
    }
}

function stopEmergencyAlerts() {
    if (alertSource) {
        alertSource.close();
        alertSource = null;
    }
    if (alertReconnectTimer) {
        clearTimeout(alertReconnectTimer);
        alertReconnectTimer = null;
    }
    if (alertPollingTimer) {
        clearInterval(alertPollingTimer);
        alertPollingTimer = null;
    }
}

function startEmergencyAlerts() {
    const alertsContainer = document.getElementById('liveAlerts');
    if (!alertsContainer || !currentUser || !currentUser.id) {
        return;
    }

    stopEmergencyAlerts();
    alertsContainer.innerHTML = '<div class="loading">Connecting to live emergency alerts...</div>';
    loadRecentEmergencyAlerts({ suppressErrors: true });

    const connect = () => {
        if (!currentUser || !currentUser.id) {
            return;
        }

        const params = new URLSearchParams({
            userId: String(currentUser.id),
            radiusKm: String(ALERT_RADIUS_KM)
        });
        if (currentUser.blood_group) {
            params.set('bloodGroup', currentUser.blood_group);
        }
        if (currentUser.latitude !== null && currentUser.latitude !== undefined &&
            currentUser.longitude !== null && currentUser.longitude !== undefined) {
            params.set('latitude', String(currentUser.latitude));
            params.set('longitude', String(currentUser.longitude));
        }

        alertSource = new EventSource(`/api/alerts/stream?${params.toString()}`);

        alertSource.addEventListener('connected', () => {
            alertReconnectAttempts = 0;
            if (alertsContainer.querySelectorAll('.alert-item').length === 0) {
                alertsContainer.innerHTML = '<div class="loading">Listening for emergencies near you...</div>';
            }
        });

        alertSource.addEventListener('heartbeat', () => {
            // Keepalive event is intentionally ignored.
        });

        alertSource.addEventListener('emergency-alert', event => {
            try {
                const payload = JSON.parse(event.data);
                const inserted = renderEmergencyAlert(payload, { prepend: true });
                if (inserted) {
                    const distanceLabel = Number.isFinite(Number.parseFloat(payload.distance_km))
                        ? `${Number.parseFloat(payload.distance_km).toFixed(2)} km away`
                        : 'for your blood group nearby';
                    showMessage(
                        `Emergency alert: ${payload.blood_group || 'Blood'} needed ${distanceLabel}`,
                        'warning'
                    );
                }
            } catch (error) {
                console.error('Failed to parse emergency alert payload', error);
            }
        });

        alertSource.onerror = () => {
            if (alertSource) {
                alertSource.close();
                alertSource = null;
            }

            if (alertReconnectTimer) {
                clearTimeout(alertReconnectTimer);
            }

            const delay = Math.min(
                ALERT_RECONNECT_BASE_MS * Math.pow(2, alertReconnectAttempts),
                ALERT_RECONNECT_MAX_MS
            );
            alertReconnectAttempts += 1;

            if (alertsContainer.querySelectorAll('.alert-item').length === 0) {
                alertsContainer.innerHTML = '<div class="loading">Connection lost. Reconnecting to live alerts...</div>';
            }

            alertReconnectTimer = setTimeout(() => {
                connect();
                loadRecentEmergencyAlerts({ suppressErrors: true });
            }, delay);
        };
    };

    connect();
    alertPollingTimer = setInterval(() => {
        loadRecentEmergencyAlerts({ suppressErrors: true });
    }, ALERT_POLL_INTERVAL_MS);

    if (!beforeUnloadBound) {
        window.addEventListener('beforeunload', stopEmergencyAlerts);
        beforeUnloadBound = true;
    }
}

async function handleBloodRequest(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const urgencyLevel = formData.get('urgencyLevel');
    const requestData = {
        requester_id: currentUser.id,
        patient_name: formData.get('patientName'),
        blood_group: formData.get('bloodGroup'),
        units_required: Number.parseInt(formData.get('unitsRequired'), 10),
        hospital_name: formData.get('hospitalName'),
        urgency_level: urgencyLevel,
        reason: formData.get('reason'),
        required_date: formData.get('requiredDate'),
        latitude: currentUser.latitude || null,
        longitude: currentUser.longitude || null,
        search_radius_km: urgencyLevel === 'Emergency' ? 5 : 10
    };

    try {
        const response = await fetch('/api/blood-requests/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (result.success) {
            const alertSuffix = result.alerts_sent ? ` (${result.alerts_sent} donors notified)` : '';
            showMessage(`Blood request created successfully${alertSuffix}`, 'success');
            closeModal('requestModal');
            e.target.reset();
            await Promise.all([loadRecentRequests(), loadStatistics()]);
        } else {
            showMessage(result.message || 'Failed to create blood request', 'error');
        }
    } catch (error) {
        console.error('Blood request error:', error);
        showMessage('Network error. Please try again.', 'error');
    }
}

async function handleDonation(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const donationData = {
        donor_id: currentUser.id,
        donation_date: formData.get('donationDate'),
        blood_group: currentUser.blood_group,
        units_donated: Number.parseInt(formData.get('unitsDonated'), 10),
        donation_center: formData.get('donationCenter'),
        notes: formData.get('donationNotes')
    };

    try {
        const response = await fetch('/api/donations/schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(donationData)
        });

        const result = await response.json();

        if (result.success) {
            showMessage('Blood donation scheduled successfully!', 'success');
            closeModal('donationModal');
            e.target.reset();
            await Promise.all([loadRecentDonations(), loadStatistics(), loadNearbyDonors()]);
        } else {
            showMessage(result.message || 'Failed to schedule donation', 'error');
        }
    } catch (error) {
        console.error('Donation error:', error);
        showMessage('Network error. Please try again.', 'error');
    }
}

async function viewInventory() {
    try {
        const response = await fetch('/api/inventory/all');
        const result = await response.json();

        if (result.success) {
            const inventoryText = result.inventory
                .map(item => `${item.blood_group}: ${item.available_units} available, ${item.reserved_units} reserved`)
                .join(' | ');

            showMessage(`Inventory: ${inventoryText}`, 'info');
        } else {
            showMessage('Failed to load inventory', 'error');
        }
    } catch (error) {
        console.error('View inventory error:', error);
        showMessage('Failed to load inventory', 'error');
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function logout() {
    stopEmergencyAlerts();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('registeredUser');
    window.location.href = '/login';
}

function showMessage(message, type = 'info', options = {}) {
    if (!options.skipNotification) {
        pushNotification(message, type);
    }

    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);

    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}

window.closeModal = closeModal;
