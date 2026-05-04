/**
 * Netlify Identity — use the official script in index.html so `window.netlifyIdentity`
 * is the full widget API (bundling the npm UMD file via webpack often breaks `.init`).
 */

let initialized = false;

function getWidget() {
  if (typeof window === 'undefined') return null;
  return window.netlifyIdentity ?? null;
}

/** Must run before open/currentUser; safe to call repeatedly */
function ensureInit() {
  const ni = getWidget();
  if (!ni) {
    console.error(
      '[auth] Netlify Identity widget not found. Add to index.html:\n' +
        '<script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>'
    );
    return null;
  }
  if (!initialized && typeof ni.init === 'function') {
    ni.init({
      container: '#netlify-modal',
      locale: 'en',
    });
    initialized = true;
  }
  return ni;
}

// ── Auth functions ────────────────────────────────

export function initAuth(onLogin, onLogout) {
  const netlifyIdentity = ensureInit();
  if (!netlifyIdentity) return;

  netlifyIdentity.on('login', (user) => {
    netlifyIdentity.close();
    onLogin(user);
  });

  netlifyIdentity.on('logout', () => {
    onLogout();
  });

  netlifyIdentity.on('error', (err) => {
    console.error('Netlify Identity error:', err);
  });
}

export function openLogin() {
  const netlifyIdentity = ensureInit();
  if (!netlifyIdentity) return;
  netlifyIdentity.open('login');
}

export function openSignup() {
  const netlifyIdentity = ensureInit();
  if (!netlifyIdentity) return;
  netlifyIdentity.open('signup');
}

export function logout() {
  const netlifyIdentity = ensureInit();
  if (!netlifyIdentity) return;
  netlifyIdentity.logout();
}

export function getCurrentUser() {
  const netlifyIdentity = ensureInit();
  if (!netlifyIdentity) return null;
  try {
    return netlifyIdentity.currentUser();
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return getCurrentUser() !== null;
}

// ── Role helpers ──────────────────────────────────

export function getUserRole(user) {
  return user?.app_metadata?.roles?.[0] || 'researcher';
}

export function isAdmin(user) {
  const roles = user?.app_metadata?.roles || [];
  return roles.includes('admin');
}

export function getDisplayName(user) {
  return user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
}

// ── Token for API calls ───────────────────────────

export async function getToken() {
  ensureInit();
  const user = getCurrentUser();
  if (!user) return null;
  try {
    return await user.jwt();
  } catch {
    return null;
  }
}
