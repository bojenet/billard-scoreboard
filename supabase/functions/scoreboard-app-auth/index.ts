import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TECHNICAL_EMAIL = "scoreboard-app@billard-studio.de";

type RequestPayload = {
  action?: string;
  pin?: string;
  deviceId?: string;
  deviceName?: string;
  sessionId?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const randomHex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return randomHex + "!Aa9";
}

function decodeJwtPayload(jwt: string) {
  try {
    const payload = jwt.split(".")[1] || "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch (_error) {
    return {};
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "service-role-missing", message: "Serverkonfiguration fehlt." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload = (await request.json().catch(() => ({}))) as RequestPayload;
    const action = cleanText(payload.action) || "login";
    const authHeader = request.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

    const getAuthenticatedUser = async () => {
      if (!jwt) return null;
      const { data, error } = await adminClient.auth.getUser(jwt);
      return error ? null : data?.user || null;
    };

    const requireAdmin = async () => {
      const user = await getAuthenticatedUser();
      if (!user?.id) return null;
      const metadataRole = cleanText(user.app_metadata?.role || user.user_metadata?.role);
      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return metadataRole === "admin" || roleRow?.role === "admin" ? user : null;
    };

    const getSettings = async () => {
      const { data, error } = await adminClient
        .from("scoreboard_app_settings")
        .select("auth_user_id, pin_hash, failed_attempts, locked_until, pin_updated_at, updated_at")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    const ensureTechnicalUser = async () => {
      const settings = await getSettings();
      if (settings?.auth_user_id) {
        const { data } = await adminClient.auth.admin.getUserById(settings.auth_user_id);
        if (data?.user) return data.user;
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .ilike("email", TECHNICAL_EMAIL)
        .maybeSingle();
      let technicalUserId = cleanText(existingProfile?.id);
      let technicalUser = null;
      if (technicalUserId) {
        const { data } = await adminClient.auth.admin.getUserById(technicalUserId);
        technicalUser = data?.user || null;
      }
      if (!technicalUser) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: TECHNICAL_EMAIL,
          password: randomPassword(),
          email_confirm: true,
          user_metadata: {
            first_name: "Scoreboard",
            last_name: "App",
            full_name: "Scoreboard App",
            display_name: "Scoreboard App",
            technical_account: true,
          },
        });
        if (error || !data?.user) throw error || new Error("Technischer Benutzer konnte nicht erstellt werden.");
        technicalUser = data.user;
        technicalUserId = data.user.id;
      }

      const { error: profileError } = await adminClient.from("profiles").upsert({
        id: technicalUserId,
        email: TECHNICAL_EMAIL,
        first_name: "Scoreboard",
        last_name: "App",
        full_name: "Scoreboard App",
      }, { onConflict: "id" });
      if (profileError) throw profileError;

      const { error: roleError } = await adminClient.from("user_roles").upsert({
        user_id: technicalUserId,
        role: "member",
        match_access: "hidden",
        position_library_access: "hidden",
        training_access: "hidden",
        tournament_access: "hidden",
        calendar_access: "hidden",
        club_mobile_access: "edit",
        admin_center_access: false,
        stream_overlay_access: false,
      }, { onConflict: "user_id" });
      if (roleError) throw roleError;
      return technicalUser;
    };

    if (action === "login") {
      const pin = cleanText(payload.pin);
      if (!/^\d{6}$/.test(pin)) {
        return jsonResponse({ error: "invalid-pin", message: "Bitte den sechsstelligen Vereins-PIN eingeben." }, 400);
      }
      const { data, error } = await adminClient.rpc("scoreboard_app_verify_pin", { pin_value: pin });
      if (error) throw error;
      const verification = Array.isArray(data) ? data[0] : data;
      if (!verification?.success) {
        const blockedUntil = verification?.blocked_until || null;
        return jsonResponse({
          error: blockedUntil ? "temporarily-locked" : "invalid-pin",
          message: blockedUntil
            ? "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen."
            : "Der Vereins-PIN ist nicht korrekt.",
          blockedUntil,
        }, 401);
      }

      const technicalUserId = cleanText(verification.technical_user_id);
      const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(technicalUserId);
      if (userError || !userData?.user?.email) throw userError || new Error("Technischer Benutzer fehlt.");
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: userData.user.email,
        options: { redirectTo: "https://www.billard-studio.de/club_mobile.html" },
      });
      if (linkError || !linkData?.properties?.hashed_token) throw linkError || new Error("Sitzung konnte nicht vorbereitet werden.");

      const deviceId = cleanText(payload.deviceId);
      if (/^[0-9a-f-]{36}$/i.test(deviceId)) {
        await adminClient.from("scoreboard_app_devices").upsert({
          device_id: deviceId,
          device_name: cleanText(payload.deviceName).slice(0, 100) || "Scoreboard-Gerät",
          user_agent: cleanText(request.headers.get("user-agent")).slice(0, 500),
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        }, { onConflict: "device_id" });
      }
      return jsonResponse({
        ok: true,
        email: userData.user.email,
        tokenHash: linkData.properties.hashed_token,
      });
    }

    if (action === "heartbeat") {
      const user = await getAuthenticatedUser();
      const settings = await getSettings();
      if (!user?.id || user.id !== settings?.auth_user_id) {
        return jsonResponse({ error: "not-authorized" }, 403);
      }
      const deviceId = cleanText(payload.deviceId);
      const claims = decodeJwtPayload(jwt);
      const sessionId = cleanText(claims.session_id);
      if (/^[0-9a-f-]{36}$/i.test(deviceId)) {
        const { error } = await adminClient.from("scoreboard_app_devices").upsert({
          device_id: deviceId,
          device_name: cleanText(payload.deviceName).slice(0, 100) || "Scoreboard-Gerät",
          user_agent: cleanText(request.headers.get("user-agent")).slice(0, 500),
          session_id: /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null,
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        }, { onConflict: "device_id" });
        if (error) throw error;
      }
      return jsonResponse({ ok: true });
    }

    if (action === "logout") {
      const user = await getAuthenticatedUser();
      const settings = await getSettings();
      if (!user?.id || user.id !== settings?.auth_user_id) {
        return jsonResponse({ error: "not-authorized" }, 403);
      }
      const deviceId = cleanText(payload.deviceId);
      if (/^[0-9a-f-]{36}$/i.test(deviceId)) {
        const { error } = await adminClient
          .from("scoreboard_app_devices")
          .update({ revoked_at: new Date().toISOString() })
          .eq("device_id", deviceId);
        if (error) throw error;
      }
      return jsonResponse({ ok: true });
    }

    const admin = await requireAdmin();
    if (!admin) {
      return jsonResponse({ error: "admin-required", message: "Admin-Rechte erforderlich." }, 403);
    }

    if (action === "set-pin") {
      const pin = cleanText(payload.pin);
      if (!/^\d{6}$/.test(pin)) {
        return jsonResponse({ error: "invalid-pin", message: "Der Vereins-PIN muss aus genau sechs Ziffern bestehen." }, 400);
      }
      const technicalUser = await ensureTechnicalUser();
      const { error } = await adminClient.rpc("scoreboard_app_set_pin", {
        pin_value: pin,
        technical_user_id: technicalUser.id,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, configured: true, technicalEmail: TECHNICAL_EMAIL });
    }

    if (action === "revoke-all") {
      const settings = await getSettings();
      if (!settings?.auth_user_id) return jsonResponse({ ok: true, revokedCount: 0 });
      const { data, error } = await adminClient.rpc("scoreboard_app_revoke_all_sessions", {
        technical_user_id: settings.auth_user_id,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, revokedCount: Number(data || 0) });
    }

    if (action === "revoke-device") {
      const sessionId = cleanText(payload.sessionId);
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
        return jsonResponse({ error: "session-required", message: "Keine aktive Gerätesitzung gefunden." }, 400);
      }
      const { data, error } = await adminClient.rpc("scoreboard_app_revoke_device", {
        device_session_id: sessionId,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, revoked: data === true });
    }

    if (action === "status") {
      const settings = await getSettings();
      const { data: devices, error } = await adminClient
        .from("scoreboard_app_devices")
        .select("device_id, device_name, user_agent, session_id, first_seen_at, last_seen_at, revoked_at")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({
        ok: true,
        configured: Boolean(settings?.pin_hash && settings?.auth_user_id),
        technicalEmail: settings?.auth_user_id ? TECHNICAL_EMAIL : "",
        pinUpdatedAt: settings?.pin_updated_at || null,
        lockedUntil: settings?.locked_until || null,
        devices: devices || [],
      });
    }

    return jsonResponse({ error: "unknown-action", message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    console.error("scoreboard-app-auth failed", error);
    return jsonResponse({
      error: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
