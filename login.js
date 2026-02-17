// Login functionality
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) {
        return;
    }

    // Check if user is already logged in
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
        // Redirect to dashboard if already logged in
        window.location.href = '/dashboard';
        return;
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
                
                // Store user data in localStorage
                localStorage.setItem('currentUser', JSON.stringify(result.user));
                
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
