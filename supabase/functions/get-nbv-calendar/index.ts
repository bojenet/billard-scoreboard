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
  disciplineId: string;
  disciplineLabel: string;
};

type CalendarRequest = {
  sourceUrl?: string;
  disciplineId?: string;
  disciplineLabel?: string;
  season?: string;
  disciplines?: Array<{ id: string; label: string }>;
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

function buildSourceUrl(season: string, disciplineId: string) {
  return `https://www.ndbv.de/sb_meisterschaft.php?p=20--${season}---${disciplineId}-1--100000--`;
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

function parseListing(
  html: string,
  disciplineId: string,
  disciplineLabel: string,
): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  const rowRegex = /<tr class='(?:odd|even)'>[\s\S]*?<td class='bb1' align='center'>\d+<\/td><td class='bb1' align='center'>([^<]+)<\/td><td class='bb1'[^>]*><a href='([^']+)'[^>]*title='([^']+)'[\s\S]*?<\/a><br>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const date = parseGermanDateToIso(match[1]);
    const link = new URL(match[2], "https://www.ndbv.de/").toString();
    const title = stripTags(match[3]);
    const location = stripTags(match[4]);
    if (!date || !title) continue;
    result.push({
      id: `${createEventId(date, title)}-${disciplineId}`,
      date,
      time: "",
      title,
      location,
      note: "Importiert aus NBV Einzelkalender",
      source: "nbv",
      link,
      disciplineId,
      disciplineLabel,
    });
  }

  return result;
}

async function loadDisciplineEvents(season: string, disciplineId: string, disciplineLabel: string, sourceUrl?: string) {
  const html = await fetchHtml(sourceUrl || buildSourceUrl(season, disciplineId));
  const events = parseListing(html, disciplineId, disciplineLabel);
  return events;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) as CalendarRequest : {};
    const season = String(body?.season || "2025/2026").trim();
    const requestedDisciplines = Array.isArray(body?.disciplines) && body.disciplines.length
      ? body.disciplines
      : [{
          id: String(body?.disciplineId || "8").trim(),
          label: String(body?.disciplineLabel || "Freie Partie (kleines Billard)").trim(),
        }];

    const allEvents = await Promise.all(requestedDisciplines.map((discipline, index) =>
      loadDisciplineEvents(
        season,
        String(discipline.id || "").trim(),
        String(discipline.label || "").trim(),
        index === 0 && body?.sourceUrl ? String(body.sourceUrl).trim() : undefined,
      )
    ));

    const events = allEvents.flat().sort((left, right) => {
      const leftKey = `${left.date} ${left.title}`;
      const rightKey = `${right.date} ${right.title}`;
      return leftKey.localeCompare(rightKey, "de");
    });

    return new Response(JSON.stringify({ events, season, disciplineCount: requestedDisciplines.length }), {
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
