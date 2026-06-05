const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  location: string;
  note: string;
  source: "nbv";
  link: string;
};

type CalendarRequest = {
  sourceUrl?: string;
  disciplineId?: string;
  disciplineLabel?: string;
  season?: string;
};

function parseGermanDateToIso(value: string) {
  const match = String(value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function stripTags(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&auml;/gi, "ä")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&szlig;/gi, "ß")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseTimeFromDetailHtml(detailHtml: string) {
  const timeMatch = detailHtml.match(/Spielbeginn am\s+\d{2}\.\d{2}\.\d{4}\s+um\s+(\d{2}:\d{2})\s+Uhr/i);
  return timeMatch ? timeMatch[1] : "";
}

function createEventId(date: string, title: string) {
  return `nbv-${date}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "billard-scoreboard-calendar/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`NBV request failed with HTTP ${response.status}`);
  }

  return await response.text();
}

function parseListing(html: string): Array<{ date: string; title: string; location: string; link: string }> {
  const result: Array<{ date: string; title: string; location: string; link: string }> = [];
  const rowRegex = /<tr class='(?:odd|even)'>[\s\S]*?<td class='bb1' align='center'>\d+<\/td><td class='bb1' align='center'>([^<]+)<\/td><td class='bb1'[^>]*><a href='([^']+)'[^>]*title='([^']+)'[\s\S]*?<\/a><br>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const date = parseGermanDateToIso(match[1]);
    const link = new URL(match[2], "https://www.ndbv.de/").toString();
    const title = stripTags(match[3]);
    const location = stripTags(match[4]);
    if (!date || !title) continue;
    result.push({ date, title, location, link });
  }

  return result;
}

async function enrichEvents(rows: Array<{ date: string; title: string; location: string; link: string }>) {
  const events: CalendarEvent[] = [];

  for (const row of rows) {
    let time = "";
    try {
      const detailHtml = await fetchHtml(row.link);
      time = parseTimeFromDetailHtml(detailHtml);
    } catch (error) {
      console.warn("NBV detail fetch failed", { link: row.link, error: error instanceof Error ? error.message : String(error) });
    }

    events.push({
      id: createEventId(row.date, row.title),
      date: row.date,
      time,
      title: row.title,
      location: row.location,
      note: "Importiert aus NBV Einzelkalender",
      source: "nbv",
      link: row.link,
    });
  }

  return events;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) as CalendarRequest : {};
    const sourceUrl = String(body?.sourceUrl || "https://www.ndbv.de/sb_meisterschaft.php?p=20--2025/2026---8-1--100000--").trim();
    const disciplineId = String(body?.disciplineId || "8").trim();
    const disciplineLabel = String(body?.disciplineLabel || "Freie Partie (kleines Billard)").trim();
    const season = String(body?.season || "2025/2026").trim();

    const html = await fetchHtml(sourceUrl);
    const rows = parseListing(html);
    const events = await enrichEvents(rows);

    return new Response(JSON.stringify({ events, sourceUrl, disciplineId, disciplineLabel, season }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get-nbv-calendar failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: "nbv-calendar-failed",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
