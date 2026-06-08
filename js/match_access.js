const MATCH_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizeMatchAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MATCH_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getUserMatchAccess(userId) {
  if (!userId) return "hidden";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("match_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Match-Recht konnte nicht geladen werden:", userId, error);
    return "hidden";
  }
  return normalizeMatchAccess(data?.match_access);
}

async function getMatchAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserMatchAccess(user?.id);
}

function isMatchEditable(accessMode) {
  return normalizeMatchAccess(accessMode) === "edit";
}

function isMatchVisible(accessMode) {
  return normalizeMatchAccess(accessMode) !== "hidden";
}
