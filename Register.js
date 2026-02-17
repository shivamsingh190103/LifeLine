// Registration form handling
document.addEventListener('DOMContentLoaded', function() {
    const registrationForm = document.getElementById('registrationForm');
    const passwordInput = document.getElementById('password_data');
    const safetyDiv = document.querySelector('.safety');
    if (!registrationForm || !passwordInput || !safetyDiv) {
        return;
    }

    addBloodGroupSelection();
    addLocationFields();
    ensureCoordinateFields(registrationForm);
    captureUserCoordinates(registrationForm);

    // Password strength indicator
    passwordInput.addEventListener('input', function() {
        const password = this.value;
        let strength = 0;
        let message = '';

        if (password.length >= 8) strength++;
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^A-Za-z0-9]/.test(password)) strength++;

        switch (strength) {
            case 0:
            case 1:
                message = 'Very Weak';
                safetyDiv.style.color = '#ff4444';
                break;
            case 2:
                message = 'Weak';
                safetyDiv.style.color = '#ff8800';
                break;
            case 3:
                message = 'Medium';
                safetyDiv.style.color = '#ffaa00';
                break;
            case 4:
                message = 'Strong';
                safetyDiv.style.color = '#00aa00';
                break;
            case 5:
                message = 'Very Strong';
                safetyDiv.style.color = '#008800';
                break;
        }

        safetyDiv.textContent = message;
    });

    // Form submission
    registrationForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(registrationForm);
        const userData = {
            name: formData.get('name'),
            email: formData.get('email'),
            password: formData.get('password'),
            phone: formData.get('phone') || '',
            blood_group: formData.get('blood_group') || 'O+',
            location: formData.get('location') || '',
            city: formData.get('city') || '',
            state: formData.get('state') || '',
            latitude: formData.get('latitude') || null,
            longitude: formData.get('longitude') || null
        };

        // Validate required fields
        if (!userData.name || !userData.email || !userData.password) {
            showMessage('Please fill in all required fields', 'error');
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            showMessage('Please enter a valid email address', 'error');
            return;
        }

        // Validate password strength
        if (passwordInput.value.length < 8) {
            showMessage('Password must be at least 8 characters long', 'error');
            return;
        }

        try {
            showMessage('Creating account...', 'info');

            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData)
            });

            const result = await response.json();

            if (result.success) {
                showMessage('Account created successfully! Redirecting to login...', 'success');
                
                // Store user data in localStorage for login
                localStorage.setItem('registeredUser', JSON.stringify({
                    email: userData.email,
                    name: userData.name
                }));

                // Redirect to login page after 2 seconds
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else {
                showMessage(result.message || 'Registration failed', 'error');
            }
        } catch (error) {
            console.error('Registration error:', error);
            showMessage('Network error. Please try again.', 'error');
        }
    });

    // Skip button functionality
    const skipButton = document.querySelector('.btn:not(.primary)');
    if (skipButton) {
        skipButton.addEventListener('click', function(e) {
            e.preventDefault();
            window.location.href = '/';
        });
    }
});

// Message display function
function showMessage(message, type = 'info') {
    // Remove existing message
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }

    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;

    // Style the message
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        font-weight: bold;
        z-index: 1000;
        max-width: 300px;
        word-wrap: break-word;
    `;

    // Set background color based on type
    switch (type) {
        case 'success':
            messageDiv.style.backgroundColor = '#4CAF50';
            break;
        case 'error':
            messageDiv.style.backgroundColor = '#f44336';
            break;
        case 'warning':
            messageDiv.style.backgroundColor = '#ff9800';
            break;
        default:
            messageDiv.style.backgroundColor = '#2196F3';
    }

    // Add to page
    document.body.appendChild(messageDiv);

    // Remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}

// Add blood group selection to the form
function addBloodGroupSelection() {
    const form = document.querySelector('form');
    if (!form || form.querySelector('select[name="blood_group"]')) {
        return;
    }

    const passwordField = form.querySelector('input[type="password"]');
    if (!passwordField) {
        return;
    }
    
    // Create blood group select element
    const bloodGroupDiv = document.createElement('div');
    bloodGroupDiv.style.cssText = `
        position: relative;
        margin-bottom: 20px;
    `;

    const bloodGroupIcon = document.createElement('i');
    bloodGroupIcon.className = 'fas fa-tint';
    bloodGroupIcon.style.cssText = `
        position: absolute;
        left: 15px;
        top: 50%;
        transform: translateY(-50%);
        color: #666;
        z-index: 1;
    `;

    const bloodGroupSelect = document.createElement('select');
    bloodGroupSelect.name = 'blood_group';
    bloodGroupSelect.style.cssText = `
        width: 100%;
        padding: 15px 15px 15px 45px;
        border: 1px solid #ddd;
        border-radius: 5px;
        font-size: 16px;
        background-color: white;
        outline: none;
    `;

    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    bloodGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = group;
        bloodGroupSelect.appendChild(option);
    });

    bloodGroupDiv.appendChild(bloodGroupIcon);
    bloodGroupDiv.appendChild(bloodGroupSelect);

    // Insert before password field
    passwordField.parentNode.insertBefore(bloodGroupDiv, passwordField);
}

// Add location fields to the form
function addLocationFields() {
    const form = document.querySelector('form');
    if (!form || form.querySelector('input[name="location"]')) {
        return;
    }

    const bloodGroupSelect = form.querySelector('select[name="blood_group"]');
    if (!bloodGroupSelect) {
        return;
    }

    const bloodGroupDiv = bloodGroupSelect.parentNode;
    
    // Create location fields
    const locationDiv = document.createElement('div');
    locationDiv.style.cssText = `
        margin-bottom: 20px;
    `;

    const locationInput = document.createElement('input');
    locationInput.type = 'text';
    locationInput.name = 'location';
    locationInput.placeholder = 'Address';
    locationInput.style.cssText = `
        width: 100%;
        padding: 15px 15px 15px 45px;
        border: 1px solid #ddd;
        border-radius: 5px;
        font-size: 16px;
        margin-bottom: 10px;
        outline: none;
    `;

    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.name = 'city';
    cityInput.placeholder = 'City';
    cityInput.style.cssText = `
        width: 48%;
        padding: 15px;
        border: 1px solid #ddd;
        border-radius: 5px;
        font-size: 16px;
        margin-right: 2%;
        outline: none;
    `;

    const stateInput = document.createElement('input');
    stateInput.type = 'text';
    stateInput.name = 'state';
    stateInput.placeholder = 'State';
    stateInput.style.cssText = `
        width: 48%;
        padding: 15px;
        border: 1px solid #ddd;
        border-radius: 5px;
        font-size: 16px;
        outline: none;
    `;

    const cityStateDiv = document.createElement('div');
    cityStateDiv.appendChild(cityInput);
    cityStateDiv.appendChild(stateInput);

    locationDiv.appendChild(locationInput);
    locationDiv.appendChild(cityStateDiv);

    // Insert after blood group
    bloodGroupDiv.parentNode.insertBefore(locationDiv, bloodGroupDiv.nextSibling);
}

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
        },
        () => {
            // Geolocation permission is optional; registration works without it.
        },
        {
            enableHighAccuracy: false,
            timeout: 7000,
            maximumAge: 60000
        }
    );
}
