// ============================================================================
// ACSES ELECTION SYSTEM - Frontend Application Logic
// Dual-Gender Course Representation (1 Male Rep + 1 Female Rep per Class)
// Administered by the ACSES Public Relations Officer
// ============================================================================

// Dynamic API Base URL resolution:
// Automatically uses '/api' on localhost, and connects to your Render backend on Firebase
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('api')) {
  try {
    const rawApi = urlParams.get('api').replace(/\/+$/, '');
    localStorage.setItem('acses_backend_url', rawApi);
  } catch (_) {}
}
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const defaultRemoteBackend = 'https://acses-api.onrender.com';
const configuredBackend = window.ACSES_BACKEND_URL || localStorage.getItem('acses_backend_url') || defaultRemoteBackend;
const API_BASE = isLocalhost ? '/api' : (configuredBackend.replace(/\/+$/, '') + '/api');

let authToken = localStorage.getItem('acses_token') || null;
let currentUser = null;
let selectedMaleCandidateId = null;
let selectedFemaleCandidateId = null;
let currentBallotData = null;
let currentElectionStatus = 'closed';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const voterScreen = document.getElementById('voter-screen');
const adminScreen = document.getElementById('admin-screen');
const aspirantScreen = document.getElementById('aspirant-screen');
const authNavItems = document.getElementById('auth-nav-items');
const userNameSpan = document.getElementById('user-name-span');
const electionBadge = document.getElementById('election-status-badge');
const logoutBtn = document.getElementById('logout-btn');
const toastContainer = document.getElementById('toast-container');

// Candidacy & Modal
const applyModal = document.getElementById('apply-modal');
const closeApplyModal = document.getElementById('close-apply-modal');
const cancelApplyModal = document.getElementById('cancel-apply-modal');
const candidateApplyForm = document.getElementById('candidate-apply-form');
const applyPositionInput = document.getElementById('apply-position');

// Voting Dock & Ballot Containers
const maleCandidateListContainer = document.getElementById('male-candidate-list-container');
const femaleCandidateListContainer = document.getElementById('female-candidate-list-container');
const stickyVotingDock = document.getElementById('sticky-voting-dock');
const dockMaleLabel = document.getElementById('dock-male-label');
const dockFemaleLabel = document.getElementById('dock-female-label');
const castVoteBtn = document.getElementById('cast-vote-btn');
const voterAlertBanner = document.getElementById('voter-alert-banner');
const voterAlertText = document.getElementById('voter-alert-text');
const communityLinksContainer = document.getElementById('community-links-container');
const ballotCohortBadge = document.getElementById('ballot-cohort-badge');

// Confirmation Modal
const confirmVoteModal = document.getElementById('confirm-vote-modal');
const closeVoteModal = document.getElementById('close-vote-modal');
const cancelVoteModal = document.getElementById('cancel-vote-modal');
const finalSubmitVoteBtn = document.getElementById('final-submit-vote-btn');
const confirmCandidatesBox = document.getElementById('confirm-candidates-box');

// ---------------------------------------------------------------------------
// Helper: Toast Notifications
// ---------------------------------------------------------------------------
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;

  const iconSvg = type === 'error'
    ? `<svg class="icon icon-sm" style="color: #fca5a5;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`
    : `<svg class="icon icon-sm" style="color: var(--c-aquamarine);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

  toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ---------------------------------------------------------------------------
// Helper: Authenticated Fetch
// ---------------------------------------------------------------------------
async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    handleSignOut();
    throw new Error('Session expired. Please sign in again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Server request failed.');
  }
  return data;
}

// ---------------------------------------------------------------------------
// App Initialization
// ---------------------------------------------------------------------------
async function initApp() {
  setupEventListeners();
  setupAspirantPortal();

  // Check if accessing the dedicated aspirant URL (/apply or ?mode=apply)
  const isApplyRoute = window.location.pathname === '/apply' ||
                       window.location.search.includes('apply') ||
                       window.location.hash.includes('apply');

  if (authToken) {
    try {
      const data = await apiFetch('/auth/me');
      currentUser = data.user;
    } catch (err) {
      authToken = null;
      localStorage.removeItem('acses_token');
    }
  }

  if (isApplyRoute) {
    navigateToAspirantPortal();
  } else if (currentUser) {
    renderAuthenticatedState();
  } else {
    showLoginScreen();

    // If accessing via private /admin or ?admin route, pre-fill administrator credentials
    const isAdminRoute = window.location.pathname === '/admin' ||
                         window.location.search.includes('admin') ||
                         window.location.hash.includes('admin');
    if (isAdminRoute) {
      const refInput = document.getElementById('login-ref');
      const pinInput = document.getElementById('login-pin');
      if (refInput) refInput.value = 'ADMIN001';
      if (pinInput) pinInput.value = '2026';
    }
  }
}

function setupEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Quick Demo Buttons
  document.querySelectorAll('.quick-demo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.getElementById('login-ref').value = e.currentTarget.dataset.ref;
      document.getElementById('login-pin').value = e.currentTarget.dataset.pin;
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
    });
  });

  // Logout
  logoutBtn.addEventListener('click', handleSignOut);

  // Dedicated Aspirant Nomination Portal Navigation
  const openAspirantPortalBtn = document.getElementById('open-aspirant-portal-btn');
  if (openAspirantPortalBtn) {
    openAspirantPortalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/apply');
      navigateToAspirantPortal();
    });
  }

  const voterApplyBtn = document.getElementById('voter-apply-btn');
  if (voterApplyBtn) {
    voterApplyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/apply');
      navigateToAspirantPortal();
    });
  }

  const trackerRefreshBtn = document.getElementById('tracker-refresh-btn');
  if (trackerRefreshBtn) {
    trackerRefreshBtn.addEventListener('click', () => {
      loadProgramTracker();
    });
  }

  // Copy Aspirant Nomination Link (PRO Admin Panel)
  const copyAspirantBtn = document.getElementById('copy-aspirant-link-btn');
  if (copyAspirantBtn) {
    copyAspirantBtn.addEventListener('click', () => {
      const url = window.location.origin + '/apply';
      navigator.clipboard.writeText(url).then(() => {
        showToast('Official Aspirant Nomination link copied to clipboard!');
      }).catch(() => {
        prompt('Copy this Aspirant Nomination URL:', url);
      });
    });
  }

  // Official PDF Class List Download Buttons
  document.querySelectorAll('.download-class-pdf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prog = e.currentTarget.dataset.program;
      const cls = e.currentTarget.dataset.class;
      downloadClassPDF(prog, cls);
    });
  });

  // Candidate Application Modal & Live Interactive Preview
  closeApplyModal.addEventListener('click', () => applyModal.classList.remove('open'));
  cancelApplyModal.addEventListener('click', () => applyModal.classList.remove('open'));
  candidateApplyForm.addEventListener('submit', handleCandidateApplication);

  // Photo Upload & Preset Listeners
  const photoFileInput = document.getElementById('apply-photo-file');
  if (photoFileInput) {
    photoFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          document.getElementById('apply-photo-preview').src = re.target.result;
          document.getElementById('preview-card-img').src = re.target.result;
          document.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('active'));
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const togglePhotoUrlBtn = document.getElementById('toggle-photo-url-btn');
  if (togglePhotoUrlBtn) {
    togglePhotoUrlBtn.addEventListener('click', () => {
      const wrap = document.getElementById('photo-url-wrap');
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    });
  }

  const photoUrlInput = document.getElementById('apply-photo-url');
  if (photoUrlInput) {
    photoUrlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url) {
        document.getElementById('apply-photo-preview').src = url;
        document.getElementById('preview-card-img').src = url;
        document.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('active'));
      }
    });
  }

  const sloganInput = document.getElementById('apply-slogan');
  if (sloganInput) {
    sloganInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      document.getElementById('preview-card-slogan').textContent = val ? `“${val}”` : '“Your campaign slogan will appear here”';
    });
  }

  const manifestoInput = document.getElementById('apply-manifesto');
  if (manifestoInput) {
    manifestoInput.addEventListener('input', (e) => {
      const len = e.target.value.trim().length;
      const counter = document.getElementById('apply-manifesto-counter');
      if (counter) {
        counter.textContent = `${len} / 20 min characters`;
        counter.style.color = len >= 20 ? 'var(--c-forest-green)' : 'var(--c-text-subtle)';
      }
    });
  }

  // Manifesto Reader Modal
  const closeManifestoModal = document.getElementById('close-manifesto-modal');
  const dismissManifestoModal = document.getElementById('dismiss-manifesto-modal');
  const manifestoModal = document.getElementById('manifesto-modal');
  if (closeManifestoModal) closeManifestoModal.addEventListener('click', () => manifestoModal.classList.remove('open'));
  if (dismissManifestoModal) dismissManifestoModal.addEventListener('click', () => manifestoModal.classList.remove('open'));

  // Open Vote Confirmation Modal
  castVoteBtn.addEventListener('click', openVoteConfirmationModal);

  closeVoteModal.addEventListener('click', () => confirmVoteModal.classList.remove('open'));
  cancelVoteModal.addEventListener('click', () => confirmVoteModal.classList.remove('open'));
  finalSubmitVoteBtn.addEventListener('click', handleCastBallot);

  // Admin Navigation Tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');

      e.currentTarget.classList.add('active');
      const targetId = e.currentTarget.dataset.tab;
      document.getElementById(targetId).style.display = 'block';

      if (targetId === 'tab-analytics') loadAdminAnalytics();
      if (targetId === 'tab-candidates') loadAdminCandidates();
      if (targetId === 'tab-roster') loadAdminRoster();
      if (targetId === 'tab-whatsapp') loadAdminWhatsAppLinks();
      if (targetId === 'tab-results') loadAdminResults();
    });
  });

  // Admin Master State Buttons
  document.querySelectorAll('.election-switch-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const status = e.currentTarget.dataset.status;
      try {
        await apiFetch('/admin/election-switch', {
          method: 'POST',
          body: JSON.stringify({ status })
        });
        showToast(`Election state set to: ${status.toUpperCase()}`);
        updateStatusBadge(status);
        loadAdminAnalytics();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Roster Filters
  document.getElementById('roster-prog-filter').addEventListener('change', loadAdminRoster);
  document.getElementById('roster-class-filter').addEventListener('change', loadAdminRoster);
  document.getElementById('roster-search').addEventListener('input', debounce(loadAdminRoster, 300));

  // Audit Log Export Button
  const exportAuditBtn = document.getElementById('export-audit-btn');
  if (exportAuditBtn) {
    exportAuditBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const token = authToken || localStorage.getItem('acses_token');
      if (!token) {
        showToast('Admin session required.', 'error');
        return;
      }
      const a = document.createElement('a');
      a.href = `${API_BASE}/admin/export-audit?token=${encodeURIComponent(token)}`;
      a.download = `ACSES_Election_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
}

// ---------------------------------------------------------------------------
// Authentication Handlers
// ---------------------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const ref = document.getElementById('login-ref').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  const submitBtn = document.getElementById('login-submit-btn');

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      Verifying credentials...
    `;

    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ reference_number: ref, pin })
    });

    authToken = data.token;
    localStorage.setItem('acses_token', authToken);
    currentUser = data.user;

    showToast(`Welcome back, ${currentUser.full_name}`);
    renderAuthenticatedState();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
      Access Voting Portal
    `;
  }
}

function handleSignOut() {
  if (window.trackerInterval) clearInterval(window.trackerInterval);
  authToken = null;
  currentUser = null;
  selectedMaleCandidateId = null;
  selectedFemaleCandidateId = null;
  currentBallotData = null;
  localStorage.removeItem('acses_token');
  showLoginScreen();
  showToast('Signed out successfully.');
}

function showLoginScreen() {
  if (aspirantScreen) aspirantScreen.style.display = 'none';
  if (window.location.pathname === '/apply') {
    history.pushState(null, '', '/');
  }
  loginScreen.style.display = 'block';
  voterScreen.style.display = 'none';
  adminScreen.style.display = 'none';
  authNavItems.style.display = 'none';
}

function renderAuthenticatedState() {
  if (aspirantScreen) aspirantScreen.style.display = 'none';
  loginScreen.style.display = 'none';
  authNavItems.style.display = 'flex';

  if (currentUser.role === 'admin') {
    userNameSpan.textContent = 'Public Relations Officer';
    voterScreen.style.display = 'none';
    adminScreen.style.display = 'block';
    loadAdminDashboard();
  } else {
    userNameSpan.textContent = `${currentUser.full_name.split(' ')[0]} • ${currentUser.class_section}`;
    voterScreen.style.display = 'block';
    adminScreen.style.display = 'none';
    loadVoterDashboard();
    // Regular students NEVER have any application popup on their dashboard!
  }
}

// ---------------------------------------------------------------------------
// Dedicated Aspirant Nomination Portal Logic
// ---------------------------------------------------------------------------
const SVG_ICONS = {
  MALE_REP: `<svg class="icon icon-sm" style="color: var(--c-forest-green);" viewBox="0 0 24 24"><path d="M12 2L9 9l3 13 3-13z"/><path d="M9 2h6l-1 5h-4z"/></svg>`,
  FEMALE_REP: `<svg class="icon icon-sm" style="color: #db2777;" viewBox="0 0 24 24"><path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/></svg>`
};

function navigateToAspirantPortal() {
  if (loginScreen) loginScreen.style.display = 'none';
  if (voterScreen) voterScreen.style.display = 'none';
  if (adminScreen) adminScreen.style.display = 'none';
  if (authNavItems) authNavItems.style.display = currentUser ? 'flex' : 'none';

  if (aspirantScreen) {
    aspirantScreen.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initAspirantScreenState();
  }
}

function initAspirantScreenState() {
  const receiptContainer = document.getElementById('aspirant-receipt-container');
  const formContainer = document.getElementById('aspirant-form-container');
  if (receiptContainer) receiptContainer.style.display = 'none';
  if (formContainer) formContainer.style.display = 'grid';

  const authBox = document.getElementById('aspirant-auth-box');
  const verifiedCard = document.getElementById('aspirant-verified-card');

  const photoPreview = document.getElementById('aspirant-photo-preview');
  const liveCardImg = document.getElementById('aspirant-live-card-img');
  const fileInput = document.getElementById('aspirant-photo-file');
  if (photoPreview && (!fileInput || !fileInput.files || !fileInput.files.length)) {
    photoPreview.src = '/person-avatar.svg';
  }
  if (liveCardImg && (!fileInput || !fileInput.files || !fileInput.files.length)) {
    liveCardImg.src = '/person-avatar.svg';
  }

  if (currentUser && currentUser.role === 'voter') {
    if (authBox) authBox.style.display = 'none';
    if (verifiedCard) {
      verifiedCard.style.display = 'block';
      document.getElementById('aspirant-verified-name').textContent = currentUser.full_name;
      document.getElementById('aspirant-verified-meta').textContent = `${currentUser.program} • ${currentUser.class_section}`;
      const pos = currentUser.gender === 'MALE' ? 'Male Course Representative' : 'Female Course Representative';
      const seatSvg = currentUser.gender === 'MALE' ? SVG_ICONS.MALE_REP : SVG_ICONS.FEMALE_REP;
      document.getElementById('aspirant-assigned-position-badge').innerHTML = `${seatSvg} ${pos}`;
      document.getElementById('aspirant-live-position-badge').innerHTML = `${seatSvg} Candidate ${pos}`;
      document.getElementById('aspirant-live-name').textContent = currentUser.full_name;
      document.getElementById('aspirant-live-dept').textContent = `${currentUser.program} • ${currentUser.class_section}`;
      const liveCohort = document.getElementById('aspirant-live-cohort-tag');
      if (liveCohort) liveCohort.textContent = currentUser.class_section;
    }
  } else {
    if (authBox) authBox.style.display = 'block';
    if (verifiedCard) verifiedCard.style.display = 'none';
    const statusSpan = document.getElementById('aspirant-verify-status');
    if (statusSpan) {
      statusSpan.textContent = 'Awaiting verification...';
      statusSpan.style.color = 'var(--c-text-muted)';
    }
  }
}

function setupAspirantPortal() {
  // Photo file upload: preview loaded headshot or revert to SVG avatar
  const fileInput = document.getElementById('aspirant-photo-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const photoPreview = document.getElementById('aspirant-photo-preview');
      const liveCardImg = document.getElementById('aspirant-live-card-img');
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (photoPreview) photoPreview.src = re.target.result;
          if (liveCardImg) liveCardImg.src = re.target.result;
        };
        reader.readAsDataURL(file);
      } else {
        if (photoPreview) photoPreview.src = '/person-avatar.svg';
        if (liveCardImg) liveCardImg.src = '/person-avatar.svg';
      }
    });
  }

  // Slogan live preview
  const sloganInput = document.getElementById('aspirant-slogan');
  if (sloganInput) {
    sloganInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const liveSlogan = document.getElementById('aspirant-live-slogan');
      if (liveSlogan) {
        liveSlogan.textContent = val ? `“${val}”` : '“Your campaign slogan will appear here”';
      }
    });
  }

  // Manifesto live preview & char count
  const manifestoInput = document.getElementById('aspirant-manifesto');
  if (manifestoInput) {
    manifestoInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const countEl = document.getElementById('aspirant-char-count');
      const liveManifesto = document.getElementById('aspirant-live-manifesto');
      if (countEl) {
        countEl.textContent = `${val.length} / 20 min characters`;
        countEl.style.color = val.length >= 20 ? 'var(--c-forest-green)' : 'var(--c-text-subtle)';
      }
      if (liveManifesto) {
        liveManifesto.textContent = val || 'Your formal manifesto points will be read by student voters here...';
      }
    });
  }

  // Verify Eligibility button
  const verifyBtn = document.getElementById('aspirant-verify-btn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const ref = document.getElementById('aspirant-ref').value.trim();
      const pin = document.getElementById('aspirant-pin').value.trim();
      const statusSpan = document.getElementById('aspirant-verify-status');

      if (!ref || !pin) {
        statusSpan.textContent = 'Enter Reference Number and Password.';
        statusSpan.style.color = '#ef4444';
        return;
      }

      try {
        verifyBtn.disabled = true;
        statusSpan.textContent = 'Verifying roster...';
        statusSpan.style.color = 'var(--c-forest-green)';

        const res = await apiFetch('/candidates/verify-student', {
          method: 'POST',
          body: JSON.stringify({ reference_number: ref, pin })
        });

        if (res.valid) {
          window.verifiedAspirantStudent = res.student;
          statusSpan.textContent = '✅ Verified eligible student!';
          statusSpan.style.color = 'var(--c-forest-green)';

          // Show verified card
          const verifiedCard = document.getElementById('aspirant-verified-card');
          if (verifiedCard) {
            verifiedCard.style.display = 'block';
            document.getElementById('aspirant-verified-name').textContent = res.student.full_name;
            document.getElementById('aspirant-verified-meta').textContent = `${res.student.program} • ${res.student.class_section}`;
            const seatSvg = res.student.gender === 'MALE' ? SVG_ICONS.MALE_REP : SVG_ICONS.FEMALE_REP;
            document.getElementById('aspirant-assigned-position-badge').innerHTML = `${seatSvg} ${res.student.position}`;
            document.getElementById('aspirant-live-position-badge').innerHTML = `${seatSvg} Candidate ${res.student.position}`;
            document.getElementById('aspirant-live-name').textContent = res.student.full_name;
            document.getElementById('aspirant-live-dept').textContent = `${res.student.program} • ${res.student.class_section}`;
            const liveCohort = document.getElementById('aspirant-live-cohort-tag');
            if (liveCohort) liveCohort.textContent = res.student.class_section;
          }

          if (res.student.is_candidate) {
            showToast(`Notice: You already have a filed candidacy (Status: ${res.student.is_approved ? 'Approved' : 'Pending PRO Review'}).`, 'error');
          }
        }
      } catch (err) {
        statusSpan.textContent = `❌ ${err.message}`;
        statusSpan.style.color = '#ef4444';
        const verifiedCard = document.getElementById('aspirant-verified-card');
        if (verifiedCard) verifiedCard.style.display = 'none';
      } finally {
        verifyBtn.disabled = false;
      }
    });
  }

  // Standalone Aspirant Form Submission
  const form = document.getElementById('standalone-aspirant-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('aspirant-submit-btn');

      // Check student verification
      let ref = '';
      let pin = '';
      if (currentUser && currentUser.role === 'voter') {
        ref = currentUser.reference_number;
      } else if (window.verifiedAspirantStudent) {
        ref = window.verifiedAspirantStudent.reference_number;
        pin = document.getElementById('aspirant-pin').value.trim();
      } else {
        ref = document.getElementById('aspirant-ref').value.trim();
        pin = document.getElementById('aspirant-pin').value.trim();
        if (!ref || !pin) {
          showToast('Please enter your Student Reference Number and Password in Section 1.', 'error');
          document.getElementById('aspirant-ref').focus();
          return;
        }
      }

      const slogan = document.getElementById('aspirant-slogan').value.trim();
      const manifesto = document.getElementById('aspirant-manifesto').value.trim();

      if (manifesto.length < 20) {
        showToast('Please provide a manifesto of at least 20 characters.', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Submitting Candidacy...
        `;

        const formData = new FormData();
        formData.append('reference_number', ref);
        if (pin) formData.append('pin', pin);
        formData.append('slogan', slogan);
        formData.append('manifesto', manifesto);

        const photoFile = document.getElementById('aspirant-photo-file')?.files[0];
        if (!photoFile) {
          showToast('Please upload an official candidate headshot photo before submitting.', 'error');
          return;
        }
        formData.append('photo', photoFile);

        const data = await apiFetch('/candidates/apply', {
          method: 'POST',
          body: formData
        });

        // Show receipt
        document.getElementById('aspirant-form-container').style.display = 'none';
        const receipt = document.getElementById('aspirant-receipt-container');
        receipt.style.display = 'block';
        document.getElementById('receipt-name').textContent = data.user?.full_name || 'Candidate';
        document.getElementById('receipt-ref').textContent = data.user?.reference_number || ref;
        document.getElementById('receipt-seat').textContent = `${data.user?.position} (${data.user?.class_section || ''})`;

        showToast(data.message);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Submit Official Nomination
        `;
      }
    });
  }

  // Back buttons: Return to Voting Portal strictly navigates to the Login page
  const backBtn = document.getElementById('aspirant-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      history.pushState(null, '', '/');
      showLoginScreen();
    });
  }

  const receiptHomeBtn = document.getElementById('receipt-home-btn');
  if (receiptHomeBtn) {
    receiptHomeBtn.addEventListener('click', () => {
      history.pushState(null, '', '/');
      showLoginScreen();
    });
  }
}

// ---------------------------------------------------------------------------
// Voter Dashboard Logic (Dual-Gender Representation)
function openApplicationModal() {
  if (!currentUser) return;
  const isMale = currentUser.gender === 'MALE';
  const posText = `${isMale ? 'Male Course Representative' : 'Female Course Representative'} • ${currentUser.class_section} (${currentUser.program})`;

  applyPositionInput.value = posText;
  document.getElementById('preview-card-name').textContent = currentUser.full_name;
  document.getElementById('preview-card-pos').textContent = `${isMale ? 'Male' : 'Female'} Course Representative • ${currentUser.class_section}`;
  document.getElementById('apply-slogan').value = '';
  document.getElementById('preview-card-slogan').textContent = '“Your campaign slogan will appear here”';
  document.getElementById('apply-manifesto').value = '';
  document.getElementById('apply-manifesto-counter').textContent = '0 / 20 min characters';
  document.getElementById('apply-photo-file').value = '';
  const photoUrlInput = document.getElementById('apply-photo-url');
  if (photoUrlInput) photoUrlInput.value = '';

  const photoPreview = document.getElementById('apply-photo-preview');
  const cardImg = document.getElementById('preview-card-img');
  if (photoPreview) photoPreview.src = '/person-avatar.svg';
  if (cardImg) cardImg.src = '/person-avatar.svg';

  applyModal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Live Program Election Tracker
// ---------------------------------------------------------------------------
async function loadProgramTracker() {
  const trackerCard = document.getElementById('program-election-tracker-card');
  if (!trackerCard || !currentUser || currentUser.role !== 'voter') return;

  try {
    const data = await apiFetch('/voter/program-tracker');
    const { program, election_status, total_registered, total_voted, turnout_pct, cohorts, candidates, rebalances } = data;

    const titleEl = document.getElementById('tracker-program-title');
    if (titleEl) titleEl.textContent = `${program} • Live Election Tracker`;

    const badgeEl = document.getElementById('tracker-status-badge');
    if (badgeEl) {
      if (election_status === 'active') {
        badgeEl.className = 'badge badge-active';
        badgeEl.textContent = 'Polls Open • Live Real-Time Voting';
      } else if (election_status === 'paused') {
        badgeEl.className = 'badge badge-paused';
        badgeEl.textContent = 'Polls Paused';
      } else {
        badgeEl.className = 'badge badge-closed';
        badgeEl.textContent = 'Polls Closed';
      }
    }

    const pctEl = document.getElementById('tracker-turnout-pct');
    if (pctEl) pctEl.textContent = `${turnout_pct}%`;

    const ratioEl = document.getElementById('tracker-turnout-ratio');
    if (ratioEl) ratioEl.textContent = `${total_voted} of ${total_registered} votes cast`;

    // Class A
    const classAPctEl = document.getElementById('tracker-turnout-class-a');
    if (classAPctEl) classAPctEl.textContent = `${cohorts.class_a.pct}%`;
    const barA = document.getElementById('tracker-bar-class-a');
    if (barA) barA.style.width = `${cohorts.class_a.pct}%`;
    const ratioA = document.getElementById('tracker-ratio-class-a');
    if (ratioA) ratioA.textContent = `${cohorts.class_a.voted} / ${cohorts.class_a.registered} voted`;

    // Class B
    const classBPctEl = document.getElementById('tracker-turnout-class-b');
    if (classBPctEl) classBPctEl.textContent = `${cohorts.class_b.pct}%`;
    const barB = document.getElementById('tracker-bar-class-b');
    if (barB) barB.style.width = `${cohorts.class_b.pct}%`;
    const ratioB = document.getElementById('tracker-ratio-class-b');
    if (ratioB) ratioB.textContent = `${cohorts.class_b.voted} / ${cohorts.class_b.registered} voted`;

    // Candidates Standings List
    const listContainer = document.getElementById('tracker-candidates-list');
    if (listContainer) {
      if (!candidates || candidates.length === 0) {
        listContainer.innerHTML = `
          <div style="background: #ffffff; border: 1px dashed var(--c-border); border-radius: var(--radius-sm); padding: 14px; text-align: center; color: var(--c-text-muted); font-size: 13px;">
            No approved candidate nominations yet for ${escapeHtml(program)}.
          </div>
        `;
      } else {
        const maxVotes = Math.max(...candidates.map(c => c.vote_count), 1);
        listContainer.innerHTML = candidates.map(c => {
          const isRebalanced = rebalances && rebalances.some(r => r.reference_number === c.reference_number);
          const rebalancedInfo = isRebalanced ? rebalances.find(r => r.reference_number === c.reference_number) : null;
          const pctOfMax = ((c.vote_count / maxVotes) * 100).toFixed(0);

          return `
            <div style="background: #ffffff; border: 1px solid var(--c-border); border-radius: var(--radius-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${escapeHtml(c.photo_url || '/person-avatar.svg')}" alt="${escapeHtml(c.full_name)}" style="width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; border: 1.5px solid var(--c-forest-green); background: #f0fdf4;" onerror="this.src='/person-avatar.svg'">
                  <div>
                    <strong style="font-size: 14.5px; color: var(--c-black-forest); display: block;">${escapeHtml(c.full_name)}</strong>
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                      <span class="user-tag" style="font-size: 11px; padding: 2px 7px;">${escapeHtml(c.class_section)}</span>
                      <span style="font-size: 11.5px; color: var(--c-text-muted);">${escapeHtml(c.position)}</span>
                      ${isRebalanced ? `<span class="badge badge-paused" style="font-size: 10.5px; padding: 1px 6px;">Dual-Gender Rebalance (Assigned to ${escapeHtml(c.class_section)})</span>` : ''}
                    </div>
                  </div>
                </div>

                <div style="text-align: right;">
                  <strong style="font-size: 17px; color: var(--c-forest-green);">${c.vote_count}</strong>
                  <span style="font-size: 11px; color: var(--c-text-subtle); display: block;">vote${c.vote_count === 1 ? '' : 's'}</span>
                </div>
              </div>

              <div style="height: 5px; background: rgba(10,50,0,0.06); border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; width: ${pctOfMax}%; background: var(--c-forest-green); border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load live program tracker:', err);
  }
}

async function loadVoterDashboard() {
  document.getElementById('voter-name-heading').textContent = `Welcome, ${currentUser.full_name}`;
  document.getElementById('voter-details-sub').textContent = `${currentUser.program} • Assigned Cohort: ${currentUser.class_section}`;
  ballotCohortBadge.textContent = `${currentUser.class_section} • Electing 1 Male Rep & 1 Female Rep`;

  // Start live program tracker & auto-refresh
  loadProgramTracker();
  if (window.trackerInterval) clearInterval(window.trackerInterval);
  window.trackerInterval = setInterval(loadProgramTracker, 8000);

  await Promise.all([
    loadCommunityLinks(),
    loadBallot()
  ]);
}

// Conditional WhatsApp Link Rendering
async function loadCommunityLinks() {
  try {
    const data = await apiFetch('/program-links');
    communityLinksContainer.innerHTML = `
      <a href="${data.main_group_link}" target="_blank" rel="noopener" class="community-card">
        <div style="display: flex; align-items: center;">
          <div class="community-icon-box">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </div>
          <div>
            <strong style="font-size: 15px;">${data.program} Main</strong>
            <span style="display: block; font-size: 12px; color: var(--c-text-subtle);">Official Notices & Announcements</span>
          </div>
        </div>
        <span class="btn btn-secondary btn-sm">Join Group</span>
      </a>

      <a href="${data.discussion_link}" target="_blank" rel="noopener" class="community-card">
        <div style="display: flex; align-items: center;">
          <div class="community-icon-box" style="background: #0284c7;">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <strong style="font-size: 15px;">Discussion Hub</strong>
            <span style="display: block; font-size: 12px; color: var(--c-text-subtle);">Peer Q&A, Labs & Past Questions</span>
          </div>
        </div>
        <span class="btn btn-secondary btn-sm">Open Forum</span>
      </a>

      <!-- Strictly conditional cohort link (Class A or Class B) -->
      <a href="${data.cohort_link}" target="_blank" rel="noopener" class="community-card">
        <div style="display: flex; align-items: center;">
          <div class="community-icon-box" style="background: #10b981;">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div>
            <strong style="font-size: 15px;">${data.class_section} Channel</strong>
            <span style="display: block; font-size: 12px; color: var(--c-text-subtle);">Your Specific Cohort WhatsApp</span>
          </div>
        </div>
        <span class="btn btn-secondary btn-sm">Join Cohort</span>
      </a>
    `;
  } catch (err) {
    console.error('Failed to load program community links:', err);
  }
}

// Dual-Gender Ballot Loading & Card Rendering (Strict Privacy: Sealed until Polls Open)
async function loadBallot() {
  try {
    const data = await apiFetch('/ballot');
    currentBallotData = data;
    currentElectionStatus = data.election_status;
    updateStatusBadge(currentElectionStatus);

    const hasVoted = data.has_voted;
    const maleCandidates = data.male_candidates || [];
    const femaleCandidates = data.female_candidates || [];
    const ballotCard = document.getElementById('ballot-card');
    const voterResultsCard = document.getElementById('voter-results-card');

    // Handle Already Voted State
    if (hasVoted) {
      ballotCard.style.display = 'none';
      stickyVotingDock.style.display = 'none';
      voterAlertBanner.style.display = 'block';

      if (currentElectionStatus === 'closed' || currentElectionStatus === 'published') {
        voterAlertText.innerHTML = `
          <strong style="color: var(--c-forest-green); font-size: 16.5px; display: block; margin-bottom: 4px;">🏆 Official Election Polls Closed &amp; Certified</strong>
          Voting has concluded. Official election results for all aspirants and certified Course Representatives are displayed below.
        `;
        loadVoterResults();
      } else {
        if (voterResultsCard) voterResultsCard.style.display = 'none';
        voterAlertText.innerHTML = `
          <strong style="color: var(--c-forest-green); font-size: 16px; display: block; margin-bottom: 4px;">Your Ballot has been Cast and Verified!</strong>
          Your votes for ${escapeHtml(currentUser.program)} ${escapeHtml(currentUser.class_section)} Male & Female Representatives were encrypted and anonymously recorded.
        `;
      }
      return;
    }

    // STRICT PRIVACY: Handle Non-Active Election State
    if (currentElectionStatus !== 'active') {
      ballotCard.style.display = 'none';
      stickyVotingDock.style.display = 'none';
      voterAlertBanner.style.display = 'block';

      if (currentElectionStatus === 'closed' || currentElectionStatus === 'published') {
        voterAlertText.innerHTML = `
          <strong style="color: var(--c-forest-green); font-size: 16.5px; display: block; margin-bottom: 4px;">🏆 Official Election Polls Closed &amp; Certified</strong>
          Voting has concluded. Official election results for all aspirants and certified Course Representatives are displayed below.
        `;
        loadVoterResults();
      } else if (currentElectionStatus === 'paused') {
        if (voterResultsCard) voterResultsCard.style.display = 'none';
        voterAlertText.innerHTML = `
          <strong style="color: #92400e; font-size: 16px; display: block; margin-bottom: 4px;">Election Polls Paused</strong>
          Voting has been temporarily paused by the ACSES Public Relations Officer for an audit verification. Please check back shortly.
        `;
      }
      return;
    }

    // Active Voting Allowed: Show ballot & candidates
    if (voterResultsCard) voterResultsCard.style.display = 'none';
    ballotCard.style.display = 'block';
    voterAlertBanner.style.display = 'none';
    renderDualBallot(maleCandidates, femaleCandidates, false);
    stickyVotingDock.style.display = 'flex';
    updateDockState();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderDualBallot(maleCandidates, femaleCandidates, isLocked) {
  // Update Seat Badges with candidate counts
  const maleBadge = document.getElementById('male-candidate-count-badge');
  if (maleBadge) {
    maleBadge.textContent = `1 Seat Available • ${maleCandidates.length} Nominee${maleCandidates.length === 1 ? '' : 's'} Contesting`;
  }

  const femaleBadge = document.getElementById('female-candidate-count-badge');
  if (femaleBadge) {
    femaleBadge.textContent = `1 Seat Available • ${femaleCandidates.length} Nominee${femaleCandidates.length === 1 ? '' : 's'} Contesting`;
  }

  renderCandidateSection(
    maleCandidateListContainer,
    maleCandidates,
    selectedMaleCandidateId,
    (id) => {
      selectedMaleCandidateId = (selectedMaleCandidateId === id) ? null : id;
      renderDualBallot(maleCandidates, femaleCandidates, false);
      updateDockState();
    },
    'Male Course Representative',
    isLocked
  );

  renderCandidateSection(
    femaleCandidateListContainer,
    femaleCandidates,
    selectedFemaleCandidateId,
    (id) => {
      selectedFemaleCandidateId = (selectedFemaleCandidateId === id) ? null : id;
      renderDualBallot(maleCandidates, femaleCandidates, false);
      updateDockState();
    },
    'Female Course Representative',
    isLocked
  );
}

function renderCandidateSection(container, candidates, selectedId, onSelect, positionTitle, isLocked) {
  if (!candidates || candidates.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 28px; text-align: center; color: var(--c-text-muted); background: var(--c-surface-muted); border-radius: var(--radius-md); border: 1px dashed var(--c-border);">
        <p style="font-weight: 600; font-size: 14.5px;">No approved candidates yet for ${positionTitle} (${currentUser.class_section})</p>
        <span style="font-size: 12.5px; color: var(--c-text-subtle);">Student applications are currently undergoing vetting by the ACSES Public Relations Officer.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = candidates.map(c => {
    const isSelected = selectedId === c.id;
    const isLongManifesto = c.manifesto && c.manifesto.length > 130;
    const manifestoSnippet = isLongManifesto
      ? c.manifesto.slice(0, 125) + '...'
      : c.manifesto;

    return `
      <div class="candidate-card ${isSelected ? 'selected' : ''}" data-id="${c.id}" data-name="${escapeHtml(c.full_name)}">
        <div class="candidate-photo-hero-wrap">
          <img src="${escapeHtml(c.photo_url || '/person-avatar.svg')}" alt="${escapeHtml(c.full_name)}" class="candidate-photo-hero" onerror="this.src='/person-avatar.svg'">
          <div class="candidate-card-badge">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Verified Nominee
          </div>
        </div>

        <div class="candidate-card-body">
          <h3 class="candidate-name">${escapeHtml(c.full_name)}</h3>
          <div class="candidate-pos">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${escapeHtml(c.position)} • ${escapeHtml(c.class_section)}
          </div>

          ${c.slogan ? `
            <div class="candidate-slogan-quote">
              “${escapeHtml(c.slogan)}”
            </div>
          ` : ''}

          <div class="manifesto-box">
            <p style="margin: 0; line-height: 1.5;">${escapeHtml(manifestoSnippet)}</p>
            ${isLongManifesto ? `
              <button type="button" class="manifesto-read-more-btn" onclick="event.stopPropagation(); openCandidateManifestoModal(${c.id})">
                <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                Read Full Manifesto
              </button>
            ` : ''}
          </div>

          <div class="candidate-select-footer">
            <div class="candidate-radio-ui">
              <div class="radio-circle">
                ${isSelected ? '<svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
              </div>
              <span>${isSelected ? 'Selected for Ballot' : (isLocked ? 'Ballot Sealed' : 'Tap Card to Select')}</span>
            </div>

            <span class="user-tag" style="font-size: 11.5px; padding: 2px 8px;">
              ${escapeHtml(c.class_section)}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (!isLocked) {
    container.querySelectorAll('.candidate-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id, 10);
        onSelect(id);
      });
    });
  }
}

window.openCandidateManifestoModal = function(candidateId) {
  if (!currentBallotData || !currentBallotData.candidates) return;
  const cand = currentBallotData.candidates.find(c => c.id === candidateId);
  if (!cand) return;

  document.getElementById('manifesto-modal-photo').src = cand.photo_url || '/person-avatar.svg';
  document.getElementById('manifesto-modal-name').textContent = cand.full_name;
  document.getElementById('manifesto-modal-pos').textContent = `${cand.position} • ${cand.class_section} (${cand.program})`;
  document.getElementById('manifesto-modal-slogan').textContent = cand.slogan ? `“${cand.slogan}”` : '';
  document.getElementById('manifesto-modal-text').textContent = cand.manifesto;

  document.getElementById('manifesto-modal').classList.add('open');
};

function updateDockState() {
  const maleCard = selectedMaleCandidateId ? document.querySelector(`.candidate-card[data-id="${selectedMaleCandidateId}"]`) : null;
  const femaleCard = selectedFemaleCandidateId ? document.querySelector(`.candidate-card[data-id="${selectedFemaleCandidateId}"]`) : null;

  dockMaleLabel.innerHTML = maleCard
    ? `<svg class="icon icon-sm" style="color: var(--c-forest-green);" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Male Rep: <strong>${escapeHtml(maleCard.dataset.name)}</strong>`
    : `<svg class="icon icon-sm" style="color: var(--c-text-subtle);" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Male Rep: <em style="color: var(--c-text-subtle);">None chosen</em>`;

  dockFemaleLabel.innerHTML = femaleCard
    ? `<svg class="icon icon-sm" style="color: var(--c-forest-green);" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="12" cy="12" r="10"/></svg> Female Rep: <strong>${escapeHtml(femaleCard.dataset.name)}</strong>`
    : `<svg class="icon icon-sm" style="color: var(--c-text-subtle);" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="12" cy="12" r="10"/></svg> Female Rep: <em style="color: var(--c-text-subtle);">None chosen</em>`;

  // Enable button if at least one candidate is selected
  const hasSelection = Boolean(selectedMaleCandidateId || selectedFemaleCandidateId);
  castVoteBtn.disabled = !hasSelection;
}

function openVoteConfirmationModal() {
  if (!selectedMaleCandidateId && !selectedFemaleCandidateId) return;

  const maleCard = selectedMaleCandidateId ? document.querySelector(`.candidate-card[data-id="${selectedMaleCandidateId}"]`) : null;
  const femaleCard = selectedFemaleCandidateId ? document.querySelector(`.candidate-card[data-id="${selectedFemaleCandidateId}"]`) : null;

  confirmCandidatesBox.innerHTML = `
    ${maleCard ? `
      <div style="background: var(--c-surface-muted); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--c-border); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--c-black-forest); display: block;">${escapeHtml(maleCard.dataset.name)}</span>
          <span style="font-size: 12.5px; color: var(--c-forest-green); font-weight: 600;">Male Course Representative (${currentUser.class_section})</span>
        </div>
        <span class="badge badge-active" style="font-size: 11px;">Selected</span>
      </div>
    ` : `
      <div style="background: #fff8e6; padding: 10px 14px; border-radius: var(--radius-md); font-size: 13px; color: #784900;">
        ⚠️ No Male Representative selected for this ballot.
      </div>
    `}

    ${femaleCard ? `
      <div style="background: var(--c-surface-muted); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--c-border); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--c-black-forest); display: block;">${escapeHtml(femaleCard.dataset.name)}</span>
          <span style="font-size: 12.5px; color: var(--c-forest-green); font-weight: 600;">Female Course Representative (${currentUser.class_section})</span>
        </div>
        <span class="badge badge-active" style="font-size: 11px;">Selected</span>
      </div>
    ` : `
      <div style="background: #fff8e6; padding: 10px 14px; border-radius: var(--radius-md); font-size: 13px; color: #784900;">
        ⚠️ No Female Representative selected for this ballot.
      </div>
    `}
  `;

  confirmVoteModal.classList.add('open');
}

async function handleCastBallot() {
  if (!selectedMaleCandidateId && !selectedFemaleCandidateId) return;

  try {
    finalSubmitVoteBtn.disabled = true;
    finalSubmitVoteBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      Securing anonymous ballot...
    `;

    const result = await apiFetch('/ballot/vote', {
      method: 'POST',
      body: JSON.stringify({
        male_candidate_id: selectedMaleCandidateId,
        female_candidate_id: selectedFemaleCandidateId
      })
    });

    confirmVoteModal.classList.remove('open');
    showToast(result.message);
    currentUser.has_voted = true;
    selectedMaleCandidateId = null;
    selectedFemaleCandidateId = null;
    loadProgramTracker();
    loadBallot();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    finalSubmitVoteBtn.disabled = false;
    finalSubmitVoteBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      Confirm & Cast Vote
    `;
  }
}

async function handleCandidateApplication(e) {
  e.preventDefault();
  const fileInput = document.getElementById('apply-photo-file');
  const photoUrl = document.getElementById('apply-photo-url').value.trim();
  const slogan = document.getElementById('apply-slogan').value.trim();
  const manifesto = document.getElementById('apply-manifesto').value.trim();
  const submitBtn = document.getElementById('submit-application-btn');

  if (manifesto.length < 20) {
    showToast('Please provide a manifesto with at least 20 characters.', 'error');
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      Submitting for PRO vetting...
    `;

    let result;
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const formData = new FormData();
      formData.append('photo', fileInput.files[0]);
      formData.append('slogan', slogan);
      formData.append('manifesto', manifesto);

      result = await apiFetch('/candidates/apply', {
        method: 'POST',
        body: formData
      });
    } else {
      const fallbackUrl = photoUrl || '/person-avatar.svg';

      result = await apiFetch('/candidates/apply', {
        method: 'POST',
        body: JSON.stringify({
          photo_url_input: fallbackUrl,
          slogan,
          manifesto
        })
      });
    }

    applyModal.classList.remove('open');
    candidateApplyForm.reset();
    showToast(result.message);

    // Refresh student user state
    const meData = await apiFetch('/auth/me');
    currentUser = meData.user;
    loadVoterDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      Submit Nomination to Public Relations Officer
    `;
  }
}

// ---------------------------------------------------------------------------
// Admin Dashboard Logic (Office of the Public Relations Officer)
// ---------------------------------------------------------------------------
function loadAdminDashboard() {
  loadAdminAnalytics();
  loadAdminCandidates();
  loadAdminRoster();
  loadAdminWhatsAppLinks();
  loadAdminResults();
}

async function loadAdminAnalytics() {
  try {
    const data = await apiFetch('/admin/overview');
    updateStatusBadge(data.election_status);

    document.getElementById('overall-turnout-stat').textContent = `${data.overallTurnoutPct}% (${data.totalVotes} / ${data.totalRegistered})`;
    document.getElementById('overall-turnout-bar').style.width = `${data.overallTurnoutPct}%`;

    const progList = document.getElementById('program-turnout-list');
    progList.innerHTML = data.breakdown.map(p => `
      <div class="progress-item">
        <div class="progress-header">
          <span style="font-weight: 700;">${p.program}</span>
          <span>${p.turnoutPct}% (${p.voted}/${p.registered} voted)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${p.turnoutPct}%;"></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Analytics load error:', err);
  }
}

async function loadAdminCandidates() {
  try {
    const data = await apiFetch('/admin/candidates');
    window.allAdminCandidates = data.candidates || [];

    // Setup filter listeners once
    if (!window.candidateFiltersSetup) {
      window.candidateFiltersSetup = true;
      document.getElementById('candidate-prog-filter')?.addEventListener('change', renderAdminCandidateCards);
      document.getElementById('candidate-status-filter')?.addEventListener('change', renderAdminCandidateCards);
      document.getElementById('candidate-search')?.addEventListener('input', debounce(renderAdminCandidateCards, 200));
    }

    renderAdminCandidateCards();
  } catch (err) {
    const container = document.getElementById('admin-candidate-list');
    if (container) {
      container.innerHTML = `<p style="color: #ef4444;">Failed to load candidate applications: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function renderAdminCandidateCards() {
  const container = document.getElementById('admin-candidate-list');
  if (!container) return;

  const progFilter = document.getElementById('candidate-prog-filter')?.value || 'ALL';
  const statusFilter = document.getElementById('candidate-status-filter')?.value || 'ALL';
  const search = (document.getElementById('candidate-search')?.value || '').trim().toLowerCase();

  let list = window.allAdminCandidates || [];

  if (progFilter !== 'ALL') {
    list = list.filter(c => c.program === progFilter);
  }

  if (statusFilter === 'pending') {
    list = list.filter(c => !c.is_approved);
  } else if (statusFilter === 'approved') {
    list = list.filter(c => Boolean(c.is_approved));
  }

  if (search) {
    list = list.filter(c =>
      (c.full_name && c.full_name.toLowerCase().includes(search)) ||
      (c.reference_number && c.reference_number.toLowerCase().includes(search)) ||
      (c.position && c.position.toLowerCase().includes(search))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; background: var(--c-surface-muted); border-radius: var(--radius-md); border: 1px dashed var(--c-border);">
        <svg class="icon icon-lg" style="color: var(--c-text-subtle); margin-bottom: 8px;" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg>
        <p style="font-weight: 600; color: var(--c-text-primary); margin-bottom: 4px;">No candidate applications match the selected criteria.</p>
        <span style="font-size: 13px; color: var(--c-text-muted);">Try adjusting the program or status filter above.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="candidate-approval-grid">
      ${list.map(c => {
        const isMale = c.gender === 'MALE' || (c.position && c.position.includes('Male'));
        const seatSvg = isMale ? SVG_ICONS.MALE_REP : SVG_ICONS.FEMALE_REP;
        return `
          <div class="candidate-approval-card">
            <div>
              <div class="candidate-approval-header">
                <img src="${escapeHtml(c.photo_url || '/person-avatar.svg')}" alt="${escapeHtml(c.full_name)}" class="candidate-approval-img" onerror="this.src='/person-avatar.svg'">
                <div class="candidate-approval-meta">
                  <h3>${escapeHtml(c.full_name)}</h3>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                    <span class="user-tag" style="font-size: 11px; padding: 2px 7px;">${escapeHtml(c.reference_number)}</span>
                    <span class="user-tag" style="font-size: 11px; padding: 2px 7px; background: rgba(124, 255, 203, 0.2);">${escapeHtml(c.class_section)}</span>
                  </div>
                  <div style="font-size: 12px; font-weight: 600; color: var(--c-black-forest); margin-top: 5px; display: flex; align-items: center; gap: 4px;">
                    ${seatSvg}
                    <span>${escapeHtml(c.position)}</span>
                  </div>
                </div>
              </div>

              <div style="font-size: 12px; color: var(--c-text-subtle); margin-bottom: 6px;">
                ${escapeHtml(c.program)}
              </div>

              ${c.slogan ? `
                <div class="candidate-approval-slogan">
                  “${escapeHtml(c.slogan)}”
                </div>
              ` : ''}

              <div class="candidate-approval-manifesto">
                <strong style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-subtle); display: block; margin-bottom: 2px;">Manifesto:</strong>
                ${escapeHtml(c.manifesto)}
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                <span style="font-size: 11.5px; color: var(--c-text-subtle);">Status:</span>
                ${c.is_approved
                  ? '<span class="badge badge-active" style="font-size: 11px;"><svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Approved on Ballot</span>'
                  : '<span class="badge badge-paused" style="font-size: 11px;"><svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg> Pending Vetting</span>'}
              </div>

              <div class="candidate-approval-actions">
                ${!c.is_approved ? `
                  <button type="button" class="btn btn-action btn-sm" onclick="approveCandidate(${c.id})">
                    <svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    Approve for Ballot
                  </button>
                  <button type="button" class="btn btn-outline-danger btn-sm" onclick="rejectCandidate(${c.id})">
                    Reject Application
                  </button>
                ` : `
                  <button type="button" class="btn btn-outline-danger btn-sm" onclick="rejectCandidate(${c.id})">
                    Revoke Approval
                  </button>
                `}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.approveCandidate = async function(id) {
  try {
    const res = await apiFetch(`/admin/candidates/${id}/approve`, { method: 'POST' });
    showToast(res.message);
    loadAdminCandidates();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.rejectCandidate = async function(id) {
  if (!confirm('Are you sure you want to reject/remove this candidate application?')) return;
  try {
    const res = await apiFetch(`/admin/candidates/${id}/reject`, { method: 'POST' });
    showToast(res.message);
    loadAdminCandidates();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function loadAdminRoster() {
  const prog = document.getElementById('roster-prog-filter').value;
  const section = document.getElementById('roster-class-filter').value;
  const search = document.getElementById('roster-search').value;

  try {
    const query = new URLSearchParams({ program: prog, class_section: section, search }).toString();
    const data = await apiFetch(`/admin/roster?${query}`);
    const tbody = document.getElementById('roster-table-body');

    tbody.innerHTML = data.students.map(s => `
      <tr>
        <td><code>${escapeHtml(s.reference_number)}</code></td>
        <td><strong>${escapeHtml(s.full_name)}</strong></td>
        <td>${escapeHtml(s.gender)}</td>
        <td>${escapeHtml(s.program)}</td>
        <td><span class="user-tag" style="font-size: 11.5px; padding: 2px 8px;">${escapeHtml(s.class_section)}</span></td>
        <td>
          ${s.has_voted
            ? '<span class="badge badge-active"><svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Voted</span>'
            : '<span class="badge badge-paused"><svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg> Pending</span>'}
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="resetStudentPin('${s.reference_number}', '${escapeHtml(s.full_name)}')">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            Reset Password
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Roster load error:', err);
  }
}

window.resetStudentPin = async function(ref, name) {
  if (!confirm(`Restore default formatted password for ${name} (${ref})?`)) return;

  try {
    const data = await apiFetch('/admin/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ reference_number: ref })
    });
    alert(`🔑 PASSWORD RESTORED\n\nStudent: ${name}\nRef: ${ref}\nAccess Password: ${data.newPin}\n\nPlease share this password with the student.`);
    showToast(`Password restored for ${name}`);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Official PDF Class List Downloader Function
window.downloadClassPDF = function(program, classSection) {
  try {
    const token = authToken || localStorage.getItem('acses_token');
    if (!token) {
      showToast('Admin session required. Please sign in.', 'error');
      return;
    }

    showToast(`Downloading official PDF for ${program} (${classSection})...`, 'info');
    const url = `${API_BASE}/admin/export-class-list-pdf?program=${encodeURIComponent(program)}&class_section=${encodeURIComponent(classSection)}&token=${encodeURIComponent(token)}`;

    // Direct synchronous anchor trigger for 100% reliability across all desktop and mobile browsers
    const a = document.createElement('a');
    a.href = url;
    a.download = `${program.toUpperCase()} - ${classSection.toUpperCase()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast(`✅ Official Class List PDF for ${classSection} downloaded.`, 'success');
  } catch (err) {
    showToast(`❌ PDF Download Failed: ${err.message}`, 'error');
  }
};

// WhatsApp Links Management
async function loadAdminWhatsAppLinks() {
  const container = document.getElementById('admin-whatsapp-editor-container');
  try {
    const data = await apiFetch('/admin/program-links');
    const links = data.links;

    container.innerHTML = links.map(pl => `
      <div class="wa-card">
        <div class="wa-card-header">
          <h3 style="font-size: 16.5px; display: flex; align-items: center; gap: 8px; margin: 0;">
            <svg class="icon" style="color: #25d366;" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            ${escapeHtml(pl.program)}
          </h3>
          <span class="badge badge-active" style="font-size: 11px;">Official Program Hub</span>
        </div>

        <form onsubmit="handleSaveWhatsAppLinks(event, '${escapeHtml(pl.program)}')">
          <div class="wa-form-grid">
            <!-- 1. Department Wide Channels -->
            <div>
              <div class="wa-section-heading">
                <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                Department Official Hubs
              </div>

              <div class="form-group" style="margin-bottom: 12px;">
                <label class="form-label" style="font-size: 12px;">Main Announcement Group</label>
                <div class="wa-input-row">
                  <input type="url" id="wa-main-${escapeHtml(pl.program)}" class="form-control" value="${escapeHtml(pl.main_group_link)}" required placeholder="https://chat.whatsapp.com/...">
                  <a href="${escapeHtml(pl.main_group_link)}" target="_blank" rel="noopener" class="wa-test-btn" title="Open and test invite link">
                    <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                    Test
                  </a>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" style="font-size: 12px;">Discussion Forum Hub</label>
                <div class="wa-input-row">
                  <input type="url" id="wa-disc-${escapeHtml(pl.program)}" class="form-control" value="${escapeHtml(pl.discussion_link)}" required placeholder="https://chat.whatsapp.com/...">
                  <a href="${escapeHtml(pl.discussion_link)}" target="_blank" rel="noopener" class="wa-test-btn" title="Open and test invite link">
                    <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                    Test
                  </a>
                </div>
              </div>
            </div>

            <!-- 2. Class Section Channels -->
            <div>
              <div class="wa-section-heading">
                <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                Class Cohort Channels
              </div>

              <div class="form-group" style="margin-bottom: 12px;">
                <label class="form-label" style="font-size: 12px;">Class A WhatsApp Link</label>
                <div class="wa-input-row">
                  <input type="url" id="wa-classa-${escapeHtml(pl.program)}" class="form-control" value="${escapeHtml(pl.class_a_link)}" required placeholder="https://chat.whatsapp.com/...">
                  <a href="${escapeHtml(pl.class_a_link)}" target="_blank" rel="noopener" class="wa-test-btn" title="Open and test invite link">
                    <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                    Test
                  </a>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" style="font-size: 12px;">Class B WhatsApp Link</label>
                <div class="wa-input-row">
                  <input type="url" id="wa-classb-${escapeHtml(pl.program)}" class="form-control" value="${escapeHtml(pl.class_b_link)}" required placeholder="https://chat.whatsapp.com/...">
                  <a href="${escapeHtml(pl.class_b_link)}" target="_blank" rel="noopener" class="wa-test-btn" title="Open and test invite link">
                    <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                    Test
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 14px;">
            <button type="submit" class="btn btn-action btn-sm" style="min-height: 42px; width: 100%; max-width: 260px;">
              <svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Save ${escapeHtml(pl.program)} Links
            </button>
          </div>
        </form>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p style="color: #ef4444;">Failed to load WhatsApp links: ${escapeHtml(err.message)}</p>`;
  }
}

window.handleSaveWhatsAppLinks = async function(e, program) {
  e.preventDefault();
  const mainLink = document.getElementById(`wa-main-${program}`).value.trim();
  const discLink = document.getElementById(`wa-disc-${program}`).value.trim();
  const classALink = document.getElementById(`wa-classa-${program}`).value.trim();
  const classBLink = document.getElementById(`wa-classb-${program}`).value.trim();

  try {
    const result = await apiFetch('/admin/program-links', {
      method: 'POST',
      body: JSON.stringify({
        program,
        main_group_link: mainLink,
        discussion_link: discLink,
        class_a_link: classALink,
        class_b_link: classBLink
      })
    });
    showToast(result.message);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Shared Component: Render Certified Program Results & Winner Indication
function renderProgramResultsComponent(progData, electionStatus) {
  if (!progData || progData.total_candidates === 0) {
    return `
      <div style="background: #ffffff; border: 1.5px dashed var(--c-border); border-radius: var(--radius-md); padding: 24px; text-align: center; color: var(--c-text-muted);">
        <p style="font-size: 15px; margin: 0;">No approved candidate nominations recorded for <strong>${escapeHtml(progData ? progData.program : '')}</strong>.</p>
      </div>
    `;
  }

  const { program, winners, all_aspirants, total_votes } = progData;
  const caMain = winners.class_a.main_rep;
  const caAsst = winners.class_a.assistant_rep;
  const cbMain = winners.class_b.main_rep;
  const cbAsst = winners.class_b.assistant_rep;

  const renderWinnerCard = (title, winner, roleDesc, emoji, badgeBg, borderColor) => {
    if (!winner) {
      return `
        <div style="padding: 12px 14px; background: var(--c-surface-muted); border: 1.5px dashed var(--c-border); border-radius: var(--radius-md); display: flex; align-items: center; gap: 12px; min-height: 80px;">
          <div style="width: 46px; height: 46px; border-radius: 10px; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
            ${emoji}
          </div>
          <div>
            <span class="badge" style="font-size: 10px; background: #e2e8f0; color: #475569;">Vacant / No Nominee</span>
            <strong style="font-size: 13.5px; display: block; color: var(--c-text-muted); margin-top: 2px;">${escapeHtml(title)}</strong>
            <span style="font-size: 11px; color: var(--c-text-subtle);">${escapeHtml(roleDesc)}</span>
          </div>
        </div>
      `;
    }

    return `
      <div style="padding: 12px 14px; background: #ffffff; border: 2px solid ${borderColor}; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 4px 14px rgba(10,50,0,0.06); position: relative; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          <div style="position: relative; flex-shrink: 0;">
            <img src="${escapeHtml(winner.photo_url || '/person-avatar.svg')}" alt="${escapeHtml(winner.full_name)}" style="width: 52px; height: 52px; border-radius: 12px; object-fit: cover; border: 2.5px solid ${borderColor}; background: #f0fdf4;" onerror="this.src='/person-avatar.svg'">
            <span style="position: absolute; top: -7px; right: -7px; font-size: 15px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));">${emoji}</span>
          </div>
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="badge" style="${badgeBg}; font-size: 10.5px; padding: 2px 8px; font-weight: 800;">
                ${escapeHtml(winner.winner_badge || winner.winning_title)}
              </span>
              <span style="font-size: 10.5px; color: var(--c-text-subtle);">${escapeHtml(roleDesc)}</span>
            </div>
            <strong style="font-size: 14.5px; color: var(--c-black-forest); display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(winner.full_name)}
            </strong>
            <span style="font-size: 11.5px; color: var(--c-text-muted); display: block;">
              Ref: ${escapeHtml(winner.reference_number)}
            </span>
          </div>
        </div>

        <div style="text-align: right; flex-shrink: 0;">
          <strong style="font-size: 20px; color: var(--c-forest-green); font-family: var(--font-display); font-weight: 800;">${winner.vote_count}</strong>
          <span style="font-size: 10.5px; color: var(--c-text-subtle); display: block;">vote${winner.vote_count === 1 ? '' : 's'}</span>
        </div>
      </div>
    `;
  };

  const maxVotes = Math.max(...all_aspirants.map(a => a.vote_count), 1);

  return `
    <div style="margin-bottom: 28px; padding-bottom: 22px; border-bottom: 1px solid var(--c-border);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;">
        <div>
          <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.08em; color: var(--c-forest-green);">Certified Official Leadership</span>
          <h3 style="font-size: 20px; color: var(--c-black-forest); margin: 2px 0 0 0;">${escapeHtml(program)}</h3>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge badge-active" style="font-size: 11px;">Dual-Gender Representation (1 Male &amp; 1 Female per Class)</span>
          <span class="user-tag" style="font-size: 11.5px;">${total_votes} Total Votes</span>
        </div>
      </div>

      <!-- Cohort Leadership Grid: Class A on Left, Class B on Right -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; margin-bottom: 22px;">
        <!-- CLASS A LEADERSHIP -->
        <div style="background: linear-gradient(180deg, #ffffff 0%, rgba(240, 253, 244, 0.4) 100%); border: 2px solid #379634; border-radius: var(--radius-md); padding: 16px; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1.5px solid rgba(55, 150, 52, 0.2);">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 16px;">🏛️</span>
              <strong style="font-size: 15px; color: var(--c-black-forest);">Class A Executive Representatives</strong>
            </div>
            <span class="user-tag" style="font-size: 10.5px; background: rgba(55, 150, 52, 0.12); color: #0a3200; font-weight: 700;">Cohort A</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${renderWinnerCard(
              'Class A Course Representative',
              caMain,
              'Top Male • More Votes',
              '👑',
              'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d',
              '#f59e0b'
            )}
            ${renderWinnerCard(
              'Class A Assistant Course Representative',
              caAsst,
              'Runner-up Female • Less Votes',
              '🌟',
              'background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0',
              '#10b981'
            )}
          </div>
        </div>

        <!-- CLASS B LEADERSHIP -->
        <div style="background: linear-gradient(180deg, #ffffff 0%, rgba(240, 253, 244, 0.4) 100%); border: 2px solid #0284c7; border-radius: var(--radius-md); padding: 16px; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1.5px solid rgba(2, 132, 199, 0.2);">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 16px;">🏛️</span>
              <strong style="font-size: 15px; color: var(--c-black-forest);">Class B Executive Representatives</strong>
            </div>
            <span class="user-tag" style="font-size: 10.5px; background: rgba(2, 132, 199, 0.12); color: #0369a1; font-weight: 700;">Cohort B</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${renderWinnerCard(
              'Class B Course Representative',
              cbMain,
              'Top Female • More Votes',
              '👑',
              'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d',
              '#f59e0b'
            )}
            ${renderWinnerCard(
              'Class B Assistant Course Representative',
              cbAsst,
              'Runner-up Male • Less Votes',
              '🌟',
              'background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc',
              '#0284c7'
            )}
          </div>
        </div>
      </div>

      <!-- ALL ASPIRANTS RACE STANDINGS -->
      <div style="background: #ffffff; border: 1px solid var(--c-border); border-radius: var(--radius-md); padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h4 style="font-size: 14.5px; color: var(--c-black-forest); font-weight: 700; margin: 0; display: flex; align-items: center; gap: 6px;">
            <svg class="icon icon-sm" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Complete Aspirants Race Standings (${all_aspirants.length} Contenders)
          </h4>
          <span style="font-size: 11.5px; color: var(--c-text-subtle);">Ranked by Total Verified Votes</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${all_aspirants.map((asp, idx) => {
            const pct = total_votes > 0 ? ((asp.vote_count / total_votes) * 100).toFixed(1) : '0.0';
            const barPct = ((asp.vote_count / maxVotes) * 100).toFixed(0);

            let statusBadge = '<span class="badge" style="background: var(--c-surface-muted); color: var(--c-text-muted); font-size: 10px;">Aspirant (Runner-up)</span>';
            let cardBg = '#ffffff';
            let cardBorder = 'var(--c-border)';

            if (asp.winner_category === 'CLASS_A_MAIN') {
              statusBadge = '<span class="badge" style="background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; font-size: 10px; font-weight: 800;">🏆 Elected: Class A Course Rep</span>';
              cardBg = 'rgba(254, 243, 199, 0.25)';
              cardBorder = '#f59e0b';
            } else if (asp.winner_category === 'CLASS_A_ASSISTANT') {
              statusBadge = '<span class="badge" style="background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; font-size: 10px; font-weight: 800;">🎖️ Elected: Class A Assistant Rep</span>';
              cardBg = 'rgba(209, 250, 229, 0.25)';
              cardBorder = '#10b981';
            } else if (asp.winner_category === 'CLASS_B_MAIN') {
              statusBadge = '<span class="badge" style="background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; font-size: 10px; font-weight: 800;">🏆 Elected: Class B Course Rep</span>';
              cardBg = 'rgba(254, 243, 199, 0.25)';
              cardBorder = '#f59e0b';
            } else if (asp.winner_category === 'CLASS_B_ASSISTANT') {
              statusBadge = '<span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; font-size: 10px; font-weight: 800;">🎖️ Elected: Class B Assistant Rep</span>';
              cardBg = 'rgba(224, 242, 254, 0.25)';
              cardBorder = '#0284c7';
            }

            return `
              <div style="background: ${cardBg}; border: 1.5px solid ${cardBorder}; border-radius: var(--radius-sm); padding: 10px 14px; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <span style="font-size: 12px; font-weight: 800; color: var(--c-text-subtle); width: 22px;">#${idx + 1}</span>
                    <img src="${escapeHtml(asp.photo_url || '/person-avatar.svg')}" alt="${escapeHtml(asp.full_name)}" style="width: 38px; height: 38px; border-radius: 8px; object-fit: cover; border: 1px solid var(--c-border); background: #f0fdf4;" onerror="this.src='/person-avatar.svg'">
                    <div style="min-width: 0;">
                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="font-size: 14px; color: var(--c-black-forest);">${escapeHtml(asp.full_name)}</strong>
                        ${statusBadge}
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--c-text-muted); margin-top: 1px;">
                        <span>${escapeHtml(asp.gender === 'MALE' ? 'Male Candidate' : 'Female Candidate')}</span>
                        <span>•</span>
                        <span>Contested: ${escapeHtml(asp.position)}</span>
                        ${asp.slogan ? `<span>•</span><span style="font-style: italic; color: var(--c-forest-green);">“${escapeHtml(asp.slogan)}”</span>` : ''}
                      </div>
                    </div>
                  </div>

                  <div style="text-align: right; flex-shrink: 0;">
                    <strong style="font-size: 16px; color: var(--c-forest-green); font-weight: 800;">${asp.vote_count}</strong>
                    <span style="font-size: 10.5px; color: var(--c-text-subtle); display: block;">${pct}% (${asp.vote_count} vote${asp.vote_count === 1 ? '' : 's'})</span>
                  </div>
                </div>

                <div style="height: 5px; background: rgba(10,50,0,0.06); border-radius: 3px; overflow: hidden;">
                  <div style="height: 100%; width: ${barPct}%; background: ${asp.is_winner ? 'var(--c-forest-green)' : '#94a3b8'}; border-radius: 3px; transition: width 0.3s ease;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// Student & Voter Results Loader
async function loadVoterResults() {
  const container = document.getElementById('voter-results-card');
  if (!container || !currentUser) return;

  try {
    const data = await apiFetch('/results');
    if (!data.results_published) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const progData = data.results[currentUser.program] || Object.values(data.results)[0];

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid var(--c-forest-green);">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 22px;">🏆</span>
            <div>
              <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-forest-green); display: block;">
                Certified Official Election Results
              </span>
              <h2 style="font-size: 20px; color: var(--c-black-forest); margin: 2px 0 0 0;">
                Course Representatives &amp; Assistants Declared
              </h2>
            </div>
          </div>
          <p style="font-size: 13.5px; color: var(--c-text-muted); margin: 6px 0 0 0;">
            Polls closed and certified by the <strong>ACSES Public Relations Officer</strong>.
          </p>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          <select id="voter-results-prog-select" class="form-control" style="width: auto; font-size: 12.5px; padding: 6px 10px; font-weight: 600;">
            ${Object.keys(data.results).map(p => `
              <option value="${escapeHtml(p)}" ${p === currentUser.program ? 'selected' : ''}>${escapeHtml(p)}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div id="voter-results-content">
        ${renderProgramResultsComponent(progData, data.election_status)}
      </div>
    `;

    const selectEl = document.getElementById('voter-results-prog-select');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        const selectedProg = e.target.value;
        const targetData = data.results[selectedProg];
        const contentEl = document.getElementById('voter-results-content');
        if (contentEl && targetData) {
          contentEl.innerHTML = renderProgramResultsComponent(targetData, data.election_status);
        }
      });
    }

  } catch (err) {
    console.error('Failed to load voter results:', err);
  }
}

// Results Grouped by Program & Certified Winners
async function loadAdminResults() {
  try {
    const data = await apiFetch('/admin/results');
    const container = document.getElementById('results-container');
    if (!container) return;

    if (!data.results || Object.keys(data.results).length === 0) {
      container.innerHTML = '<p style="color: var(--c-text-muted);">No candidate nominations or vote data available.</p>';
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom: 20px; background: rgba(16, 185, 129, 0.1); border: 1.5px solid var(--c-forest-green); border-radius: var(--radius-md); padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <strong style="font-size: 15px; color: var(--c-black-forest); display: flex; align-items: center; gap: 6px;">
            <span>🏆</span> Official Executive Representative Election Results
          </strong>
          <span style="font-size: 12.5px; color: var(--c-text-muted); display: block; margin-top: 2px;">
            Rule: 1st Male = Class A Rep | 2nd Female = Class A Assistant | 1st Female = Class B Rep | 2nd Male = Class B Assistant
          </span>
        </div>
        <span class="badge ${data.election_status === 'active' ? 'badge-active' : 'badge-closed'}" style="font-size: 11.5px;">
          ${data.election_status === 'active' ? 'Polls Active (Live Standings)' : 'Polls Closed (Certified Winners)'}
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 24px;">
        ${Object.values(data.results).map(progData => renderProgramResultsComponent(progData, data.election_status)).join('')}
      </div>
    `;

  } catch (err) {
    console.error('Results load error:', err);
  }
}

// Complementary State Badge with SVG Icons
function updateStatusBadge(status) {
  electionBadge.className = 'badge';

  if (status === 'active') {
    electionBadge.classList.add('badge-active');
    electionBadge.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
      <span>Polls Open</span>
    `;
  } else if (status === 'paused') {
    electionBadge.classList.add('badge-paused');
    electionBadge.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
      <span>Voting Paused</span>
    `;
  } else if (status === 'published') {
    electionBadge.classList.add('badge-active');
    electionBadge.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
      <span>Results Published</span>
    `;
  } else {
    electionBadge.classList.add('badge-closed');
    electionBadge.innerHTML = `
      <svg class="icon icon-sm" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span>Polls Closed</span>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Launch app on DOM Ready
document.addEventListener('DOMContentLoaded', initApp);
