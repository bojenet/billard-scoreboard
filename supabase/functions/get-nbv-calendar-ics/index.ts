import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  location: string;
  note: string;
  source: "nbv" | "manual";
  link: string;
  disciplineId: string;
  disciplineLabel: string;
  endDate?: string;
  allDay?: boolean;
};

type CalendarRequest = {
  sourceUrl?: string;
  disciplineId?: string;
  disciplineLabel?: string;
  season?: string;
  disciplines?: Array<{ id: string; label: string }>;
  manual?: string;
};

const NBV_DISCIPLINES: Record<string, string> = {
  "56": "Biathlon",
  "36": "Billard Kegeln",
  "9": "Cadre 35/2",
  "10": "Cadre 47/2",
  "11": "Cadre 52/2",
  "12": "Cadre 71/2",
  "5": "Dreiband (großes Billard)",
  "6": "Dreiband (kleines Billard)",
  "14": "Einband (großes Billard)",
  "13": "Einband (kleines Billard)",
  "31": "Eurokegel",
  "7": "Freie Partie (großes Billard)",
  "8": "Freie Partie (kleines Billard)",
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

async function fetchHtml(url: string): Promise<string> {
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
      return await fetchHtml(url);
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

async function loadDisciplineEvents(
  season: string,
  disciplineId: string,
  disciplineLabel: string,
  sourceUrl?: string,
) {
  const html = await fetchHtmlWithRetry(sourceUrl || buildSourceUrl(season, disciplineId));
  return parseListing(html, disciplineId, disciplineLabel);
}

function escapeIcsText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatUtcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatDateOnly(dateValue: string) {
  return String(dateValue || "").replace(/-/g, "");
}

function addDays(dateValue: string, amount: number) {
  const parts = String(dateValue || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return "";
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + amount);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTimeLocal(dateValue: string, timeValue: string) {
  const compactDate = formatDateOnly(dateValue);
  const compactTime = String(timeValue || "").replace(":", "");
  return `${compactDate}T${compactTime}00`;
}

function foldIcsLine(line: string) {
  const limit = 74;
  if (line.length <= limit) return `${line}\r\n`;
  let remaining = line;
  let output = "";
  while (remaining.length > limit) {
    output += `${remaining.slice(0, limit)}\r\n `;
    remaining = remaining.slice(limit);
  }
  return `${output}${remaining}\r\n`;
}

function buildEventDescription(event: CalendarEvent) {
  const parts = [
    event.disciplineLabel ? `Disziplin: ${event.disciplineLabel}` : "",
    event.note || "",
    event.link ? `NBV Details: ${event.link}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function buildIcs(events: CalendarEvent[], calendarName: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Billard Scoreboard//NBV Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
  ];

  const stamp = formatUtcStamp();
  events.forEach((event) => {
    const description = buildEventDescription(event);
    const uid = `${event.id}@billard-scoreboard`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if ((event as { allDay?: boolean; endDate?: string }).allDay && (event as { endDate?: string }).endDate) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.date)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(addDays((event as { endDate: string }).endDate, 1))}`);
    } else if (event.time) {
      lines.push(`DTSTART;TZID=Europe/Berlin:${formatDateTimeLocal(event.date, event.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.date)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    }
    if (description) {
      lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    }
    if (event.link) {
      lines.push(`URL:${escapeIcsText(event.link)}`);
    }
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("");
}

function getDisciplinesFromRequest(body: CalendarRequest, url: URL) {
  const season = String(body?.season || url.searchParams.get("season") || "2025/2026").trim();
  const disciplineId = String(body?.disciplineId || url.searchParams.get("disciplineId") || "").trim();
  const disciplineLabel = String(body?.disciplineLabel || url.searchParams.get("disciplineLabel") || "").trim();

  if (Array.isArray(body?.disciplines) && body.disciplines.length) {
    return {
      season,
      disciplines: body.disciplines.map((discipline) => ({
        id: String(discipline.id || "").trim(),
        label: String(discipline.label || "").trim(),
      })),
      sourceUrl: String(body?.sourceUrl || "").trim(),
    };
  }

  if (disciplineId) {
    return {
      season,
      disciplines: [{
        id: disciplineId,
        label: disciplineLabel || NBV_DISCIPLINES[disciplineId] || "NBV Kalender",
      }],
      sourceUrl: String(body?.sourceUrl || url.searchParams.get("sourceUrl") || "").trim(),
    };
  }

  return {
    season,
    disciplines: Object.entries(NBV_DISCIPLINES).map(([id, label]) => ({ id, label })),
    sourceUrl: String(body?.sourceUrl || url.searchParams.get("sourceUrl") || "").trim(),
  };
}

function getSeasonDateRange(season: string) {
  const match = String(season || "").trim().match(/^(\d{4})\/(\d{4})$/);
  if (!match) return null;
  return {
    start: `${match[1]}-09-01`,
    end: `${match[2]}-06-30`,
  };
}

async function loadManualEventsFromDatabase(
  season: string,
  disciplineId: string,
): Promise<CalendarEvent[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase environment is not configured for manual ICS events");
  }

  const range = getSeasonDateRange(season);
  if (!range) return [];

  if (disciplineId && disciplineId !== "other") {
    return [];
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from("calendar_manual_events")
    .select("id, date, time, end_date, all_day, title, location, note, discipline_id, discipline_label")
    .gte("date", range.start)
    .lte("date", range.end)
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data)
    ? data
        .filter((event) => event && event.date && event.title)
        .map((event) => ({
          id: String(event.id || `manual-${createEventId(String(event.date), String(event.title))}`),
          date: String(event.date || "").trim(),
          time: String(event.time || "").trim(),
          endDate: String(event.end_date || "").trim(),
          allDay: Boolean(event.all_day),
          title: String(event.title || "").trim(),
          location: String(event.location || "").trim(),
          note: String(event.note || "").trim(),
          source: "manual" as const,
          link: "",
          disciplineId: String(event.discipline_id || "other").trim(),
          disciplineLabel: String(event.discipline_label || "Sonstige").trim(),
        }))
    : [];
}

function decodeManualEvents(payload: string | null): CalendarEvent[] {
  if (!payload) return [];

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((event) => event && event.date && event.title)
      .map((event) => ({
        id: String(event.id || `manual-${createEventId(String(event.date), String(event.title))}`),
        date: String(event.date || "").trim(),
        time: String(event.time || "").trim(),
        endDate: String(event.endDate || "").trim(),
        allDay: Boolean(event.allDay),
        title: String(event.title || "").trim(),
        location: String(event.location || "").trim(),
        note: String(event.note || "").trim(),
        source: "nbv" as const,
        link: "",
        disciplineId: String(event.disciplineId || "").trim(),
        disciplineLabel: String(event.disciplineLabel || "Allgemein").trim(),
      }));
  } catch (error) {
    console.warn("Manual ICS events could not be decoded", error);
    return [];
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const body = request.method === "POST"
      ? await request.json().catch(() => ({})) as CalendarRequest
      : {} as CalendarRequest;

    const { season, disciplines, sourceUrl } = getDisciplinesFromRequest(body, url);
    const events: CalendarEvent[] = [];
    const failedDisciplines: Array<{ id: string; label: string; message: string }> = [];
    const manualEventsFromUrl = decodeManualEvents(body?.manual || url.searchParams.get("manual"));

    for (const [index, discipline] of disciplines.entries()) {
      try {
        const disciplineEvents = await loadDisciplineEvents(
          season,
          discipline.id,
          discipline.label,
          index === 0 && sourceUrl ? sourceUrl : undefined,
        );
        events.push(...disciplineEvents);
      } catch (error) {
        failedDisciplines.push({
          id: discipline.id,
          label: discipline.label,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await delay(120);
    }

    if (!events.length && failedDisciplines.length) {
      throw new Error(`NBV-ICS-Abruf fehlgeschlagen: ${failedDisciplines[0].label} - ${failedDisciplines[0].message}`);
    }

    const selectedDisciplineId = disciplines.length === 1 ? disciplines[0].id : "";
    let manualEvents: CalendarEvent[] = [];
    try {
      manualEvents = await loadManualEventsFromDatabase(season, selectedDisciplineId);
    } catch (error) {
      console.warn("Manual ICS events could not be loaded from database", error);
    }

    const manualEventMap = new Map<string, CalendarEvent>();
    [...manualEventsFromUrl, ...manualEvents].forEach((event) => {
      if (event?.id && event?.date && event?.title) {
        manualEventMap.set(event.id, event);
      }
    });

    events.push(...manualEventMap.values());

    events.sort((left, right) => {
      const leftKey = `${left.date} ${left.time || "99:99"} ${left.title}`;
      const rightKey = `${right.date} ${right.time || "99:99"} ${right.title}`;
      return leftKey.localeCompare(rightKey, "de");
    });

    const singleDiscipline = disciplines.length === 1 ? disciplines[0].label : "Alle Disziplinen";
    const calendarName = `NBV Karambol/Kegel ${singleDiscipline} ${season}`;
    const ics = buildIcs(events, calendarName);

    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="nbv-kalender-${disciplines.length === 1 ? disciplines[0].id : "all"}.ics"`,
        "Cache-Control": "public, max-age=900",
        "X-NBV-Failed-Disciplines": String(failedDisciplines.length),
      },
    });
  } catch (error) {
    console.error("get-nbv-calendar-ics failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: "nbv-calendar-ics-failed",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
