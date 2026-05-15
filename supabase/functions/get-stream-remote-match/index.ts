import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StreamRemoteRequest = {
  session?: string;
  token?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as StreamRemoteRequest;
    const sessionId = String(body?.session || "").trim();
    const token = String(body?.token || "").trim();

    if (!sessionId || !token) {
      return new Response(JSON.stringify({ error: "session-and-token-required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "service-role-missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin
      .from("training_remote_match_sessions")
      .select("id,host_name,guest_name,host_discipline,guest_discipline,target_points,status,host_score,guest_score,host_innings,guest_innings,host_high,guest_high,host_series,guest_series,host_position_index,guest_position_index,challenge_positions,finish_mode")
      .eq("id", sessionId)
      .eq("stream_token", token)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({
        error: "query-failed",
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!data) {
      return new Response(JSON.stringify({ error: "not-found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ session: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
