function normalizeStreamOverlayAccess(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (["false", "0", "no", "nein", "hidden", "disabled"].includes(normalized)) return false;
  return true;
}

async function getUserStreamOverlayAccess(userId) {
  if (!userId) return true;
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("stream_overlay_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("OBS-Streaming-Recht konnte nicht geladen werden:", userId, error);
    return true;
  }
  return normalizeStreamOverlayAccess(data?.stream_overlay_access);
}

async function getStreamOverlayAccess(user) {
  if (user && await hasAdminAccess(user)) return true;
  return getUserStreamOverlayAccess(user?.id);
}
