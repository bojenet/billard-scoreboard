const TOURNAMENT_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizeTournamentAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TOURNAMENT_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getUserTournamentAccess(userId) {
  if (!userId) return "edit";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("tournament_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Turnier-Recht konnte nicht geladen werden:", userId, error);
    return "edit";
  }
  return normalizeTournamentAccess(data?.tournament_access);
}

async function getTournamentAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserTournamentAccess(user?.id);
}

function isTournamentEditable(accessMode) {
  return normalizeTournamentAccess(accessMode) === "edit";
}

function isTournamentVisible(accessMode) {
  return normalizeTournamentAccess(accessMode) !== "hidden";
}

