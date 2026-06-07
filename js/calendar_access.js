const CALENDAR_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizeCalendarAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CALENDAR_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getUserCalendarAccess(userId) {
  if (!userId) return "hidden";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("calendar_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Kalender-Recht konnte nicht geladen werden:", userId, error);
    return "hidden";
  }
  return normalizeCalendarAccess(data?.calendar_access);
}

async function getCalendarAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserCalendarAccess(user?.id);
}

function isCalendarEditable(accessMode) {
  return normalizeCalendarAccess(accessMode) === "edit";
}

function isCalendarVisibleForUser(accessMode) {
  return normalizeCalendarAccess(accessMode) !== "hidden";
}
