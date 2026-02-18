// Dashboard JavaScript
let currentUser = null;
let alertSource = null;
let alertReconnectTimer = null;
let alertPollingTimer = null;
let alertReconnectAttempts = 0;
let beforeUnloadBound = false;
let attemptedLocationCapture = false;
let notificationItems = [];
let persistentNotifications = [];
let myFeedback = null;
let pendingSecureDonorTarget = null;
const seenEmergencyAlerts = new Set();

const NOTIFICATION_STORAGE_KEY = 'appNotifications';
const NOTIFICATION_LIMIT = 40;
const ALERT_RADIUS_KM = 5;
const ALERT_POLL_INTERVAL_MS = 30000;
const ALERT_RECONNECT_BASE_MS = 2000;
const ALERT_RECONNECT_MAX_MS = 30000;
const MAX_TRACKED_EMERGENCY_ALERTS = 150;
const ROLE_VALUES = new Set(['user', 'hospital', 'blood_bank', 'doctor', 'admin']);

const parsePositiveInt = value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeRole = value => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'user';
    return ROLE_VALUES.has(normalized) ? normalized : 'user';
};

const normalizeUserId = user => {
    if (!user || !user.id) {
        return user;
    }

    const parsedId = parsePositiveInt(user.id);
    const parsedFacilityId = parsePositiveInt(user.facility_id);
    return {
        ...user,
        id: parsedId || user.id,
        facility_id: parsedFacilityId || null,
        role: normalizeRole(user.role)
    };
};

const isAuthorityRole = role => {
    const normalizedRole = normalizeRole(role);
    return normalizedRole === 'hospital' ||
        normalizedRole === 'blood_bank' ||
        normalizedRole === 'doctor' ||
        normalizedRole === 'admin';
};

const isVerifiedAuthorityClient = user => {
    if (!user) {
        return false;
    }

    const role = normalizeRole(user.role);
    if (!isAuthorityRole(role)) {
        return false;
    }

    if (role === 'admin') {
        return true;
    }

    return Boolean(user.is_verified);
};

const resolveHospitalScopeId = user => {
    if (!user) {
        return null;
    }

    const role = normalizeRole(user.role);
    if (role === 'hospital' || role === 'blood_bank') {
        return parsePositiveInt(user.id);
    }

    if (role === 'doctor') {
        return parsePositiveInt(user.facility_id);
    }

    return null;
};

const getAuthorityScopeLabel = user => {
    const role = normalizeRole(user?.role);
    if (role === 'hospital') {
        return `Hospital Scope: #${toDisplayValue(user?.id)}`;
    }
    if (role === 'blood_bank') {
        return `Blood Bank Scope: #${toDisplayValue(user?.id)}`;
    }
    if (role === 'doctor') {
        return user?.facility_id
            ? `Doctor Scope: Facility #${toDisplayValue(user.facility_id)}`
            : 'Doctor Scope: No facility_id set';
    }
    if (role === 'admin') {
        return 'Admin Scope: Global';
    }
    return 'User Scope';
};

const roleToLabel = role => {
    const normalized = normalizeRole(role);
    if (normalized === 'blood_bank') {
        return 'Blood Bank';
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

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
    const roleLabel = roleToLabel(user?.role);
    const verificationLabel = normalizeRole(user?.role) === 'admin'
        ? 'Verified'
        : (user?.is_verified ? 'Verified' : 'Pending');

    document.getElementById('userName').textContent = toDisplayValue(user?.name, 'User');
    document.getElementById('userEmail').textContent = toDisplayValue(user?.email, 'No email');
    document.getElementById('userBloodGroup').textContent = toDisplayValue(user?.blood_group, '-');
    document.getElementById('userLocation').textContent = toDisplayValue(location, 'Not specified');
    document.getElementById('userPhone').textContent = toDisplayValue(user?.phone, 'Not specified');
    const roleNode = document.getElementById('userRole');
    const verificationNode = document.getElementById('userVerification');
    if (roleNode) {
        roleNode.textContent = roleLabel;
    }
    if (verificationNode) {
        verificationNode.textContent = verificationLabel;
    }
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
        const unreadServerCount = persistentNotifications.filter(item => !item.is_read).length;
        countNode.textContent = String(notificationItems.length + unreadServerCount);
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

        currentUser = normalizeUserId(currentUser);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        // Render cached data immediately so UI never remains on "Loading..."
        renderUserProfile(currentUser);

        const profileLoaded = await loadUserProfile();
        if (!profileLoaded) {
            renderUserProfile(currentUser);
        }
        configureRoleBasedSections();

        await syncCurrentLocation({ silent: true, force: true });

        await Promise.all([
            loadStatistics(),
            loadRecentRequests(),
            loadRecentDonations(),
            loadNearbyDonors(),
            loadSuperheroes(),
            loadFeedbackSummary(),
            loadRecentFeedback(),
            loadMyFeedback(),
            loadPersistentNotifications()
        ]);

        await Promise.all([
            primeDonorLocationSearch(),
            primeReceiverLocationSearch()
        ]);

        if (isVerifiedAuthorityClient(currentUser)) {
            await Promise.all([
                loadPendingVerificationRequests(),
                loadScopedInventory()
            ]);
        }

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
    const refreshServerNotificationsBtn = document.getElementById('refreshServerNotificationsBtn');
    const refreshPendingVerificationBtn = document.getElementById('refreshPendingVerificationBtn');
    const completeDonationByQrForm = document.getElementById('completeDonationByQrForm');
    const generateCallLinkForm = document.getElementById('generateCallLinkForm');
    const refreshScopedInventoryBtn = document.getElementById('refreshScopedInventoryBtn');
    const inventoryUpdateForm = document.getElementById('inventoryUpdateForm');
    const inventoryOperationForm = document.getElementById('inventoryOperationForm');
    const loadPendingAuthoritiesBtn = document.getElementById('loadPendingAuthoritiesBtn');
    const profileControlsForm = document.getElementById('profileControlsForm');
    const deleteProfileBtn = document.getElementById('deleteProfileBtn');
    const urgencyLevelSelect = document.getElementById('urgencyLevel');
    const persistentNotificationFeed = document.getElementById('persistentNotificationFeed');
    const pendingVerificationList = document.getElementById('pendingVerificationList');
    const pendingAuthoritiesList = document.getElementById('pendingAuthoritiesList');
    const donorLocationResults = document.getElementById('donorLocationResults');
    const nearbyDonorsContainer = document.getElementById('nearbyDonors');

    if (requestBtn) {
        requestBtn.addEventListener('click', () => {
            pendingSecureDonorTarget = null;
            openModal('requestModal');
        });
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
    if (refreshServerNotificationsBtn) {
        refreshServerNotificationsBtn.addEventListener('click', loadPersistentNotifications);
    }
    if (refreshPendingVerificationBtn) {
        refreshPendingVerificationBtn.addEventListener('click', loadPendingVerificationRequests);
    }
    if (completeDonationByQrForm) {
        completeDonationByQrForm.addEventListener('submit', handleCompleteDonationByQr);
    }
    if (generateCallLinkForm) {
        generateCallLinkForm.addEventListener('submit', handleGenerateCallLink);
    }
    if (refreshScopedInventoryBtn) {
        refreshScopedInventoryBtn.addEventListener('click', loadScopedInventory);
    }
    if (inventoryUpdateForm) {
        inventoryUpdateForm.addEventListener('submit', handleScopedInventoryUpdate);
    }
    if (inventoryOperationForm) {
        inventoryOperationForm.addEventListener('submit', handleScopedInventoryOperation);
    }
    if (loadPendingAuthoritiesBtn) {
        loadPendingAuthoritiesBtn.addEventListener('click', loadPendingAuthoritiesForApproval);
    }
    if (profileControlsForm) {
        profileControlsForm.addEventListener('submit', handleSaveProfileControls);
    }
    if (deleteProfileBtn) {
        deleteProfileBtn.addEventListener('click', handleDeleteProfile);
    }
    if (urgencyLevelSelect) {
        urgencyLevelSelect.addEventListener('change', updateRequestVerificationHint);
        updateRequestVerificationHint();
    }
    if (persistentNotificationFeed) {
        persistentNotificationFeed.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.matches('[data-mark-read-id]')) {
                const notificationId = parsePositiveInt(target.dataset.markReadId);
                if (notificationId) {
                    markServerNotificationAsRead(notificationId);
                }
            }
        });
    }
    if (pendingVerificationList) {
        pendingVerificationList.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.matches('[data-verify-request-id]')) {
                const requestId = parsePositiveInt(target.dataset.verifyRequestId);
                if (requestId) {
                    handleVerifyBroadcastAction(requestId, true);
                }
            }

            if (target.matches('[data-reject-request-id]')) {
                const requestId = parsePositiveInt(target.dataset.rejectRequestId);
                if (requestId) {
                    handleVerifyBroadcastAction(requestId, false);
                }
            }

            if (target.matches('[data-call-link-request-id]')) {
                const requestId = parsePositiveInt(target.dataset.callLinkRequestId);
                if (requestId) {
                    generateCallLinkForRequest(requestId);
                }
            }
        });
    }
    if (pendingAuthoritiesList) {
        pendingAuthoritiesList.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.matches('[data-authority-approve-id]')) {
                const authorityId = parsePositiveInt(target.dataset.authorityApproveId);
                if (authorityId) {
                    setAuthorityApprovalStatus(authorityId, true);
                }
            }

            if (target.matches('[data-authority-reject-id]')) {
                const authorityId = parsePositiveInt(target.dataset.authorityRejectId);
                if (authorityId) {
                    setAuthorityApprovalStatus(authorityId, false);
                }
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
    if (donorLocationResults) {
        donorLocationResults.addEventListener('click', handleDonorSecureConnectClick);
    }
    if (nearbyDonorsContainer) {
        nearbyDonorsContainer.addEventListener('click', handleDonorSecureConnectClick);
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

function configureRoleBasedSections() {
    const authoritySection = document.getElementById('authorityConsoleSection');
    const inventorySection = document.getElementById('inventoryManagementSection');
    const scopeLabel = document.getElementById('authorityScopeLabel');
    const inventoryScopeText = document.getElementById('inventoryScopeText');

    const isAuthority = isVerifiedAuthorityClient(currentUser);
    if (authoritySection) {
        authoritySection.hidden = !isAuthority;
    }
    if (inventorySection) {
        inventorySection.hidden = !isAuthority;
    }

    const scopeLabelText = getAuthorityScopeLabel(currentUser);
    if (scopeLabel) {
        scopeLabel.textContent = scopeLabelText;
    }
    if (inventoryScopeText) {
        inventoryScopeText.textContent = `${scopeLabelText}. All inventory writes are scoped automatically.`;
    }

    const isDonorActive = document.getElementById('isDonorActive');
    if (isDonorActive) {
        isDonorActive.checked = currentUser?.is_donor !== false;
    }

    const alertSnoozeDays = document.getElementById('alertSnoozeDays');
    if (alertSnoozeDays) {
        const snoozeUntilRaw = currentUser?.alert_snooze_until;
        const snoozeUntil = snoozeUntilRaw ? new Date(snoozeUntilRaw) : null;
        if (!snoozeUntil || Number.isNaN(snoozeUntil.getTime()) || snoozeUntil <= new Date()) {
            alertSnoozeDays.value = '0';
        } else {
            const dayDiff = Math.ceil((snoozeUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            if (dayDiff <= 1) {
                alertSnoozeDays.value = '1';
            } else if (dayDiff <= 7) {
                alertSnoozeDays.value = '7';
            } else {
                alertSnoozeDays.value = '30';
            }
        }
    }
}

function resolveScopedHospitalIdForAuthority() {
    const role = normalizeRole(currentUser?.role);
    const scopedHospitalId = resolveHospitalScopeId(currentUser);

    if (role === 'doctor' && !scopedHospitalId) {
        showMessage('Doctor account requires facility_id to manage scoped inventory.', 'warning');
        return { scopedHospitalId: null, blocked: true };
    }

    if ((role === 'hospital' || role === 'blood_bank') && !scopedHospitalId) {
        showMessage('Authority profile is missing an account ID for inventory scope.', 'warning');
        return { scopedHospitalId: null, blocked: true };
    }

    return { scopedHospitalId, blocked: false };
}

function buildScopedInventoryPayload(payload = {}) {
    const actorUserId = parsePositiveInt(currentUser?.id);
    if (!actorUserId) {
        return null;
    }

    const { scopedHospitalId, blocked } = resolveScopedHospitalIdForAuthority();
    if (blocked) {
        return null;
    }

    return {
        ...payload,
        actor_user_id: actorUserId,
        ...(scopedHospitalId ? { hospital_id: scopedHospitalId } : {})
    };
}

function buildScopedInventoryQueryString() {
    const { scopedHospitalId, blocked } = resolveScopedHospitalIdForAuthority();
    if (blocked) {
        return null;
    }

    const params = new URLSearchParams();
    if (scopedHospitalId) {
        params.set('hospital_id', String(scopedHospitalId));
    }

    return params.toString();
}

function updateRequestVerificationHint() {
    const urgencySelect = document.getElementById('urgencyLevel');
    const requisitionInput = document.getElementById('requisitionImageUrl');
    const note = document.getElementById('requestVerificationNote');
    if (!urgencySelect || !requisitionInput || !note) {
        return;
    }

    const urgencyLevel = String(urgencySelect.value || 'Medium');
    const requiresVerification = urgencyLevel === 'High' || urgencyLevel === 'Emergency';
    requisitionInput.required = requiresVerification;

    if (requiresVerification) {
        note.textContent = 'High and Emergency requests require doctor requisition and authority verification before live broadcast.';
    } else {
        note.textContent = 'Low and Medium requests are created immediately. High/Emergency are verification-gated.';
    }
}

function setDonationPassPanel(passData = null) {
    const passTextNode = document.getElementById('latestDonationPassText');
    if (!passTextNode) {
        return;
    }

    if (!passData || !passData.verification_qr_token) {
        passTextNode.textContent = 'Schedule a donation to generate your verification pass.';
        return;
    }

    const expiresLabel = passData.expires_at
        ? new Date(passData.expires_at).toLocaleString()
        : 'Not set';
    passTextNode.textContent = `Token: ${passData.verification_qr_token} | Expires: ${expiresLabel}`;
}

function getTodayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function parseSecureDonorTargetFromElement(element) {
    if (!(element instanceof HTMLElement)) {
        return null;
    }

    const donorId = parsePositiveInt(element.dataset.secureConnectDonorId);
    if (!donorId) {
        return null;
    }

    return {
        donorId,
        donorName: String(element.dataset.secureConnectDonorName || 'Nearby donor').trim() || 'Nearby donor',
        bloodGroup: String(element.dataset.secureConnectBloodGroup || '').trim().toUpperCase(),
        locationLabel: String(element.dataset.secureConnectLocation || 'your area').trim() || 'your area'
    };
}

function prefillBloodRequestFormForSecureTarget(target) {
    const patientNameInput = document.getElementById('patientName');
    const bloodGroupInput = document.getElementById('bloodGroup');
    const unitsRequiredInput = document.getElementById('unitsRequired');
    const urgencyLevelInput = document.getElementById('urgencyLevel');
    const reasonInput = document.getElementById('reason');
    const requiredDateInput = document.getElementById('requiredDate');

    if (patientNameInput && !patientNameInput.value.trim()) {
        const fallbackName = currentUser?.name ? `${currentUser.name} (self/family)` : 'Patient Name';
        patientNameInput.value = fallbackName;
    }

    if (bloodGroupInput && target.bloodGroup) {
        bloodGroupInput.value = target.bloodGroup;
    }

    if (unitsRequiredInput && !unitsRequiredInput.value) {
        unitsRequiredInput.value = '1';
    }

    if (urgencyLevelInput && !urgencyLevelInput.value) {
        urgencyLevelInput.value = 'Medium';
    }

    if (requiredDateInput && !requiredDateInput.value) {
        requiredDateInput.value = getTodayIsoDate();
    }

    if (reasonInput && !reasonInput.value.trim()) {
        reasonInput.value = `Need ${target.bloodGroup || 'matching'} donor support near ${target.locationLabel}.`;
    }

    updateRequestVerificationHint();
}

function handleDonorSecureConnectClick(event) {
    const source = event.target;
    if (!(source instanceof Element)) {
        return;
    }

    const button = source.closest('[data-secure-connect-donor-id]');
    if (!(button instanceof HTMLElement)) {
        return;
    }

    const target = parseSecureDonorTargetFromElement(button);
    if (!target) {
        showMessage('Invalid donor match selected.', 'warning');
        return;
    }

    pendingSecureDonorTarget = target;
    prefillBloodRequestFormForSecureTarget(target);
    openModal('requestModal');
    showMessage(
        `Request form prefilled for ${target.donorName}. Submit to create a private request and secure call link.`,
        'info'
    );
}

async function loadPersistentNotifications() {
    const container = document.getElementById('persistentNotificationFeed');
    if (!container || !currentUser?.id) {
        return;
    }

    try {
        const response = await fetch(`/api/alerts/notifications/${currentUser.id}?limit=25`, {
            headers: {
                'x-actor-user-id': String(currentUser.id)
            }
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            persistentNotifications = [];
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to load server notifications.')}</div>`;
            renderNotificationCenter();
            return;
        }

        persistentNotifications = Array.isArray(result.notifications)
            ? result.notifications
            : [];

        if (persistentNotifications.length === 0) {
            container.innerHTML = '<div class="loading">No server notifications available.</div>';
            renderNotificationCenter();
            return;
        }

        container.innerHTML = persistentNotifications.map(item => `
            <div class="notification-item ${escapeHtml(item.type || 'info')} ${item.is_read ? 'is-read' : ''}">
                <div class="notification-meta">
                    <strong>${escapeHtml((item.type || 'info').toUpperCase())}</strong>
                    <span>${escapeHtml(new Date(item.created_at).toLocaleString())}</span>
                </div>
                <p>${escapeHtml(item.message || '')}</p>
                ${item.is_read
        ? ''
        : `<div class="notification-actions"><button type="button" class="mark-read-btn" data-mark-read-id="${escapeHtml(item.id)}">Mark Read</button></div>`}
            </div>
        `).join('');
        renderNotificationCenter();
    } catch (error) {
        console.error('Load persistent notifications error:', error);
        persistentNotifications = [];
        renderNotificationCenter();
        container.innerHTML = '<div class="loading">Failed to load server notifications right now.</div>';
    }
}

async function markServerNotificationAsRead(notificationId) {
    try {
        const response = await fetch(`/api/alerts/notifications/${notificationId}/read`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                actor_user_id: currentUser.id
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to mark notification as read', 'error');
            return;
        }

        await loadPersistentNotifications();
    } catch (error) {
        console.error('Mark notification as read error:', error);
        showMessage('Unable to mark notification as read right now.', 'error');
    }
}

async function loadPendingVerificationRequests() {
    const container = document.getElementById('pendingVerificationList');
    if (!container) {
        return;
    }

    if (!isVerifiedAuthorityClient(currentUser)) {
        container.innerHTML = '<div class="loading">Login as a verified authority to review pending emergencies.</div>';
        return;
    }

    try {
        const response = await fetch(`/api/blood-requests/pending-verification?actor_user_id=${encodeURIComponent(currentUser.id)}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to load pending verifications.')}</div>`;
            return;
        }

        if (!Array.isArray(result.requests) || result.requests.length === 0) {
            container.innerHTML = '<div class="loading">No pending emergency requests right now.</div>';
            return;
        }

        container.innerHTML = result.requests.map(request => `
            <div class="authority-item">
                <h5>#${escapeHtml(request.id)} · ${escapeHtml(request.patient_name || 'Unknown Patient')}</h5>
                <p><strong>Blood:</strong> ${escapeHtml(request.blood_group)} · <strong>Units:</strong> ${escapeHtml(request.units_required)}</p>
                <p><strong>Urgency:</strong> ${escapeHtml(request.urgency_level)} · <strong>Hospital:</strong> ${escapeHtml(request.hospital_name || 'Not specified')}</p>
                <p><strong>Requester:</strong> ${escapeHtml(request.requester_name || 'Unknown')}</p>
                <div class="action-row">
                    <button type="button" class="btn-inline success" data-verify-request-id="${escapeHtml(request.id)}">Verify & Broadcast</button>
                    <button type="button" class="btn-inline warning" data-reject-request-id="${escapeHtml(request.id)}">Reject</button>
                    <button type="button" class="btn-inline info" data-call-link-request-id="${escapeHtml(request.id)}">Generate Call Link</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load pending verification requests error:', error);
        container.innerHTML = '<div class="loading">Failed to load pending verification requests.</div>';
    }
}

async function handleVerifyBroadcastAction(requestId, approve) {
    if (!isVerifiedAuthorityClient(currentUser)) {
        showMessage('Only verified authority accounts can verify or reject requests.', 'warning');
        return;
    }

    const notesPrompt = approve
        ? 'Optional verification notes:'
        : 'Reason for rejection (optional):';
    const verificationNotes = window.prompt(notesPrompt, '') || '';

    try {
        const response = await fetch(`/api/blood-requests/${requestId}/verify-broadcast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                actor_user_id: currentUser.id,
                approve,
                verification_notes: verificationNotes
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to update request verification', 'error');
            return;
        }

        if (approve) {
            showMessage(`Request verified and broadcast complete (${result.alerts_sent || 0} alerts sent).`, 'success');
        } else {
            showMessage('Request rejected successfully.', 'warning');
        }

        await Promise.all([loadPendingVerificationRequests(), loadRecentRequests(), loadStatistics()]);
    } catch (error) {
        console.error('Verify-broadcast action error:', error);
        showMessage('Failed to update verification state right now.', 'error');
    }
}

async function generateCallLinkForRequest(requestId, options = {}) {
    const notifyUserId = parsePositiveInt(options.notifyUserId);
    const suppressSuccessToast = Boolean(options.suppressSuccessToast);
    const successMessage = typeof options.successMessage === 'string' ? options.successMessage : 'Private call link generated.';
    const callLinkResult = document.getElementById('callLinkResult');
    if (!callLinkResult) {
        return {
            success: false,
            message: 'Call link panel is unavailable'
        };
    }

    try {
        const payload = {
            actor_user_id: currentUser.id
        };
        if (notifyUserId) {
            payload.notify_user_id = notifyUserId;
        }

        const response = await fetch(`/api/blood-requests/${requestId}/call-link`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            callLinkResult.textContent = result.message || 'Failed to generate call link';
            showMessage(result.message || 'Failed to generate call link', 'error');
            return {
                success: false,
                message: result.message || 'Failed to generate call link'
            };
        }

        callLinkResult.innerHTML = `Request #${escapeHtml(result.request_id)} call link: <a href="${escapeHtml(result.call_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.call_url)}</a>`;
        if (!suppressSuccessToast) {
            showMessage(successMessage, 'success');
        }
        return {
            success: true,
            result
        };
    } catch (error) {
        console.error('Generate call link error:', error);
        callLinkResult.textContent = 'Failed to generate call link right now.';
        showMessage('Failed to generate call link right now.', 'error');
        return {
            success: false,
            message: 'Failed to generate call link right now.'
        };
    }
}

async function handleGenerateCallLink(event) {
    event.preventDefault();
    const requestIdInput = document.getElementById('callLinkRequestId');
    const requestId = parsePositiveInt(requestIdInput?.value);
    if (!requestId) {
        showMessage('Enter a valid request ID to generate call link.', 'warning');
        return;
    }

    await generateCallLinkForRequest(requestId);
}

async function handleCompleteDonationByQr(event) {
    event.preventDefault();
    if (!isVerifiedAuthorityClient(currentUser)) {
        showMessage('Only verified authority accounts can complete donations by token.', 'warning');
        return;
    }

    const tokenInput = document.getElementById('verificationQrToken');
    const notesInput = document.getElementById('verificationCompletionNotes');
    const resultNode = document.getElementById('qrCompletionResult');
    const token = tokenInput ? tokenInput.value.trim() : '';

    if (!token) {
        showMessage('Please paste a verification QR token.', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/donations/complete-by-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                verification_qr_token: token,
                actor_user_id: currentUser.id,
                notes: notesInput ? notesInput.value.trim() : ''
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            if (resultNode) {
                resultNode.textContent = result.message || 'Failed to complete donation.';
            }
            showMessage(result.message || 'Failed to complete donation by token.', 'error');
            return;
        }

        if (resultNode) {
            resultNode.textContent = `Donation #${result.donation_id} completed via ${result.completion_method}.`;
        }
        if (tokenInput) {
            tokenInput.value = '';
        }
        if (notesInput) {
            notesInput.value = '';
        }

        showMessage('Donation verified and completed successfully.', 'success');
        await Promise.all([loadStatistics(), loadRecentDonations(), loadSuperheroes(), loadScopedInventory()]);
    } catch (error) {
        console.error('Complete donation by QR error:', error);
        showMessage('Unable to complete donation by token right now.', 'error');
    }
}

async function loadScopedInventory() {
    const container = document.getElementById('scopedInventoryList');
    if (!container) {
        return;
    }

    if (!isVerifiedAuthorityClient(currentUser)) {
        container.innerHTML = '<div class="loading">Only verified authority accounts can manage scoped inventory.</div>';
        return;
    }

    const query = buildScopedInventoryQueryString();
    if (query === null) {
        container.innerHTML = '<div class="loading">Inventory scope is not configured for this account.</div>';
        return;
    }

    try {
        const response = await fetch(`/api/inventory/all${query ? `?${query}` : ''}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Unable to load inventory scope.')}</div>`;
            return;
        }

        if (!Array.isArray(result.inventory) || result.inventory.length === 0) {
            container.innerHTML = '<div class="loading">No inventory rows found for this scope.</div>';
            return;
        }

        container.innerHTML = result.inventory.map(item => `
            <div class="inventory-item">
                <h4>${escapeHtml(item.blood_group)}</h4>
                <p><strong>Available:</strong> ${escapeHtml(item.available_units)} units</p>
                <p><strong>Reserved:</strong> ${escapeHtml(item.reserved_units)} units</p>
                <p><strong>Updated:</strong> ${escapeHtml(new Date(item.last_updated).toLocaleString())}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load scoped inventory error:', error);
        container.innerHTML = '<div class="loading">Failed to load scoped inventory right now.</div>';
    }
}

async function handleScopedInventoryUpdate(event) {
    event.preventDefault();
    const bloodGroup = document.getElementById('inventoryBloodGroup')?.value || '';
    const availableUnits = Number.parseInt(document.getElementById('inventoryAvailableUnits')?.value, 10);
    const reservedUnits = Number.parseInt(document.getElementById('inventoryReservedUnits')?.value, 10);
    const lowStockThreshold = Number.parseInt(document.getElementById('inventoryLowStockThreshold')?.value, 10);

    if (!bloodGroup || !Number.isInteger(availableUnits) || availableUnits < 0 || !Number.isInteger(reservedUnits) || reservedUnits < 0) {
        showMessage('Provide valid blood group, available units, and reserved units.', 'warning');
        return;
    }

    const payload = buildScopedInventoryPayload({
        blood_group: bloodGroup,
        available_units: availableUnits,
        reserved_units: reservedUnits,
        low_stock_threshold: Number.isInteger(lowStockThreshold) && lowStockThreshold >= 0
            ? lowStockThreshold
            : 10
    });
    if (!payload) {
        return;
    }

    try {
        const response = await fetch('/api/inventory/update', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to update inventory scope.', 'error');
            return;
        }

        const alertText = result.passive_alerts_sent
            ? ` Passive alerts sent: ${result.passive_alerts_sent}.`
            : '';
        showMessage(`Inventory updated successfully.${alertText}`, 'success');
        await Promise.all([loadScopedInventory(), loadPersistentNotifications()]);
    } catch (error) {
        console.error('Scoped inventory update error:', error);
        showMessage('Failed to update scoped inventory.', 'error');
    }
}

async function handleScopedInventoryOperation(event) {
    event.preventDefault();
    const operation = document.getElementById('inventoryOperation')?.value || 'add';
    const bloodGroup = document.getElementById('inventoryOperationBloodGroup')?.value || '';
    const units = Number.parseInt(document.getElementById('inventoryOperationUnits')?.value, 10);

    if (!bloodGroup) {
        showMessage('Select a blood group for inventory operation.', 'warning');
        return;
    }

    if (operation !== 'initialize' && (!Number.isInteger(units) || units <= 0)) {
        showMessage('Units must be a positive integer.', 'warning');
        return;
    }

    const payloadBase = operation === 'initialize'
        ? {
            blood_group: bloodGroup,
            available_units: Number.isInteger(units) && units >= 0 ? units : 0,
            reserved_units: 0
        }
        : {
            blood_group: bloodGroup,
            units
        };
    const payload = buildScopedInventoryPayload(payloadBase);
    if (!payload) {
        return;
    }

    const endpointMap = {
        add: '/api/inventory/add',
        reserve: '/api/inventory/reserve',
        release: '/api/inventory/release',
        initialize: '/api/inventory/initialize'
    };
    const endpoint = endpointMap[operation] || '/api/inventory/add';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Inventory operation failed.', 'error');
            return;
        }

        showMessage(result.message || 'Inventory operation completed.', 'success');
        await loadScopedInventory();
    } catch (error) {
        console.error('Scoped inventory operation error:', error);
        showMessage('Inventory operation failed right now.', 'error');
    }
}

function getAdminApiKey() {
    const node = document.getElementById('adminApiKeyInput');
    return node ? node.value.trim() : '';
}

async function loadPendingAuthoritiesForApproval() {
    const container = document.getElementById('pendingAuthoritiesList');
    if (!container) {
        return;
    }

    const adminKey = getAdminApiKey();
    if (!adminKey) {
        container.innerHTML = '<div class="loading">Enter ADMIN_API_KEY to load pending authority accounts.</div>';
        showMessage('Enter ADMIN_API_KEY first.', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/auth/authorities/pending', {
            headers: {
                'x-admin-key': adminKey
            }
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            container.innerHTML = `<div class="loading">${escapeHtml(result.message || 'Failed to load pending authorities.')}</div>`;
            return;
        }

        if (!Array.isArray(result.pending_authorities) || result.pending_authorities.length === 0) {
            container.innerHTML = '<div class="loading">No pending authority approvals right now.</div>';
            return;
        }

        container.innerHTML = result.pending_authorities.map(item => `
            <div class="authority-item">
                <h5>${escapeHtml(item.name)} (#${escapeHtml(item.id)})</h5>
                <p><strong>Role:</strong> ${escapeHtml(roleToLabel(item.role))}</p>
                <p><strong>Email:</strong> ${escapeHtml(item.email)}</p>
                <p><strong>License:</strong> ${escapeHtml(item.license_number || 'Not provided')}</p>
                <div class="action-row">
                    <button type="button" class="btn-inline success" data-authority-approve-id="${escapeHtml(item.id)}">Approve</button>
                    <button type="button" class="btn-inline warning" data-authority-reject-id="${escapeHtml(item.id)}">Keep Unverified</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load pending authorities error:', error);
        container.innerHTML = '<div class="loading">Failed to load pending authorities right now.</div>';
    }
}

async function setAuthorityApprovalStatus(authorityId, isVerified) {
    const adminKey = getAdminApiKey();
    if (!adminKey) {
        showMessage('ADMIN_API_KEY is required for authority approval.', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/auth/authorities/${authorityId}/verify`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': adminKey
            },
            body: JSON.stringify({
                is_verified: isVerified
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to update authority verification.', 'error');
            return;
        }

        showMessage(result.message || 'Authority verification updated.', 'success');
        await loadPendingAuthoritiesForApproval();
    } catch (error) {
        console.error('Set authority approval status error:', error);
        showMessage('Failed to update authority status right now.', 'error');
    }
}

async function handleSaveProfileControls(event) {
    event.preventDefault();
    if (!currentUser?.id) {
        showMessage('Please login again to update profile controls.', 'warning');
        return;
    }

    const snoozeDaysNode = document.getElementById('alertSnoozeDays');
    const donorToggle = document.getElementById('isDonorActive');
    const snoozeDays = Number.parseInt(snoozeDaysNode?.value || '0', 10);
    const alertSnoozeUntil = Number.isInteger(snoozeDays) && snoozeDays > 0
        ? new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    try {
        const response = await fetch(`/api/auth/profile/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                actor_user_id: currentUser.id,
                is_donor: donorToggle ? donorToggle.checked : true,
                alert_snooze_until: alertSnoozeUntil
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to save profile controls.', 'error');
            return;
        }

        currentUser = normalizeUserId({
            ...currentUser,
            is_donor: donorToggle ? donorToggle.checked : currentUser.is_donor,
            alert_snooze_until: alertSnoozeUntil
        });
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        renderUserProfile(currentUser);
        configureRoleBasedSections();
        if (alertSnoozeUntil) {
            stopEmergencyAlerts();
            const alertsContainer = document.getElementById('liveAlerts');
            if (alertsContainer) {
                alertsContainer.innerHTML = '<div class="loading">Emergency alerts are snoozed for your profile.</div>';
            }
        } else {
            startEmergencyAlerts();
        }
        showMessage('Profile controls updated successfully.', 'success');
    } catch (error) {
        console.error('Save profile controls error:', error);
        showMessage('Failed to save profile controls right now.', 'error');
    }
}

async function handleDeleteProfile() {
    if (!currentUser?.id) {
        return;
    }

    const confirmed = window.confirm('This will delete your profile from active use. Continue?');
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/api/auth/profile/${currentUser.id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                actor_user_id: currentUser.id
            })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            showMessage(result.message || 'Failed to delete profile.', 'error');
            return;
        }

        showMessage('Profile deleted successfully. Logging out...', 'success');
        setTimeout(() => logout(), 1000);
    } catch (error) {
        console.error('Delete profile error:', error);
        showMessage('Unable to delete profile right now.', 'error');
    }
}

async function loadUserProfile() {
    try {
        if (!currentUser || !currentUser.id) {
            return false;
        }

        const response = await fetch(`/api/auth/profile/${currentUser.id}?actor_user_id=${encodeURIComponent(currentUser.id)}`);
        let result = null;
        try {
            result = await response.json();
        } catch (error) {
            result = { success: false, message: 'Unexpected response from profile API' };
        }

        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
            showMessage('Session expired. Please login again.', 'warning');
            setTimeout(() => logout(), 1200);
            return false;
        }

        if (!response.ok || !result.success) {
            return false;
        }

        currentUser = normalizeUserId({ ...currentUser, ...result.user });
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        renderUserProfile(currentUser);
        configureRoleBasedSections();

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
            body: JSON.stringify({
                actor_user_id: currentUser.id,
                latitude,
                longitude
            })
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

        const donorsResponse = await fetch(`/api/auth/users?actor_user_id=${encodeURIComponent(currentUser.id)}`);
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
                    <p><strong>Verification:</strong> ${request.verification_status || 'Not Required'}</p>
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
            const latestDonationWithPass = result.donations.find(donation => donation.verification_qr_token);
            setDonationPassPanel(latestDonationWithPass
                ? {
                    verification_qr_token: latestDonationWithPass.verification_qr_token,
                    expires_at: latestDonationWithPass.verification_qr_expires_at || null
                }
                : null);
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
            setDonationPassPanel(null);
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
                <h4>${escapeHtml(donor.name)}</h4>
                <p><strong>Blood Group:</strong> ${escapeHtml(donor.blood_group)}</p>
                <p><strong>Distance:</strong> ${escapeHtml(donor.distance_km)} km</p>
                <p><strong>Location:</strong> ${escapeHtml(donor.city || donor.location || donor.state || 'Not specified')}</p>
                <p><strong>Contact:</strong> Hidden for privacy. Use request + verified call flow.</p>
                <div class="action-row">
                    <button
                        type="button"
                        class="btn-inline info"
                        data-secure-connect-donor-id="${escapeHtml(donor.id)}"
                        data-secure-connect-donor-name="${escapeHtml(donor.name || 'Nearby donor')}"
                        data-secure-connect-blood-group="${escapeHtml(donor.blood_group || '')}"
                        data-secure-connect-location="${escapeHtml(donor.city || donor.location || donor.state || 'your area')}">
                        Request & Secure Connect
                    </button>
                </div>
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
                <p><strong>Contact:</strong> Hidden for privacy. Use dashboard emergency workflow.</p>
                <div class="action-row">
                    <button
                        type="button"
                        class="btn-inline info"
                        data-secure-connect-donor-id="${escapeHtml(donor.id)}"
                        data-secure-connect-donor-name="${escapeHtml(donor.name || 'Nearby donor')}"
                        data-secure-connect-blood-group="${escapeHtml(donor.blood_group || '')}"
                        data-secure-connect-location="${escapeHtml(donor.city || donor.location || donor.state || 'your area')}">
                        Request & Secure Connect
                    </button>
                </div>
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
                <h4>${escapeHtml(receiver.patient_name)} (Request #${escapeHtml(receiver.id)})</h4>
                <p><strong>Blood Group:</strong> ${escapeHtml(receiver.blood_group)} | <strong>Units:</strong> ${escapeHtml(receiver.units_required)}</p>
                <p><strong>Urgency:</strong> ${escapeHtml(receiver.urgency_level)}</p>
                <p><strong>Hospital:</strong> ${escapeHtml(receiver.hospital_name || 'Not specified')}</p>
                <p><strong>Location:</strong> ${escapeHtml(receiver.requester_city || receiver.requester_location || receiver.requester_state || receiver.hospital_address || 'Not specified')}</p>
                <p><strong>Contact:</strong> Private. Authorities can generate secure call link.</p>
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
    const requisitionImageUrl = String(formData.get('requisitionImageUrl') || '').trim();
    const needsVerification = urgencyLevel === 'High' || urgencyLevel === 'Emergency';
    if (needsVerification && !requisitionImageUrl) {
        showMessage('Doctor requisition image URL is required for High or Emergency requests.', 'warning');
        return;
    }

    const requestData = {
        requester_id: currentUser.id,
        patient_name: formData.get('patientName'),
        blood_group: formData.get('bloodGroup'),
        units_required: Number.parseInt(formData.get('unitsRequired'), 10),
        hospital_name: formData.get('hospitalName'),
        urgency_level: urgencyLevel,
        reason: formData.get('reason'),
        required_date: formData.get('requiredDate'),
        requisition_image_url: requisitionImageUrl || null,
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
            const requestId = parsePositiveInt(result.request_id);
            const secureTarget = pendingSecureDonorTarget;
            let secureMessageShown = false;
            if (requestId && secureTarget?.donorId) {
                const secureConnectResult = await generateCallLinkForRequest(requestId, {
                    notifyUserId: secureTarget.donorId,
                    suppressSuccessToast: true
                });
                if (secureConnectResult.success) {
                    secureMessageShown = true;
                    showMessage(
                        `Blood request submitted and secure call link shared with ${secureTarget.donorName}.`,
                        'success'
                    );
                }
            }
            pendingSecureDonorTarget = null;
            const alertSuffix = result.alerts_sent ? ` (${result.alerts_sent} donors notified)` : '';
            const verificationText = result.verification_required
                ? ' Request queued for authority verification.'
                : '';
            if (!secureMessageShown) {
                showMessage(`Blood request created successfully${alertSuffix}.${verificationText}`.trim(), 'success');
            }
            closeModal('requestModal');
            e.target.reset();
            updateRequestVerificationHint();
            await Promise.all([loadRecentRequests(), loadStatistics()]);
            if (isVerifiedAuthorityClient(currentUser)) {
                await loadPendingVerificationRequests();
            }
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
    const requestId = parsePositiveInt(formData.get('requestId'));
    const donationData = {
        donor_id: currentUser.id,
        request_id: requestId || null,
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
            if (result.donation_pass && result.donation_pass.verification_qr_token) {
                setDonationPassPanel(result.donation_pass);
            }
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
    if (isVerifiedAuthorityClient(currentUser)) {
        await loadScopedInventory();
        const inventorySection = document.getElementById('inventoryManagementSection');
        if (inventorySection) {
            inventorySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }

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
        if (modalId === 'requestModal') {
            pendingSecureDonorTarget = null;
        }
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
