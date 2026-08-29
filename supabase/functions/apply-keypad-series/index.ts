import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };

function seriesArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Math.max(0, Number(item || 0)));
}

function finishedAfter(state: Record<string, number>): boolean {
  const { score1, score2, inn1, inn2, target1, target2, maxInnings } = state;
  if (inn1 === inn2) {
    if (target1 > 0 && score1 >= target1 && score2 < target2) return true;
    if (target2 > 0 && score2 >= target2 && score1 < target1) return true;
    if (target1 > 0 && target2 > 0 && score1 >= target1 && score2 >= target2) return true;
    if (maxInnings > 0 && inn1 >= maxInnings) return true;
  }
  return false;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method-not-allowed" }), { status: 405, headers: jsonHeaders });
  }

  const configuredSecret = Deno.env.get("BILLARD_KEYPAD_SECRET") || "";
  const suppliedSecret = request.headers.get("x-keypad-secret") || "";
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const body = await request.json();
    const table = String(body?.table || "").trim().toLowerCase();
    const requestId = String(body?.requestId || "").trim();
    const points = Math.max(0, Math.min(9999, Math.trunc(Number(body?.points || 0))));
    if (!["tisch1", "tisch2"].includes(table) || !Number.isFinite(points) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return new Response(JSON.stringify({ error: "invalid-input" }), { status: 400, headers: jsonHeaders });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: match, error: loadError } = await admin
      .from("matches")
      .select("*")
      .eq("display_table", table)
      .eq("status", 1)
      .eq("finished", false)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loadError) throw loadError;
    if (!match) {
      return new Response(JSON.stringify({ error: "active-match-not-found" }), { status: 404, headers: jsonHeaders });
    }
    if (String(match.last_keypad_request_id || "") === requestId) {
      return new Response(JSON.stringify({ ok: true, matchId: match.id, duplicate: true }), { status: 200, headers: jsonHeaders });
    }

    let score1 = Number(match.score1 || 0);
    let score2 = Number(match.score2 || 0);
    let inn1 = Number(match.inn1 || 0);
    let inn2 = Number(match.inn2 || 0);
    let high1 = Number(match.high1 || 0);
    let high2 = Number(match.high2 || 0);
    let totalInnings = Number(match.totalInnings || 1);
    const activePlayer = Number(match.activePlayer || 1);
    const target1 = Number(match.target1 || 0);
    const target2 = Number(match.target2 || 0);
    const appliedPoints = activePlayer === 1 && target1 > 0
      ? Math.min(points, Math.max(0, target1 - score1))
      : activePlayer === 2 && target2 > 0
      ? Math.min(points, Math.max(0, target2 - score2))
      : points;
    const log1 = seriesArray(match.series_log1);
    const log2 = seriesArray(match.series_log2);

    if (activePlayer === 1) {
      score1 += appliedPoints;
      high1 = Math.max(high1, appliedPoints);
      log1.push(appliedPoints);
      inn1 += 1;
    } else {
      score2 += appliedPoints;
      high2 = Math.max(high2, appliedPoints);
      log2.push(appliedPoints);
      inn2 += 1;
      totalInnings += 1;
    }

    const nextActivePlayer = activePlayer === 1 ? 2 : 1;
    const finished = finishedAfter({ score1, score2, inn1, inn2, target1, target2, maxInnings: Number(match.maxInnings || 0) });
    const update: Record<string, unknown> = {
      score1, score2, inn1, inn2, high1, high2, totalInnings,
      activePlayer: nextActivePlayer,
      series1: 0,
      series2: 0,
      finished,
      last_keypad_request_id: requestId,
    };
    if (Object.prototype.hasOwnProperty.call(match, "series_log1")) {
      update.series_log1 = log1;
      update.series_log2 = log2;
    }
    if (Object.prototype.hasOwnProperty.call(match, "shot_clock_running")) {
      update.shot_clock_running = false;
      update.shot_clock_started_at = null;
      update.shot_clock_remaining_seconds = 40;
    }

    const { error: updateError } = await admin.from("matches").update(update).eq("id", match.id);
    if (updateError) throw updateError;
    return new Response(JSON.stringify({ ok: true, matchId: match.id, points: appliedPoints }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    console.error("apply-keypad-series failed", error);
    return new Response(JSON.stringify({ error: "update-failed" }), { status: 500, headers: jsonHeaders });
  }
});
