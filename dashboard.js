// Dashboard JavaScript
let currentUser = null;
let alertSource = null;

document.addEventListener('DOMContentLoaded', function() {
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

        currentUser = JSON.parse(userData);
        await loadUserProfile();
        await ensureUserCoordinates();

        await Promise.all([
            loadStatistics(),
            loadRecentRequests(),
            loadRecentDonations(),
            loadNearbyDonors()
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
}

async function loadUserProfile() {
    try {
        const response = await fetch(`/api/auth/profile/${currentUser.id}`);
        const result = await response.json();

        if (!result.success) {
            return;
        }

        currentUser = { ...currentUser, ...result.user };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        document.getElementById('userName').textContent = currentUser.name || 'Unknown';
        document.getElementById('userEmail').textContent = currentUser.email || 'Unknown';
        document.getElementById('userBloodGroup').textContent = currentUser.blood_group || '-';
        document.getElementById('userLocation').textContent = currentUser.location || 'Not specified';
        document.getElementById('userPhone').textContent = currentUser.phone || 'Not specified';
    } catch (error) {
        console.error('Load profile error:', error);
    }
}

async function ensureUserCoordinates() {
    if (currentUser.latitude !== null && currentUser.latitude !== undefined &&
        currentUser.longitude !== null && currentUser.longitude !== undefined) {
        return;
    }

    if (!navigator.geolocation) {
        return;
    }

    const getBrowserLocation = () => new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 6000,
            maximumAge: 60000
        });
    });

    try {
        const position = await getBrowserLocation();
        const latitude = Number.parseFloat(position.coords.latitude.toFixed(7));
        const longitude = Number.parseFloat(position.coords.longitude.toFixed(7));

        await fetch(`/api/auth/profile/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ latitude, longitude })
        });

        currentUser.latitude = latitude;
        currentUser.longitude = longitude;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
    } catch (error) {
        // Location permission is optional for dashboard usage.
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
    try {
        const response = await fetch('/api/donations/all');
        const result = await response.json();
        const container = document.getElementById('recentDonations');

        if (result.success && result.donations && result.donations.length > 0) {
            const recentDonations = result.donations.slice(0, 5);
            container.innerHTML = recentDonations.map(donation => `
                <div class="donation-item">
                    <h4>${donation.donor_name || 'Anonymous Donor'}</h4>
                    <p><strong>Blood Group:</strong> ${donation.blood_group}</p>
                    <p><strong>Units Donated:</strong> ${donation.units_donated}</p>
                    <p><strong>Date:</strong> ${new Date(donation.donation_date).toLocaleDateString()}</p>
                    <p><strong>Center:</strong> ${donation.donation_center || 'Not specified'}</p>
                    <span class="status ${donation.status.toLowerCase()}">${donation.status}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="loading">No donations found</div>';
        }
    } catch (error) {
        console.error('Load donations error:', error);
        document.getElementById('recentDonations').innerHTML = '<div class="loading">No donations found</div>';
    }
}

async function loadNearbyDonors() {
    const container = document.getElementById('nearbyDonors');
    if (!container) {
        return;
    }

    if (!currentUser || currentUser.latitude === null || currentUser.latitude === undefined ||
        currentUser.longitude === null || currentUser.longitude === undefined) {
        container.innerHTML = '<div class="loading">Enable location to find nearby donors.</div>';
        return;
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
            container.innerHTML = '<div class="loading">No eligible nearby donors found.</div>';
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

function startEmergencyAlerts() {
    const alertsContainer = document.getElementById('liveAlerts');
    if (!alertsContainer || !currentUser || !currentUser.id) {
        return;
    }

    if (alertSource) {
        alertSource.close();
    }

    const params = new URLSearchParams({
        userId: currentUser.id,
        radiusKm: '5'
    });

    alertSource = new EventSource(`/api/alerts/stream?${params.toString()}`);

    alertSource.addEventListener('connected', () => {
        alertsContainer.innerHTML = '<div class="loading">Listening for emergencies near you...</div>';
    });

    alertSource.addEventListener('emergency-alert', event => {
        try {
            const payload = JSON.parse(event.data);
            prependEmergencyAlert(payload);
            showMessage(
                `Emergency alert: ${payload.blood_group} needed ${payload.distance_km} km away`,
                'warning'
            );
        } catch (error) {
            console.error('Failed to parse emergency alert payload', error);
        }
    });

    alertSource.onerror = () => {
        // Browser EventSource automatically retries.
    };

    window.addEventListener('beforeunload', () => {
        if (alertSource) {
            alertSource.close();
        }
    }, { once: true });
}

function prependEmergencyAlert(alert) {
    const alertsContainer = document.getElementById('liveAlerts');
    if (!alertsContainer) {
        return;
    }

    if (alertsContainer.querySelector('.loading')) {
        alertsContainer.innerHTML = '';
    }

    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `
        <h4>${alert.patient_name || 'Emergency blood request'}</h4>
        <p><strong>Blood Group:</strong> ${alert.blood_group}</p>
        <p><strong>Urgency:</strong> ${alert.urgency_level || 'Emergency'}</p>
        <p><strong>Distance:</strong> ${alert.distance_km} km</p>
        <p><strong>Hospital:</strong> ${alert.hospital_name || 'Not specified'}</p>
    `;

    alertsContainer.prepend(item);

    const items = alertsContainer.querySelectorAll('.alert-item');
    if (items.length > 8) {
        items[items.length - 1].remove();
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
    if (alertSource) {
        alertSource.close();
        alertSource = null;
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('registeredUser');
    window.location.href = '/login';
}

function showMessage(message, type = 'info') {
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
