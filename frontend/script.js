// ============================================================
// OppVerse – script.js  (Discover + Saved)
// ============================================================
// All config (URL, keys, table name) lives in supabaseClient.js
// ============================================================

import {
  supabase,
  DB_TABLE,
  GEMINI_ENDPOINT,
  GEMINI_KEY_STORE,
  GEMINI_API_KEY,
  EDGE_FUNCTION_URL
} from './supabaseClient.js';

// ── STATE ──────────────────────────────────────────────────
let allOpportunities   = [];
let filteredData       = [];
let activeCategory     = 'All';
let savedIds           = JSON.parse(localStorage.getItem('oppverse_saved') || '[]');

// Global opportunity map — used by onclick handlers on cards
window._oppMap = {};

// ── DOM ────────────────────────────────────────────────────
const cardsGrid        = document.getElementById('cards-grid');
const savedGrid        = document.getElementById('saved-grid');
const loadingState     = document.getElementById('loading-state');
const loadingMsg       = document.getElementById('loading-msg');
const emptyState       = document.getElementById('empty-state');
const savedEmpty       = document.getElementById('saved-empty');
const resultsCount     = document.getElementById('results-count');
const searchInput      = document.getElementById('search-input');
const locationSelect   = document.getElementById('location-select');
const savedBadge       = document.getElementById('saved-badge');

// ══════════════════════════════════════════════════════════
// SECTION SWITCHER
// ══════════════════════════════════════════════════════════
window.showSection = function(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  if (sec) sec.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const map = { discover: 'nav-discover', saved: 'nav-saved', contact: 'nav-contact' };
  if (map[name]) document.getElementById(map[name])?.classList.add('active');
  if (name === 'saved') renderSaved();
};

// ══════════════════════════════════════════════════════════
// MOBILE MENU
// ══════════════════════════════════════════════════════════
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('mobile-menu').classList.toggle('open');
});
window.closeMobileMenu = () => document.getElementById('mobile-menu').classList.remove('open');

// ══════════════════════════════════════════════════════════
// GEMINI KEY MANAGEMENT
function getGeminiKey() {
  // Always prefer the hardcoded key from config; fall back to localStorage
  return GEMINI_API_KEY || localStorage.getItem(GEMINI_KEY_STORE) || '';
}
// These are no-ops now but kept so any stray HTML onclick attrs don't crash
window.saveGeminiKey = function() {};
function openKeyModal()  {}
function closeKeyModal() {}

// ══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════
// PURGE EXPIRED OPPORTUNITIES FROM SUPABASE
// ══════════════════════════════════════════════════════════
async function purgeExpired() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  try {
    const { data: expired, error } = await supabase
      .from(DB_TABLE)
      .select('id, title, deadline')
      .lt('deadline', today);  // deadline < today

    if (error || !expired || expired.length === 0) return;

    const ids = expired.map(o => o.id);
    const { error: delErr } = await supabase
      .from(DB_TABLE)
      .delete()
      .in('id', ids);

    if (!delErr) {
      console.log(`Auto-deleted ${ids.length} expired opportunity(ies).`);
      showToast(`🗑 Removed ${ids.length} expired opportunit${ids.length > 1 ? 'ies' : 'y'}`, 'success');
    }
  } catch (e) {
    console.warn('purgeExpired error:', e);
  }
}

// Helper: strip expired items from a local array
function filterActive(arr) {
  const today = new Date().toISOString().split('T')[0];
  return arr.filter(o => !o.deadline || o.deadline >= today);
}

// ══════════════════════════════════════════════════════════
// FETCH FROM SUPABASE  →  GEMINI  →  SAMPLE DATA FALLBACK
// ══════════════════════════════════════════════════════════
async function fetchOpportunities() {
  setLoading(true, 'Fetching from database…');

  // 0. Auto-purge expired rows silently in background
  purgeExpired();

  // 1. Try Supabase — fetch all rows, filter expired client-side
  // (avoids SQL text comparison bugs with non-ISO deadline values)
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data, error } = await supabase
      .from(DB_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      allOpportunities = data;
      applyFilters();
      setLoading(false);
      showToast(`Loaded ${data.length} active opportunities`, 'success');
      localStorage.setItem('oppverse-cache', JSON.stringify(data));
      return;
    }
  } catch (dbErr) {
    console.warn('Supabase fetch failed:', dbErr);
  }

  // 2. DB empty or error → try Gemini
  setLoading(true, 'Database empty — fetching with Gemini AI…');
  const geminiOk = await fetchAndSync();
  if (geminiOk) return;

  // 3. Try localStorage cache (filter expired locally)
  const cached = localStorage.getItem('oppverse-cache');
  if (cached) {
    try {
      const active = filterActive(JSON.parse(cached));
      if (active.length > 0) {
        allOpportunities = active;
        applyFilters();
        setLoading(false);
        showToast('Loaded from local cache', 'success');
        return;
      }
    } catch(_) {}
  }

  // 4. Nothing available — show clean empty state
  setLoading(false);
  allOpportunities = [];
  applyFilters();
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// AI SYNC (VIA BACKEND EDGE FUNCTION)
// ══════════════════════════════════════════════════════════

window.fetchAndSync = async function() {
  setLoading(true, 'Syncing real data from Supabase backend…');
  try {
    const { data, error } = await supabase.functions.invoke('sync-opportunities', {
      method: 'POST',
    });

    if (error || data?.error) {
      throw new Error(error?.message || data?.error || 'Edge function invocation failed');
    }

    // After edge function finishes, reload from DB
    const today = new Date().toISOString().split('T')[0];
    const { data: newData } = await supabase
      .from(DB_TABLE)
      .select('*')
      .or(`deadline.gte.${today},deadline.is.null`)
      .order('deadline', { ascending: true, nullsFirst: false });

    if (newData && newData.length > 0) {
      allOpportunities = newData;
      applyFilters();
      setLoading(false);
      showToast(`AI synced ${newData.length} fresh opportunities`, 'success');
      localStorage.setItem('oppverse-cache', JSON.stringify(newData));
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Backend sync failed:', err.message);
    setLoading(false);
    return false;
  }
};

// Removed legacy local scraping fallbacks.



// ══════════════════════════════════════════════════════════
// FILTER + RENDER
// ══════════════════════════════════════════════════════════
function applyFilters() {
  const kw  = (searchInput.value || '').toLowerCase().trim();
  const loc = locationSelect.value;

  const nowISO = new Date().toISOString();
  filteredData = allOpportunities.filter(o => {
    // hide broken links
    if (!o.link || !o.link.startsWith('http')) return false;
    // null deadline = no known deadline → always show
    if (o.deadline && o.deadline !== 'Check Website' && o.deadline < nowISO) return false;
    const matchCat = activeCategory === 'All' || o.category === activeCategory;
    const matchLoc = !loc || (o.location || '').toLowerCase().includes(loc.toLowerCase());
    const matchKw  = !kw ||
      (o.title || '').toLowerCase().includes(kw) ||
      (o.organization || '').toLowerCase().includes(kw) ||
      (o.skills || '').toLowerCase().includes(kw) ||
      (o.category || '').toLowerCase().includes(kw);
    return matchCat && matchLoc && matchKw;
  });

  renderCards();
}

function renderCards() {
  cardsGrid.innerHTML = '';
  const count = filteredData.length;
  resultsCount.innerHTML = `Showing <strong>${count}</strong> opportunit${count !== 1 ? 'ies' : 'y'}`;

  if (count === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    filteredData.forEach((o, i) => {
      const card = buildCard(o, i);
      cardsGrid.appendChild(card);
    });
    lucide.createIcons();
  }
}

function buildCard(o, i) {
  const isSaved  = savedIds.includes(o.id || o.link);
  const catClass = catCSSClass(o.category);
  const urgency  = deadlineUrgency(o.deadline);
  const isBroken = !o.link || !o.link.startsWith('http');

  // Store in global map so it can be retrieved by ID later
  const mapKey = `opp_${i}_${Date.now()}`;
  window._oppMap[mapKey] = o;

  const div = document.createElement('div');
  div.className = 'opp-card';
  div.style.animationDelay = `${i * 0.04}s`;
  div.innerHTML = `
    <div class="card-top">
      <span class="card-cat-badge ${catClass}">${o.category || 'Other'}</span>
      ${isBroken ? `<span class="badge" style="background:var(--danger);position:relative;top:0;right:0;padding:4px 8px;">Unavailable</span>` : ''}
      <button class="card-bookmark ${isSaved ? 'saved' : ''}" data-id="${escHtml(o.id || o.link)}" title="${isSaved ? 'Unsave' : 'Save'}">
        <i data-lucide="${isSaved ? 'bookmark-check' : 'bookmark'}"></i>
      </button>
    </div>
    <div class="card-title">${escHtml(o.title)}</div>
    <div class="card-org"><i data-lucide="building-2"></i>${escHtml(o.organization || 'Various Organizations')}</div>
    <div class="card-meta">
      <span class="card-meta-item"><i data-lucide="map-pin"></i>${escHtml(o.location || 'India')}</span>
      <span class="card-meta-item"><i data-lucide="monitor"></i>${escHtml(o.mode || '—')}</span>
    </div>
    <div class="card-footer">
      <span class="card-deadline ${urgency.cls}"><i data-lucide="clock"></i>${urgency.label}</span>
      <button class="btn btn-primary btn-sm view-details-btn" data-view-key="${mapKey}">View Details</button>
    </div>`;

  div.querySelector('.card-bookmark').addEventListener('click', e => {
    e.stopPropagation();
    toggleSave(o);
    const btn = e.currentTarget;
    const now = savedIds.includes(o.id || o.link);
    btn.classList.toggle('saved', now);
    btn.innerHTML = `<i data-lucide="${now ? 'bookmark-check' : 'bookmark'}"></i>`;
    lucide.createIcons();
  });
  return div;
}

// Event Delegation for "View Details" to avoid missing listeners
cardsGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-details-btn');
  if (!btn) return;
  const key = btn.getAttribute('data-view-key');
  if (key && window._oppMap[key]) {
    openModal(window._oppMap[key]);
  }
});
savedGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-details-btn');
  if (!btn) return;
  const key = btn.getAttribute('data-view-key');
  if (key && window._oppMap[key]) {
    openModal(window._oppMap[key]);
  }
});

// ══════════════════════════════════════════════════════════
// SAVED
// ══════════════════════════════════════════════════════════
function toggleSave(o) {
  const key = o.id || o.link;
  const idx = savedIds.indexOf(key);
  if (idx === -1) {
    savedIds.push(key);
    // store full object
    const store = JSON.parse(localStorage.getItem('oppverse_saved_objs') || '[]');
    store.push(o);
    localStorage.setItem('oppverse_saved_objs', JSON.stringify(store));
    showToast('Saved!', 'success');
  } else {
    savedIds.splice(idx, 1);
    const store = JSON.parse(localStorage.getItem('oppverse_saved_objs') || '[]');
    const updated = store.filter(x => (x.id || x.link) !== key);
    localStorage.setItem('oppverse_saved_objs', JSON.stringify(updated));
    showToast('Removed from saved');
  }
  localStorage.setItem('oppverse_saved', JSON.stringify(savedIds));
  updateBadge();
}

function renderSaved() {
  savedGrid.innerHTML = '';
  const store = JSON.parse(localStorage.getItem('oppverse_saved_objs') || '[]');
  if (store.length === 0) {
    savedEmpty.classList.remove('hidden');
  } else {
    savedEmpty.classList.add('hidden');
    store.forEach((o, i) => savedGrid.appendChild(buildCard(o, i)));
    lucide.createIcons();
  }
}

window.clearAllSaved = function() {
  savedIds = [];
  localStorage.setItem('oppverse_saved', '[]');
  localStorage.setItem('oppverse_saved_objs', '[]');
  updateBadge();
  renderSaved();
  showToast('Cleared all saved');
};

function updateBadge() {
  if (savedBadge) {
    savedBadge.textContent = savedIds.length || '';
    savedBadge.dataset.n = savedIds.length;
  }
}

// ══════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════
window.openModal = function(o) {
  const catClass = catCSSClass(o.category);
  document.getElementById('modal-category').className = `modal-category-badge ${catClass}`;
  document.getElementById('modal-category').textContent = o.category || 'Other';
  document.getElementById('modal-title').textContent    = o.title || '—';
  document.getElementById('modal-org').innerHTML        = `<i data-lucide="building-2"></i>${escHtml(o.organization || '—')}`;
  const isBroken = !o.link || !o.link.startsWith('http');
  document.getElementById('modal-apply-link').outerHTML = isBroken 
    ? `<button id="modal-apply-link" class="btn" style="background:var(--bg-elevated);color:var(--text-muted);cursor:not-allowed;" disabled>Unavailable</button>`
    : `<a id="modal-apply-link" href="${o.link || '#'}" target="_blank" class="btn btn-primary">Apply Now</a>`;

  const fields = [
    ['Deadline',         o.deadline && o.deadline !== 'Check Website' ? new Date(o.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'Check Website'],
    ['Mode',             o.mode        || '—'],
    ['Location',         o.location    || '—'],
    ['Full Address',     o.venue       || o.location || '—'],
    ['Registration Fee', o.reg_fee     || 'Free'],
    ['Skills',           o.skills      || 'Check Website'],
    ['Team Size',        o.team_size   || 'Check Website'],
    ['Eligibility',      o.eligibility || 'Check Website'],
  ];

  document.getElementById('modal-body').innerHTML = `
    <div class="detail-grid">
      ${fields.map(([label, val]) => {
        let displayVal = escHtml(String(val));
        if ((label === 'Location' || label === 'Full Address') && val && val !== '—' && val.toLowerCase() !== 'online') {
          displayVal = `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(val)}" target="_blank" style="color:var(--accent-primary);text-decoration:underline;display:inline-flex;align-items:center;gap:4px;">${displayVal} <i data-lucide="map-pin" style="width:12px;height:12px;"></i></a>`;
        }
        return `
        <div class="detail-item">
          <span class="detail-label">${label}</span>
          <span class="detail-value">${displayVal}</span>
        </div>`;
      }).join('')}
    </div>`;

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('details-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
  lucide.createIcons();
};

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('details-modal').classList.add('hidden');
  document.body.style.overflow = ''; // Restore background scrolling
};

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function setLoading(on, msg = '') {
  loadingState.classList.toggle('hidden', !on);
  emptyState.classList.add('hidden');
  if (on && msg) loadingMsg.textContent = msg;
}
function showError(msg) {
  emptyState.classList.remove('hidden');
  emptyState.querySelector('h3').textContent = 'Something went wrong';
  emptyState.querySelector('p').textContent  = msg;
}
function catCSSClass(cat) {
  const map = { Hackathon:'cat-hackathon', Internship:'cat-internship', Event:'cat-event', Workshop:'cat-workshop', Sports:'cat-sports' };
  return map[cat] || 'cat-other';
}
function deadlineUrgency(dl) {
  if (!dl) return { label: 'Check Website', cls: '' };
  const diff = Math.ceil((new Date(dl) - Date.now()) / 86400000);
  if (diff < 0)  return { label: 'Expired',         cls: 'urgent' };
  if (diff <= 7) return { label: `${diff}d left`,   cls: 'urgent' };
  return { label: new Date(dl).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }), cls: '' };
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
window.resetFilters = function() {
  activeCategory = 'All';
  searchInput.value = '';
  locationSelect.value = '';
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.cat === 'All'));
  applyFilters();
};

// ══════════════════════════════════════════════════════════
// CONTACT FORM
// ══════════════════════════════════════════════════════════
window.sendContactMessage = function(e) {
  e.preventDefault();
  const name  = document.getElementById('c-name').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const msg   = document.getElementById('c-msg').value.trim();
  const btn   = document.getElementById('c-submit');

  // Compose mailto link as fallback (no backend needed)
  const subject = encodeURIComponent(`OppVerse Support: Message from ${name}`);
  const body    = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${msg}`);
  const mailto  = `mailto:support@oppverse.com?subject=${subject}&body=${body}`;

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="check-circle"></i> Message Sent!';
  lucide.createIcons();

  // Open mail client
  window.location.href = mailto;

  showToast('Opening your mail client…', 'success');
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send"></i> Send Message';
    lucide.createIcons();
    document.getElementById('contact-form').reset();
  }, 3000);
};

// ══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════
document.getElementById('category-pills').addEventListener('click', e => {
  const btn = e.target.closest('.pill[data-cat]');
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  document.querySelectorAll('.pill[data-cat]').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
});

document.getElementById('search-btn').addEventListener('click', () => {
  if (allOpportunities.length === 0) { fetchAndSync(); return; }
  applyFilters();
});
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('search-btn').click(); });
document.getElementById('clear-search').addEventListener('click', () => { searchInput.value = ''; applyFilters(); });
locationSelect.addEventListener('change', () => { if (allOpportunities.length > 0) applyFilters(); });
document.getElementById('refresh-btn').addEventListener('click', fetchAndSync);

document.getElementById('near-me-btn')?.addEventListener('click', () => {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  showToast('Detecting location…');
  navigator.geolocation.getCurrentPosition(
    () => { showToast('Showing nearby results'); applyFilters(); },
    () => showToast('Location access denied', 'error')
  );
});

// Keyboard: Escape closes modal
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeKeyModal(); } });

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  updateBadge();
  // Load from cache immediately while fetching
  const cached = localStorage.getItem('oppverse-cache');
  if (cached) {
    allOpportunities = JSON.parse(cached);
    applyFilters();
  }
  fetchOpportunities();
});
