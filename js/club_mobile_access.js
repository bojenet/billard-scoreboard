const CLUB_MOBILE_ACCESS_VALUES = ["hidden", "edit"];

function normalizeClubMobileAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CLUB_MOBILE_ACCESS_VALUES.includes(normalized) ? normalized : "hidden";
}

async function getUserClubMobileAccess(userId) {
  if (!userId) return "hidden";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("club_mobile_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Club-Mobile-Recht konnte nicht geladen werden:", userId, error);
    return "hidden";
  }
  return normalizeClubMobileAccess(data?.club_mobile_access);
}

async function getClubMobileAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserClubMobileAccess(user?.id);
}

function isClubMobileVisible(accessMode) {
  return normalizeClubMobileAccess(accessMode) !== "hidden";
}
