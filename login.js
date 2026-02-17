// Login functionality
const LATEST_LOCATION_KEY = 'latestUserLocation';

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) {
        return;
    }

    captureLatestLocation().catch(() => {
        // Location capture on login page is best effort.
    });

    // Check if user is already logged in
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
        // Redirect to dashboard if already logged in
        window.location.href = '/dashboard';
        return;
    }

    const queryParams = new URLSearchParams(window.location.search);
    const verificationState = queryParams.get('verified');
    if (verificationState === '1') {
        showMessage('Email verified successfully. You can login now.', 'success');
    } else if (verificationState === 'failed') {
        showMessage('Email verification link is invalid or expired. Request a new verification email.', 'warning');
    }

    const resendVerificationBtn = document.getElementById('resendVerificationBtn');
    if (resendVerificationBtn) {
        resendVerificationBtn.addEventListener('click', async () => {
            const emailInput = loginForm.querySelector('input[name="email"]');
            const email = emailInput ? String(emailInput.value || '').trim() : '';
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showMessage('Enter your email first to resend verification link', 'warning');
                return;
            }

            try {
                resendVerificationBtn.disabled = true;
                const response = await fetch('/api/auth/resend-verification', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email })
                });

                const result = await response.json();
                if (!response.ok || !result.success) {
                    showMessage(result.message || 'Failed to resend verification email', 'error');
                    return;
                }

                showMessage(result.message || 'Verification link sent', 'success');
            } catch (error) {
                console.error('Resend verification error:', error);
                showMessage('Network error. Please try again.', 'error');
            } finally {
                resendVerificationBtn.disabled = false;
            }
        });
    }

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(loginForm);
        const loginData = {
            email: formData.get('email'),
            password: formData.get('password')
        };

        // Validate required fields
        if (!loginData.email || !loginData.password) {
            showMessage('Please fill in all required fields', 'error');
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(loginData.email)) {
            showMessage('Please enter a valid email address', 'error');
            return;
        }

        try {
            const submitButton = loginForm.querySelector('.btn-login');

            // Show loading state
            if (submitButton) {
                submitButton.innerHTML = '<span class="loading"></span> Logging in...';
                submitButton.disabled = true;
            }

            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(loginData)
            });

            let result = null;
            try {
                result = await response.json();
            } catch (parseError) {
                result = { success: false, message: 'Unexpected server response' };
            }

            if (response.ok && result.success) {
                showMessage('Login successful! Redirecting to dashboard...', 'success');

                const mergedUser = await syncLocationAfterLogin(result.user);

                // Store user data in localStorage
                localStorage.setItem('currentUser', JSON.stringify(mergedUser));
                
                // Redirect to dashboard after 2 seconds
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 2000);
            } else {
                showMessage(result.message || 'Login failed', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            showMessage('Network error. Please try again.', 'error');
        } finally {
            // Reset button state
            const submitButton = loginForm.querySelector('.btn-login');
            if (submitButton) {
                submitButton.innerHTML = '<span>Login</span><i class="fas fa-sign-in-alt"></i>';
                submitButton.disabled = false;
            }
        }
    });
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

    // Add to page
    document.body.appendChild(messageDiv);

    // Remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}

function getStoredLocation() {
    try {
        const raw = localStorage.getItem(LATEST_LOCATION_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        const latitude = Number.parseFloat(parsed.latitude);
        const longitude = Number.parseFloat(parsed.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }
        return { latitude, longitude };
    } catch (error) {
        return null;
    }
}

async function captureLatestLocation() {
    if (!navigator.geolocation) {
        return getStoredLocation();
    }

    const coords = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            position => resolve({
                latitude: Number.parseFloat(position.coords.latitude.toFixed(7)),
                longitude: Number.parseFloat(position.coords.longitude.toFixed(7))
            }),
            reject,
            {
                enableHighAccuracy: false,
                timeout: 6000,
                maximumAge: 0
            }
        );
    });

    localStorage.setItem(LATEST_LOCATION_KEY, JSON.stringify(coords));
    return coords;
}

async function syncLocationAfterLogin(user) {
    if (!user || !user.id) {
        return user;
    }

    let coords = null;
    try {
        coords = await captureLatestLocation();
    } catch (error) {
        coords = getStoredLocation();
    }

    if (!coords) {
        return user;
    }

    try {
        const response = await fetch(`/api/auth/profile/${user.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(coords)
        });

        if (!response.ok) {
            return {
                ...user,
                latitude: coords.latitude,
                longitude: coords.longitude
            };
        }

        return {
            ...user,
            latitude: coords.latitude,
            longitude: coords.longitude
        };
    } catch (error) {
        return {
            ...user,
            latitude: coords.latitude,
            longitude: coords.longitude
        };
    }
}

// Auto-fill email if available from registration
document.addEventListener('DOMContentLoaded', function() {
    const registeredUser = localStorage.getItem('registeredUser');
    if (registeredUser) {
        const user = JSON.parse(registeredUser);
        const emailInput = document.querySelector('input[name="email"]');
        if (emailInput) {
            emailInput.value = user.email;
            // Remove the stored data after auto-filling
            localStorage.removeItem('registeredUser');
        }
    }
});
