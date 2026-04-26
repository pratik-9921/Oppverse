// ============================================================
// OppVerse – auth-check.js
// Route protection + theme init + logout
// ============================================================

// ── Apply theme BEFORE paint (prevents flash) ──
(function() {
  const t = localStorage.getItem('oppverse_theme');
  if (t === 'dark') document.documentElement.classList.add('dark-mode');
})();

// ── Route protection ──
(function() {
  const role = localStorage.getItem('oppverse_role');
  const path = window.location.pathname;

  // If not logged in and not on login page → redirect
  if (!role && !path.includes('login.html')) {
    window.location.replace('login.html');
    return;
  }

  // Users cannot access admin panel
  if (path.includes('admin.html') && role !== 'admin') {
    window.location.replace('index.html');
  }
})();

// ── Logout ──
window.logout = function() {
  // Also sign out from Supabase if possible
  try {
    import('./supabaseClient.js').then(({ supabase }) => {
      supabase.auth.signOut().catch(() => {});
    }).catch(() => {});
  } catch(_) {}

  localStorage.removeItem('oppverse_role');
  localStorage.removeItem('oppverse_email');
  localStorage.removeItem('oppverse_name');
  window.location.href = 'login.html';
};

// ── Theme toggle logic ──
document.addEventListener('DOMContentLoaded', () => {
  // Re-read current state
  const isDark = document.documentElement.classList.contains('dark-mode');
  updateThemeIcons(isDark);

  function toggleTheme(e) {
    if (e) e.preventDefault();
    const dark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('oppverse_theme', dark ? 'dark' : 'light');
    updateThemeIcons(dark);
  }

  function updateThemeIcons(dark) {
    const icon = dark ? 'moon' : 'sun';
    const btns = [
      document.getElementById('theme-toggle'),
      document.getElementById('mobile-theme-toggle')
    ];
    btns.forEach(btn => {
      if (!btn) return;
      const isMobile = btn.id.includes('mobile');
      btn.innerHTML = `<i data-lucide="${icon}"></i>${isMobile ? ' Toggle Theme' : ''}`;
    });
    if (window.lucide) window.lucide.createIcons();
  }

  const themeBtn       = document.getElementById('theme-toggle');
  const mobileThemeBtn = document.getElementById('mobile-theme-toggle');
  if (themeBtn)       themeBtn.addEventListener('click', toggleTheme);
  if (mobileThemeBtn) mobileThemeBtn.addEventListener('click', toggleTheme);

  // ── Show user name in admin header if available ──
  const userNameEl = document.getElementById('admin-user-name');
  if (userNameEl) {
    const name = localStorage.getItem('oppverse_name') || localStorage.getItem('oppverse_email') || 'Admin';
    userNameEl.textContent = name.split('@')[0];
  }
});
