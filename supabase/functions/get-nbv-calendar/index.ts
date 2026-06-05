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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /refused stream|http2 error|sendrequest|connection reset|network|tempor/i.test(message);
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
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

async function fetchHtmlWithRetry(url: string, maxAttempts = 4) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchHtml(url, attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error;
      }
      await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  const html = await fetchHtmlWithRetry(sourceUrl || buildSourceUrl(season, disciplineId));
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

    const events: CalendarEvent[] = [];
    const failedDisciplines: Array<{ id: string; label: string; message: string }> = [];

    for (const [index, discipline] of requestedDisciplines.entries()) {
      const disciplineId = String(discipline.id || "").trim();
      const disciplineLabel = String(discipline.label || "").trim();
      try {
        const disciplineEvents = await loadDisciplineEvents(
          season,
          disciplineId,
          disciplineLabel,
          index === 0 && body?.sourceUrl ? String(body.sourceUrl).trim() : undefined,
        );
        events.push(...disciplineEvents);
      } catch (error) {
        failedDisciplines.push({
          id: disciplineId,
          label: disciplineLabel,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await delay(120);
    }

    if (!events.length && failedDisciplines.length) {
      throw new Error(`NBV-Abruf fehlgeschlagen: ${failedDisciplines[0].label} - ${failedDisciplines[0].message}`);
    }

    events.sort((left, right) => {
      const leftKey = `${left.date} ${left.title}`;
      const rightKey = `${right.date} ${right.title}`;
      return leftKey.localeCompare(rightKey, "de");
    });

    return new Response(JSON.stringify({
      events,
      season,
      disciplineCount: requestedDisciplines.length,
      failedDisciplines,
    }), {
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
