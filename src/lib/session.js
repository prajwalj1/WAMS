// Client session (§28): access token lives in memory only, never storage.
// sid + profile persist in sessionStorage; lightweight cookies drive the
// middleware gate (prototype marker — real auth stays server-side).
let access = null;

export function setSession({ access: a, sid, username, profile }) {
  access = a || null;
  try {
    if (sid) sessionStorage.setItem("wmams-sid", sid);
    if (username) sessionStorage.setItem("wmams-user", username);
    if (profile) sessionStorage.setItem("wmams-profile", JSON.stringify(profile));
    if (sid) {
      document.cookie = "wmams-auth=1; path=/; max-age=604800";
      if (profile?.role) document.cookie = `wmams-role=${profile.role}; path=/; max-age=604800`;
    }
  } catch {}
}
export function getAccess() {
  return access;
}
export function getSid() {
  try {
    return sessionStorage.getItem("wmams-sid");
  } catch {
    return null;
  }
}
export function getUsername() {
  try {
    return sessionStorage.getItem("wmams-user");
  } catch {
    return null;
  }
}
export function getProfile() {
  try {
    const raw = sessionStorage.getItem("wmams-profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  access = null;
  try {
    sessionStorage.removeItem("wmams-sid");
    sessionStorage.removeItem("wmams-user");
    sessionStorage.removeItem("wmams-profile");
    sessionStorage.removeItem("wmams-challenge");
    sessionStorage.removeItem("wmams-pending-profile");
    document.cookie = "wmams-auth=; path=/; max-age=0";
    document.cookie = "wmams-role=; path=/; max-age=0";
  } catch {}
}
export function authHeader() {
  return access ? { Authorization: `Bearer ${access}` } : {};
}
