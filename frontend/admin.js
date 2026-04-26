// ============================================================
// OppVerse – admin.js  (Production Ready)
// ============================================================

import {
  supabase,
  DB_TABLE,
  GEMINI_ENDPOINT,
  GEMINI_API_KEY,
} from './supabaseClient.js';

// ── DOM refs ───────────────────────────────────────────────
const adminTbody = document.getElementById('admin-tbody');
const syncLog    = document.getElementById('sync-log');

// ══════════════════════════════════════════════════════════
// SIDEBAR TOGGLE (mobile)
// ══════════════════════════════════════════════════════════
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('dashboard-sidebar')?.classList.toggle('sidebar-hidden');
});

// ══════════════════════════════════════════════════════════
// ADMIN VIEW SWITCHER
// ══════════════════════════════════════════════════════════
let currentSidebarCategory = 'All';

window.switchView = function(name, el, category = null) {
  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  if (view) view.classList.add('active');

  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  if (el) el.classList.add('active');

  if (category !== null) currentSidebarCategory = category;

  const titleMap = {
    overview:      'Dashboard Overview',
    opportunities: currentSidebarCategory === 'All' ? 'All Opportunities' : `${currentSidebarCategory}s`,
    users:         'Registered Users',
    create:        'Add Manual Entry'
  };
  const pageTitle = document.getElementById('page-title');
  if (pageTitle && titleMap[name]) pageTitle.textContent = titleMap[name];

  if (name === 'opportunities') {
    if (adminTableData.length === 0) loadTable();
    else applyAdminFilters();
  }
  if (name === 'users') loadUsers();
};

// ══════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════
async function loadStats() {
  try {
    const { data, error } = await supabase.from(DB_TABLE).select('category');
    if (error) throw error;

    document.getElementById('stat-total').textContent     = data.length;
    document.getElementById('stat-hackathon').textContent  = data.filter(d => d.category === 'Hackathon').length;
    document.getElementById('stat-internship').textContent = data.filter(d => d.category === 'Internship').length;
    document.getElementById('stat-event').textContent      = data.filter(d => d.category === 'Event').length;
    document.getElementById('stat-workshop').textContent   = data.filter(d => d.category === 'Workshop').length;
  } catch (err) {
    const cached = localStorage.getItem('oppverse-cache');
    if (cached) {
      const data = JSON.parse(cached);
      document.getElementById('stat-total').textContent = data.length;
    }
    console.warn('Stats fetch failed:', err);
  }

  // Load user count from auth (admin only — uses service role approach)
  loadUserCount();
}

async function loadUserCount() {
  try {
    // We can count via a public profiles table or just use stored users
    // Fallback: count local registered emails from localStorage pattern
    // For real auth users, we use Supabase admin API — not available from client
    // We'll show what we can from the profiles (or skip gracefully)
    const el = document.getElementById('stat-users');
    if (el) el.textContent = '—';
  } catch(_) {}
}

// ══════════════════════════════════════════════════════════
// OPPORTUNITIES TABLE
// ══════════════════════════════════════════════════════════
let adminTableData = [];

function applyAdminFilters() {
  const searchStr = (document.getElementById('admin-search')?.value || '').toLowerCase();

  let filtered = adminTableData.filter(o => o.link?.startsWith('http'));

  if (currentSidebarCategory !== 'All') {
    filtered = filtered.filter(o => o.category === currentSidebarCategory);
  }

  if (searchStr) {
    filtered = filtered.filter(o =>
      (o.title || '').toLowerCase().includes(searchStr) ||
      (o.organization || '').toLowerCase().includes(searchStr) ||
      (o.location || '').toLowerCase().includes(searchStr)
    );
  }

  const countEl = document.getElementById('admin-results-count');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${adminTableData.length} total`;

  renderTable(filtered);
}

async function loadTable() {
  if (!adminTbody) return;
  adminTbody.innerHTML = `<tr><td colspan="7" class="table-empty">Loading…</td></tr>`;
  try {
    const { data, error } = await supabase
      .from(DB_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    adminTableData = data || [];
    applyAdminFilters();
  } catch (err) {
    const cached = localStorage.getItem('oppverse-cache');
    if (cached) {
      adminTableData = JSON.parse(cached);
      applyAdminFilters();
    } else {
      adminTbody.innerHTML = `<tr><td colspan="7" class="table-empty">Could not load data. Check your connection.</td></tr>`;
    }
  }
}

function renderTable(rows) {
  if (!rows.length) {
    adminTbody.innerHTML = `<tr><td colspan="7" class="table-empty">No opportunities found. Run a Sync!</td></tr>`;
    return;
  }
  adminTbody.innerHTML = rows.map(o => {
    const dl = o.deadline
      ? new Date(o.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
      : 'Check Website';
    const org = o.organization || '<span style="color:var(--text-muted);font-style:italic">—</span>';
    return `
    <tr>
      <td style="color:var(--text-primary);font-weight:600;max-width:240px" title="${escHtml(o.title)}">${escHtml(o.title)}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${org}</td>
      <td><span class="card-cat-badge ${catClass(o.category)}" style="font-size:11px">${o.category || '—'}</span></td>
      <td>${escHtml(o.location || 'India')}</td>
      <td>${escHtml(dl)}</td>
      <td>${o.mode || '—'}</td>
      <td>
        <div class="table-actions">
          <a href="${escHtml(o.link || '#')}" target="_blank" rel="noopener noreferrer" class="table-btn view" title="Open link">
            <i data-lucide="external-link"></i>
          </a>
          <button class="table-btn del" title="Delete" onclick="confirmDelete('${escHtml(o.id)}','${escHtml((o.title||'').replace(/'/g,''))}')">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
// USERS TABLE
// ══════════════════════════════════════════════════════════
let allUsersData = [];

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading users…</td></tr>`;

  try {
    // Try to query a 'profiles' table if it exists, otherwise use auth metadata
    // Since we can't call admin.listUsers() from the browser (service role needed),
    // we create a "profiles" table approach — but fall back gracefully

    // Attempt 1: profiles table (if it exists)
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && profiles) {
      allUsersData = profiles;
      renderUsers(profiles);
      const el = document.getElementById('stat-users');
      if (el) el.textContent = profiles.length;
      return;
    }

    // Attempt 2: auth.users via RPC (if a helper function is set up)
    // Fall back to a minimal display with current admin info
    const adminEmail = localStorage.getItem('oppverse_email') || 'admin@oppverse.com';
    const mockUsers = [
      {
        email: adminEmail,
        full_name: 'Administrator',
        role: 'admin',
        created_at: new Date().toISOString(),
        email_confirmed_at: new Date().toISOString()
      }
    ];

    allUsersData = mockUsers;
    renderUsers(mockUsers);

    const el = document.getElementById('stat-users');
    if (el) el.textContent = '1+';

    showToast('⚠ User list requires a profiles table in Supabase. Showing admin only.', 'warn');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Could not load users. A "profiles" table is required.</td></tr>`;
    console.warn('User load failed:', err);
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  const countEl = document.getElementById('users-results-count');
  if (countEl) countEl.textContent = `Total: ${users.length} user(s)`;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((u, i) => {
    const joined    = u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const confirmed = u.email_confirmed_at ? '✓ Confirmed' : 'Pending';
    const role      = u.role || 'student';
    const roleBadge = role === 'admin'
      ? `<span class="card-cat-badge cat-hackathon" style="font-size:11px">Admin</span>`
      : `<span class="card-cat-badge cat-internship" style="font-size:11px">Student</span>`;
    return `
    <tr>
      <td style="color:var(--text-muted);font-size:13px">${i + 1}</td>
      <td style="font-weight:600;color:var(--text-primary)">${escHtml(u.full_name || u.user_metadata?.full_name || '—')}</td>
      <td style="font-size:13px;color:var(--text-secondary)">${escHtml(u.email || '—')}</td>
      <td>${roleBadge}</td>
      <td style="font-size:13px">${joined}</td>
      <td style="font-size:12px;color:var(--success);font-weight:600">${confirmed}</td>
    </tr>`;
  }).join('');
}

// User search
document.getElementById('user-search')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allUsersData.filter(u =>
    (u.email || '').toLowerCase().includes(q) ||
    (u.full_name || '').toLowerCase().includes(q)
  );
  renderUsers(filtered);
});

// ══════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════
let pendingDeleteId = null;
window.confirmDelete = function(id, title) {
  pendingDeleteId = id;
  document.getElementById('del-title').textContent = title;
  document.getElementById('del-overlay').classList.remove('hidden');
  document.getElementById('del-modal').classList.remove('hidden');
};
window.closeDeleteModal = function() {
  pendingDeleteId = null;
  document.getElementById('del-overlay').classList.add('hidden');
  document.getElementById('del-modal').classList.add('hidden');
};
document.getElementById('confirm-del-btn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    const { error } = await supabase.from(DB_TABLE).delete().eq('id', pendingDeleteId);
    if (error) throw error;
    showToast('Deleted successfully', 'success');
    closeDeleteModal();
    loadTable();
    loadStats();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
});

// ══════════════════════════════════════════════════════════
// MANUAL ENTRY
// ══════════════════════════════════════════════════════════
window.submitManualEntry = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  const fb  = document.getElementById('form-feedback');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader"></i> Saving…';
  lucide.createIcons();

  const deadlineVal = document.getElementById('f-deadline').value.trim();

  const entry = {
    title:        document.getElementById('f-title').value.trim(),
    organization: document.getElementById('f-org').value.trim(),
    category:     document.getElementById('f-category').value,
    mode:         document.getElementById('f-mode').value,
    location:     document.getElementById('f-location').value.trim() || 'India',
    deadline:     deadlineVal ? new Date(deadlineVal).toISOString() : null,
    link:         document.getElementById('f-link').value.trim(),
    reg_fee:      document.getElementById('f-reg-fee').value.trim() || 'Free',
    team_size:    document.getElementById('f-team').value.trim() || null,
    eligibility:  document.getElementById('f-eligibility').value.trim() || null,
    skills:       document.getElementById('f-skills').value.trim() || null,
    venue:        document.getElementById('f-venue').value.trim() || null,
  };

  // Basic validation
  if (!entry.title || !entry.organization || !entry.category || !entry.mode || !entry.link) {
    fb.className   = 'form-feedback error';
    fb.textContent = '✗ Please fill in all required fields.';
    fb.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Save Entry';
    lucide.createIcons();
    return;
  }

  try {
    const { error } = await supabase.from(DB_TABLE).upsert([entry], { onConflict: 'link' });
    if (error) throw error;
    fb.className   = 'form-feedback success';
    fb.textContent = '✓ Opportunity saved to database!';
    document.getElementById('create-form').reset();
    showToast('Entry created!', 'success');
    loadStats();
  } catch (err) {
    fb.className   = 'form-feedback error';
    fb.textContent = '✗ Error: ' + err.message;
  } finally {
    fb.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Save Entry';
    lucide.createIcons();
  }
};

// ══════════════════════════════════════════════════════════
// GEMINI / EDGE FUNCTION SYNC
// ══════════════════════════════════════════════════════════
async function runSync() {
  appendLog('🚀 Sync started…', '');
  setSyncBtnState(true);

  try {
    appendLog('📡 Triggering Supabase Edge Function to fetch real data…', '');
    const { data, error } = await supabase.functions.invoke('sync-opportunities', {
      method: 'POST',
    });

    if (error) throw new Error(error.message || 'Edge function invocation failed');
    if (data?.error) throw new Error(data.error);

    if (data?.log && Array.isArray(data.log)) {
      data.log.forEach(l => appendLog(l, l.includes('❌') ? 'error' : (l.includes('⚠') ? 'warn' : 'ok')));
    }

    appendLog(`✅ Sync Complete: ${data?.count || 0} opportunities processed.`, 'ok');
    loadStats();
    loadTable();
    showToast(`Synced ${data?.count || 0} opportunities!`, 'success');
  } catch (err) {
    console.error('Sync failed:', err);
    appendLog(`❌ Error: ${err.message}`, 'error');
    appendLog('⚠️ Using cached database data instead.', 'warn');
    showToast('Sync failed: ' + err.message, 'error');
    loadStats();
    loadTable();
  } finally {
    setSyncBtnState(false);
  }
}

function appendLog(msg, type) {
  const span = document.createElement('span');
  span.className = type ? `log-${type}` : '';
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  syncLog.querySelector('.log-idle')?.remove();
  syncLog.appendChild(span);
  syncLog.scrollTop = syncLog.scrollHeight;
}

function setSyncBtnState(loading) {
  ['sync-btn', 'sync-btn-2'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<i data-lucide="loader"></i> Syncing…'
      : '<i data-lucide="refresh-cw"></i> Initiate Native Sync';
    lucide.createIcons();
  });
}

// ══════════════════════════════════════════════════════════
// PURGE EXPIRED
// ══════════════════════════════════════════════════════════
window.purgeExpired = async function() {
  const btn = document.getElementById('purge-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Purging…'; lucide.createIcons(); }

  const nowISO = new Date().toISOString();
  try {
    const { error, count } = await supabase
      .from(DB_TABLE)
      .delete({ count: 'exact' })
      .lt('deadline', nowISO)
      .not('deadline', 'is', null);

    if (error) throw error;
    const removed = count ?? 0;
    appendLog(`🗑️ Expired Removed: ${removed} opportunit${removed !== 1 ? 'ies' : 'y'}.`, 'ok');
    showToast(`Removed ${removed} expired entries`, 'success');
    loadStats();
    loadTable();
  } catch (err) {
    appendLog(`❌ Purge failed: ${err.message}`, 'error');
    showToast('Purge failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="trash-2"></i> Purge Expired'; lucide.createIcons(); }
  }
};

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function catClass(cat) {
  const m = { Hackathon:'cat-hackathon', Internship:'cat-internship', Event:'cat-event', Workshop:'cat-workshop', Sports:'cat-sports' };
  return m[cat] || 'cat-other';
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadStats();

  document.getElementById('sync-btn')?.addEventListener('click', runSync);
  document.getElementById('sync-btn-2')?.addEventListener('click', runSync);
  document.getElementById('refresh-admin-btn')?.addEventListener('click', () => { loadTable(); loadStats(); });
  document.getElementById('refresh-users-btn')?.addEventListener('click', loadUsers);
  document.getElementById('admin-search')?.addEventListener('input', applyAdminFilters);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { window.closeDeleteModal?.(); }
  });

  // Close sidebar when clicking overlay on mobile
  document.getElementById('del-overlay')?.addEventListener('click', () => window.closeDeleteModal?.());
});
