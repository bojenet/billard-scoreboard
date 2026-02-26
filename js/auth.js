async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error("Auth getUser fehlgeschlagen:", error);
    return null;
  }
  return data?.user || null;
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

async function signOutAndRedirect() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error("Logout fehlgeschlagen:", error);
  }
  window.location.href = "/login.html";
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
