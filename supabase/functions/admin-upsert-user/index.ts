import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UserPayload = {
  action?: string;
  user_id?: string;
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  position_library_access?: string;
  training_access?: string;
  tournament_access?: string;
  calendar_access?: string;
  stream_overlay_access?: boolean;
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

function normalizeRole(value: unknown) {
  return cleanText(value) === "admin" ? "admin" : "member";
}

function normalizeAccess(value: unknown) {
  const text = cleanText(value);
  return ["hidden", "read", "edit"].includes(text) ? text : "edit";
}

function normalizeBooleanAccess(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = cleanText(value).toLowerCase();
  return !["false", "0", "no", "nein", "hidden", "disabled"].includes(text);
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "service-role-missing" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = request.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return jsonResponse({ error: "not-authenticated" }, 401);
    }

    const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
    const requester = authData?.user;
    if (authError || !requester?.id) {
      return jsonResponse({ error: "not-authenticated" }, 401);
    }

    const metadataRole = cleanText(
      requester.app_metadata?.role || requester.user_metadata?.role,
    );
    const { data: requesterRole, error: requesterRoleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", requester.id)
      .maybeSingle();

    const requesterIsAdmin = metadataRole === "admin" || requesterRole?.role === "admin";
    if (requesterRoleError || !requesterIsAdmin) {
      return jsonResponse({
        error: "admin-required",
        message: requesterRoleError?.message || "Admin-Rechte erforderlich.",
      }, 403);
    }

    const payload = (await request.json()) as UserPayload;
    const action = cleanText(payload.action) === "delete" ? "delete" : "upsert";
    const userId = cleanText(payload.user_id);
    if (action === "delete") {
      if (!userId) {
        return jsonResponse({ error: "user-id-required", message: "User-ID ist erforderlich." }, 400);
      }
      if (userId === requester.id) {
        return jsonResponse({ error: "cannot-delete-self", message: "Du kannst deinen eigenen Admin-User hier nicht löschen." }, 400);
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) {
        return jsonResponse({ error: "auth-delete-failed", message: error.message }, 400);
      }
      return jsonResponse({ deleted_user_id: userId });
    }

    const email = cleanText(payload.email).toLowerCase();
    const password = cleanText(payload.password);
    const firstName = cleanText(payload.first_name);
    const lastName = cleanText(payload.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const role = normalizeRole(payload.role);
    const positionLibraryAccess = normalizeAccess(payload.position_library_access);
    const trainingAccess = normalizeAccess(payload.training_access);
    const tournamentAccess = normalizeAccess(payload.tournament_access);
    const calendarAccess = normalizeAccess(payload.calendar_access);
    const streamOverlayAccess = normalizeBooleanAccess(payload.stream_overlay_access);

    if (!email) {
      return jsonResponse({ error: "email-required", message: "E-Mail ist erforderlich." }, 400);
    }
    if (!firstName || !lastName) {
      return jsonResponse({ error: "name-required", message: "Vorname und Nachname sind erforderlich." }, 400);
    }
    if (!userId && password.length < 6) {
      return jsonResponse({ error: "password-required", message: "Passwort muss mindestens 6 Zeichen haben." }, 400);
    }
    if (userId && password && password.length < 6) {
      return jsonResponse({ error: "password-too-short", message: "Passwort muss mindestens 6 Zeichen haben." }, 400);
    }
    if (!userId) {
      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (existingProfileError) {
        return jsonResponse({ error: "email-check-failed", message: existingProfileError.message }, 400);
      }
      if (existingProfile?.id) {
        return jsonResponse({ error: "email-already-exists", message: "Diese Login E-Mail existiert bereits." }, 400);
      }
    }

    const userMeta = {
      first_name: firstName,
      last_name: lastName,
      display_name: fullName,
      full_name: fullName,
    };

    let targetUserId = userId;
    if (targetUserId) {
      const updates: {
        email: string;
        user_metadata: Record<string, string>;
        password?: string;
      } = {
        email,
        user_metadata: userMeta,
      };
      if (password) updates.password = password;

      const { data, error } = await adminClient.auth.admin.updateUserById(targetUserId, updates);
      if (error) {
        return jsonResponse({ error: "auth-update-failed", message: error.message }, 400);
      }
      targetUserId = data.user.id;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMeta,
      });
      if (error) {
        const message = String(error.message || "");
        if (message.toLowerCase().includes("already") || message.toLowerCase().includes("registered")) {
          return jsonResponse({ error: "email-already-exists", message: "Diese Login E-Mail existiert bereits." }, 400);
        }
        return jsonResponse({ error: "auth-create-failed", message: error.message }, 400);
      }
      targetUserId = data.user.id;
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert([{
        id: targetUserId,
        email,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
      }], { onConflict: "id" });

    if (profileError) {
      return jsonResponse({ error: "profile-save-failed", message: profileError.message }, 400);
    }

    let { error: roleError } = await adminClient
      .from("user_roles")
      .upsert([{
        user_id: targetUserId,
        role,
        position_library_access: positionLibraryAccess,
        training_access: trainingAccess,
        tournament_access: tournamentAccess,
        calendar_access: calendarAccess,
        stream_overlay_access: streamOverlayAccess,
      }], { onConflict: "user_id" });

    if (roleError && String(roleError.message || "").toLowerCase().includes("stream_overlay_access")) {
      const fallback = await adminClient
        .from("user_roles")
        .upsert([{
          user_id: targetUserId,
          role,
          position_library_access: positionLibraryAccess,
          training_access: trainingAccess,
          tournament_access: tournamentAccess,
          calendar_access: calendarAccess,
        }], { onConflict: "user_id" });
      roleError = fallback.error;
    }

    if (roleError) {
      return jsonResponse({ error: "role-save-failed", message: roleError.message }, 400);
    }

    return jsonResponse({ user_id: targetUserId });
  } catch (error) {
    return jsonResponse({
      error: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
