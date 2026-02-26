async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error("Auth getUser fehlgeschlagen:", error);
    return null;
  }
  return data?.user || null;
}

function isAdminUser(user) {
  if (!user) return false;
  const appRole = user.app_metadata?.role;
  const userRole = user.user_metadata?.role;
  return appRole === "admin" || userRole === "admin";
}

async function getUserRole(userId) {
  if (!userId) return null;
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Konnte user role nicht laden:", error);
    return null;
  }
  return data?.role || null;
}

async function hasAdminAccess(user) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const role = await getUserRole(user.id);
  return role === "admin";
}

async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = "/login.html?next=" + next;
    return null;
  }
  return user;
}

async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  const admin = await hasAdminAccess(user);
  if (!admin) {
    document.body.innerHTML = "<div style='padding:40px;font-family:Arial'>Kein Admin-Zugriff.</div>";
    return null;
  }
  return user;
}

async function signOutAndRedirect() {
  const { error } = await supabaseClient.auth.signOut({ scope: "global" });
  if (error) {
    console.error("Logout fehlgeschlagen:", error);
  }
  // Fallback: lokale Session-Artefakte entfernen.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-")) {
        localStorage.removeItem(key);
      }
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("sb-")) {
        sessionStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("Session-Cleanup fehlgeschlagen:", e);
  }
  window.location.replace("/login.html?logged_out=1");
}

async function getOwnedPlayerNames(userId) {
  if (!userId) return [];
  const { data, error } = await supabaseClient
    .from("players")
    .select("name,user_id")
    .eq("user_id", userId);

  if (error) {
    console.warn("Konnte Spielerprofil nicht laden:", error);
    return [];
  }
  return (data || [])
    .map((x) => x.name)
    .filter(Boolean);
}

function isOwnedMatch(match, userId, ownedNames) {
  if (!match) return false;
  if (match.player1_id && String(match.player1_id) === String(userId)) return true;
  if (match.player2_id && String(match.player2_id) === String(userId)) return true;
  if (Array.isArray(ownedNames) && ownedNames.length > 0) {
    if (ownedNames.includes(match.player1) || ownedNames.includes(match.player2)) return true;
  }
  return false;
}

function getDisplayName(user) {
  if (!user) return "";
  return (
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email ||
    user.id
  );
}
