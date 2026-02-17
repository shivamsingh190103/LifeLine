document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgotPasswordForm');
    const submitBtn = document.getElementById('submitBtn');

    if (!form || !submitBtn) {
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const formData = new FormData(form);
        const email = String(formData.get('email') || '').trim().toLowerCase();

        if (!email) {
            showMessage('Email is required', 'error');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showMessage('Please enter a valid email address', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showMessage(result.message || 'Reset link sent successfully.', 'success');
                form.reset();
            } else {
                showMessage(result.message || 'Failed to send reset link.', 'error');
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            showMessage('Network error. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reset Link';
        }
    });
});

function showMessage(message, type = 'info') {
    const existing = document.querySelector('.message');
    if (existing) {
        existing.remove();
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
