import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StreamRequest = {
  match?: string;
  token?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as StreamRequest;
    const matchId = String(body?.match || "").trim();
    const token = String(body?.token || "").trim();

    if (!matchId || !token) {
      console.error("get-stream-match missing params", { matchId, tokenPresent: Boolean(token) });
      return new Response(
        JSON.stringify({ error: "match-and-token-required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("get-stream-match service role missing", {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      });
      return new Response(
        JSON.stringify({ error: "service-role-missing" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin
      .from("matches")
      .select("id,player1,player2,discipline1,discipline2,target1,target2,score1,score2,inn1,inn2,totalInnings,activePlayer,series1,series2,high1,high2,maxInnings,finished,status")
      .eq("id", matchId)
      .eq("stream_token", token)
      .maybeSingle();

    if (error) {
      console.error("get-stream-match query failed", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        matchId,
        tokenLength: token.length,
      });
      return new Response(
        JSON.stringify({
          error: "query-failed",
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!data) {
      console.error("get-stream-match not found", { matchId, tokenLength: token.length });
      return new Response(
        JSON.stringify({ error: "not-found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ match: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get-stream-match unexpected error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error: "unexpected-error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
