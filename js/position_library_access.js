const POSITION_LIBRARY_ACCESS_KEY = "position_library_access";
const POSITION_LIBRARY_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizePositionLibraryAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return POSITION_LIBRARY_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getAppSetting(key) {
  if (!key) return null;
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.warn("App-Setting konnte nicht geladen werden:", key, error);
    return null;
  }
  return data ? data.value : null;
}

async function setAppSetting(key, value) {
  const { error } = await supabaseClient
    .from("app_settings")
    .upsert([{ key, value }], { onConflict: "key" });

  if (error) throw error;
}

async function getPositionLibraryAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getConfiguredPositionLibraryAccess();
}

async function getConfiguredPositionLibraryAccess() {
  const value = await getAppSetting(POSITION_LIBRARY_ACCESS_KEY);
  return normalizePositionLibraryAccess(value);
}

function isPositionLibraryEditable(accessMode) {
  return normalizePositionLibraryAccess(accessMode) === "edit";
}

function isPositionLibraryVisible(accessMode) {
  return normalizePositionLibraryAccess(accessMode) !== "hidden";
}
