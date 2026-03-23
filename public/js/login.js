const form = document.getElementById('login-form');
const errorBox = document.getElementById('error-message');
const loginBtn = document.getElementById('login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  // Clear previous error
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || 'Login failed.');
      return;
    }

    // Save user info in sessionStorage so other pages know who is logged in
    sessionStorage.setItem('user', JSON.stringify(data));

    // Redirect based on role
    if (data.role === 'admin') {
      window.location.href = '/dashboard.html';
    } else {
      window.location.href = '/rate.html';
    }

  } catch (err) {
    showError('Could not connect to the server.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log in';
  }
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}
