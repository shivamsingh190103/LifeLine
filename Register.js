document.addEventListener('DOMContentLoaded', () => {
    const registrationForm = document.getElementById('registrationForm');
    const passwordInput = document.getElementById('password_data');
    const safetyDiv = document.querySelector('.safety');
    const skipButton = document.getElementById('skipRegistrationBtn');
    const phoneInput = document.querySelector('input[name="phone"]');
    const roleSelect = document.getElementById('roleType');
    const authorityFields = document.getElementById('authorityFields');
    const licenseInput = document.getElementById('licenseNumber');
    const facilityInput = document.getElementById('facilityId');

    if (!registrationForm || !passwordInput || !safetyDiv) {
        return;
    }

    ensureCoordinateFields(registrationForm);
    captureUserCoordinates(registrationForm);

    if (phoneInput) {
        phoneInput.addEventListener('input', () => {
            phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10);
        });
    }

    const syncAuthorityFields = () => {
        const role = roleSelect ? String(roleSelect.value || 'user') : 'user';
        const isAuthorityRole = role === 'hospital' || role === 'blood_bank' || role === 'doctor';

        if (authorityFields) {
            authorityFields.hidden = !isAuthorityRole;
        }

        if (licenseInput) {
            licenseInput.required = isAuthorityRole;
        }

        if (facilityInput) {
            if (role === 'doctor') {
                facilityInput.disabled = false;
                facilityInput.placeholder = 'Facility ID (required for doctor inventory scope)';
            } else {
                facilityInput.value = '';
                facilityInput.disabled = true;
                facilityInput.placeholder = 'Facility ID (for doctor only, optional)';
            }
        }
    };

    if (roleSelect) {
        roleSelect.addEventListener('change', syncAuthorityFields);
        syncAuthorityFields();
    }

    passwordInput.addEventListener('input', () => {
        const password = passwordInput.value;
        let strength = 0;

        if (password.length >= 8) strength += 1;
        if (/[a-z]/.test(password)) strength += 1;
        if (/[A-Z]/.test(password)) strength += 1;
        if (/[0-9]/.test(password)) strength += 1;
        if (/[^A-Za-z0-9]/.test(password)) strength += 1;

        if (strength <= 1) {
            safetyDiv.textContent = 'Very Weak';
            safetyDiv.style.color = '#d93838';
            return;
        }
        if (strength === 2) {
            safetyDiv.textContent = 'Weak';
            safetyDiv.style.color = '#ef7f1a';
            return;
        }
        if (strength === 3) {
            safetyDiv.textContent = 'Medium';
            safetyDiv.style.color = '#d6a312';
            return;
        }
        if (strength === 4) {
            safetyDiv.textContent = 'Strong';
            safetyDiv.style.color = '#2d9b45';
            return;
        }

        safetyDiv.textContent = 'Very Strong';
        safetyDiv.style.color = '#13853c';
    });

    registrationForm.addEventListener('submit', async event => {
        event.preventDefault();

        const formData = new FormData(registrationForm);
        const phoneDigits = String(formData.get('phone') || '').replace(/\D/g, '');
        const role = String(formData.get('role') || 'user').trim();
        const licenseNumber = String(formData.get('license_number') || '').trim();
        const facilityIdRaw = String(formData.get('facility_id') || '').trim();
        const isAuthorityRole = role === 'hospital' || role === 'blood_bank' || role === 'doctor';
        const facilityId = facilityIdRaw ? Number.parseInt(facilityIdRaw, 10) : null;
        const isDonorByRole = role === 'user' || role === 'doctor';
        const userData = {
            name: String(formData.get('name') || '').trim(),
            email: String(formData.get('email') || '').trim(),
            password: String(formData.get('password') || ''),
            blood_group: String(formData.get('blood_group') || '').trim(),
            phone: phoneDigits,
            location: String(formData.get('location') || '').trim(),
            city: String(formData.get('city') || '').trim(),
            state: String(formData.get('state') || '').trim(),
            latitude: formData.get('latitude') || null,
            longitude: formData.get('longitude') || null,
            role,
            license_number: isAuthorityRole ? licenseNumber : null,
            facility_id: role === 'doctor' && Number.isInteger(facilityId) && facilityId > 0 ? facilityId : null,
            is_donor: isDonorByRole
        };

        if (!userData.name || !userData.email || !userData.password || !userData.blood_group || !userData.phone || !userData.location || !userData.city || !userData.state) {
            showMessage('Please fill all required fields', 'error');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            showMessage('Please enter a valid email address', 'error');
            return;
        }

        if (userData.phone.length !== 10) {
            showMessage('Phone number must be exactly 10 digits', 'error');
            return;
        }

        if (userData.password.length < 8) {
            showMessage('Password must be at least 8 characters long', 'error');
            return;
        }

        if (isAuthorityRole && !licenseNumber) {
            showMessage('License number is required for hospital, blood bank, and doctor accounts', 'error');
            return;
        }

        if (role === 'doctor' && (!Number.isInteger(facilityId) || facilityId <= 0)) {
            showMessage('Doctor account requires a valid facility ID', 'error');
            return;
        }

        try {
            showMessage('Creating account...', 'info');

            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                showMessage(result.message || 'Registration failed', 'error');
                return;
            }

            const successMessage = result.authority_verification_pending
                ? 'Authority account created. Verify email, then wait for admin approval before login.'
                : (result.requires_verification
                    ? 'Account created. Please verify your email, then login.'
                    : 'Account created successfully! Redirecting to login...');
            showMessage(successMessage, 'success');

            localStorage.setItem('registeredUser', JSON.stringify({
                email: userData.email,
                name: userData.name
            }));

            setTimeout(() => {
                window.location.href = '/login';
            }, 1800);
        } catch (error) {
            console.error('Registration error:', error);
            showMessage('Network error. Please try again.', 'error');
        }
    });

    if (skipButton) {
        skipButton.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
});

const LATEST_LOCATION_KEY = 'latestUserLocation';

function ensureCoordinateFields(form) {
    if (!form.querySelector('input[name="latitude"]')) {
        const latitudeInput = document.createElement('input');
        latitudeInput.type = 'hidden';
        latitudeInput.name = 'latitude';
        form.appendChild(latitudeInput);
    }

    if (!form.querySelector('input[name="longitude"]')) {
        const longitudeInput = document.createElement('input');
        longitudeInput.type = 'hidden';
        longitudeInput.name = 'longitude';
        form.appendChild(longitudeInput);
    }
}

function captureUserCoordinates(form) {
    if (!navigator.geolocation) {
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            const latitudeField = form.querySelector('input[name="latitude"]');
            const longitudeField = form.querySelector('input[name="longitude"]');

            if (latitudeField) {
                latitudeField.value = position.coords.latitude.toFixed(7);
            }
            if (longitudeField) {
                longitudeField.value = position.coords.longitude.toFixed(7);
            }

            localStorage.setItem(LATEST_LOCATION_KEY, JSON.stringify({
                latitude: Number.parseFloat(position.coords.latitude.toFixed(7)),
                longitude: Number.parseFloat(position.coords.longitude.toFixed(7))
            }));
        },
        () => {
            // Registration still works if location access is denied.
        },
        {
            enableHighAccuracy: false,
            timeout: 7000,
            maximumAge: 0
        }
    );
}

function showMessage(message, type = 'info') {
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 10px;
        color: #fff;
        font-weight: 700;
        z-index: 1000;
        max-width: 340px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
    `;

    switch (type) {
        case 'success':
            messageDiv.style.backgroundColor = '#2f9e44';
            break;
        case 'error':
            messageDiv.style.backgroundColor = '#e03131';
            break;
        case 'warning':
            messageDiv.style.backgroundColor = '#f08c00';
            break;
        default:
            messageDiv.style.backgroundColor = '#1c7ed6';
    }

    document.body.appendChild(messageDiv);

    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}
