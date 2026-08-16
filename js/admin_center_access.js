async function getUserAdminCenterAccess(userId) {
  if (!userId) return false;
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("admin_center_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Admin-Center-Recht konnte nicht geladen werden:", userId, error);
    return false;
  }
  return data?.admin_center_access === true;
}

async function getAdminCenterAccess(user) {
  if (!user) return false;
  if (await hasAdminAccess(user)) return true;
  return getUserAdminCenterAccess(user.id);
}

async function requireAdminCenterAccess() {
  const user = await requireAuth();
  if (!user) return null;
  const allowed = await getAdminCenterAccess(user);
  if (!allowed) {
    document.body.innerHTML = "<div style='padding:40px;font-family:Arial'>Kein Admin-Center-Zugriff.</div>";
    return null;
  }
  return user;
}
