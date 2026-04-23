const TRAINING_ACCESS_VALUES = ["hidden", "read", "edit"];

function normalizeTrainingAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRAINING_ACCESS_VALUES.includes(normalized) ? normalized : "edit";
}

async function getUserTrainingAccess(userId) {
  if (!userId) return "edit";
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("training_access")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Training-Recht konnte nicht geladen werden:", userId, error);
    return "edit";
  }
  return normalizeTrainingAccess(data?.training_access);
}

async function getTrainingAccess(user) {
  if (user && await hasAdminAccess(user)) return "edit";
  return getUserTrainingAccess(user?.id);
}

function isTrainingEditable(accessMode) {
  return normalizeTrainingAccess(accessMode) === "edit";
}

function isTrainingVisible(accessMode) {
  return normalizeTrainingAccess(accessMode) !== "hidden";
}

