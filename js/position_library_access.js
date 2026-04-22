const POSITION_LIBRARY_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizePositionLibraryAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return POSITION_LIBRARY_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getUserPositionLibraryAccess(userId) {
  if (!userId) return "edit";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("position_library_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Positions-Library-Recht konnte nicht geladen werden:", userId, error);
    return "edit";
  }
  return normalizePositionLibraryAccess(data?.position_library_access);
}

async function setUserPositionLibraryAccess(userId, value) {
  if (!userId) throw new Error("userId fehlt");
  const { error } = await supabaseClient
    .from("user_roles")
    .upsert([{ user_id: userId, position_library_access: normalizePositionLibraryAccess(value) }], { onConflict: "user_id" });

  if (error) throw error;
}

async function getPositionLibraryAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserPositionLibraryAccess(user?.id);
}

function isPositionLibraryEditable(accessMode) {
  return normalizePositionLibraryAccess(accessMode) === "edit";
}

function isPositionLibraryVisible(accessMode) {
  return normalizePositionLibraryAccess(accessMode) !== "hidden";
}
