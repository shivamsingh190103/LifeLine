document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const tokenInput = document.getElementById('token');
    const submitBtn = document.getElementById('submitBtn');

    if (!form || !tokenInput || !submitBtn) {
        return;
    }

    const token = readTokenFromUrl();
    tokenInput.value = token;

    if (!token) {
        showMessage('Reset token is missing from URL.', 'error');
        submitBtn.disabled = true;
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const formData = new FormData(form);
        const newPassword = String(formData.get('newPassword') || '');
        const confirmPassword = String(formData.get('confirmPassword') || '');

        if (newPassword.length < 8) {
            showMessage('Password must be at least 8 characters long.', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showMessage('Password and confirm password do not match.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting...';

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token,
                    new_password: newPassword
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showMessage(result.message || 'Password reset successful.', 'success');
                form.reset();
                setTimeout(() => {
                    window.location.href = '/login';
                }, 1800);
            } else {
                showMessage(result.message || 'Failed to reset password.', 'error');
            }
        } catch (error) {
            console.error('Reset password error:', error);
            showMessage('Network error. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reset Password';
        }
    });
});

function readTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token') || '';

    if (!token && window.location.hash) {
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hash);
        token = hashParams.get('token') || '';
    }

    return String(token).trim().replace(/\s+/g, '');
}

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
