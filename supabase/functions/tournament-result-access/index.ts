import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return respond({ error: "Methode nicht erlaubt." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const authorization = request.headers.get("Authorization") || "";
    const { data: auth, error: authError } = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !auth.user) return respond({ error: "Bitte anmelden." }, 401);
    const { eventId, email: rawEmail } = await request.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^[\da-f-]{36}$/i.test(String(eventId))) return respond({ error: "Turnier oder E-Mail ungültig." }, 400);
    const caller = createClient(url, serviceKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: allowed, error: permissionError } = await caller.rpc("result_can_manage", { p_id: eventId });
    if (permissionError || !allowed) return respond({ error: "Nur die Turnierleitung darf Zugänge erteilen." }, 403);
    const { data: existing, error: grantError } = await caller.rpc("grant_t15_access", { p_id: eventId, p_email: email });
    if (grantError) throw grantError;
    if (existing) return respond({ ok: true, invited: false });
    // An email is sent only after the manager explicitly selects the invitation option.
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `https://www.billard-studio.de/turnier_ergebnisse.html?turnier=${encodeURIComponent(eventId)}&zugang=1`,
      data: { full_name: email.split("@")[0], result_only: true }
    });
    if (inviteError || !invited.user) throw inviteError || new Error("Zugang konnte nicht angelegt werden.");
    const { error: roleError } = await admin.from("user_roles").upsert({
      user_id: invited.user.id, role: "member", match_access: "hidden", training_access: "hidden", position_library_access: "hidden", tournament_access: "hidden", calendar_access: "hidden", club_mobile_access: "hidden", admin_center_access: false, stream_overlay_access: false
    }, { onConflict: "user_id" });
    if (roleError) throw roleError;
    const { data: granted, error: finalError } = await caller.rpc("grant_t15_access", { p_id: eventId, p_email: email });
    if (finalError || !granted) throw finalError || new Error("Turnierzuordnung fehlgeschlagen.");
    return respond({ ok: true, invited: true });
  } catch (error) {
    console.error("Turnierzugang fehlgeschlagen:", error);
    return respond({ error: error instanceof Error ? error.message : "Zugang konnte nicht erteilt werden." }, 400);
  }
});
