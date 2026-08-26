import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.10.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReminderRow = {
  id: string;
  event_id: string;
  event_date: string;
  reminder_date: string;
  days_before: number;
  title: string;
  location: string;
  link: string;
  message_text: string;
  status: string;
};

type RecipientRow = {
  name: string;
  email: string;
  recipient_group: string;
  delivery_type?: string;
};

type CalendarSettingsRow = {
  source_url?: string;
  season?: string;
  invitation_auto_send_enabled?: boolean;
  invitation_auto_send_days_before?: number;
  invitation_auto_send_time?: string;
  invitation_auto_send_frequency?: string;
  invitation_auto_send_last_run_at?: string;
  invitation_auto_send_limit?: number;
};

type CalendarEvent = {
  id?: string;
  date?: string;
  time?: string;
  title?: string;
  location?: string;
  link?: string;
  disciplineId?: string;
  disciplineLabel?: string;
};

type InvitationDetails = {
  tournament?: string;
  date?: string;
  startTime?: string;
  deadline?: string;
  locationName?: string;
  locationAddress?: string[];
  discipline?: string;
  category?: string;
  tournamentType?: string;
};

type RequestPayload = {
  dryRun?: boolean;
  limit?: number;
  reminderId?: string;
  testEmail?: string;
  directInvitation?: {
    id?: string;
    eventId?: string;
    eventDate?: string;
    title?: string;
    location?: string;
    link?: string;
    pdfFilename?: string;
    pdfBase64?: string;
  };
};

const NBV_DISCIPLINES = {
  "33": "5-Kegel",
  "56": "Biathlon",
  "36": "Billard Kegeln",
  "57": "BK2K",
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

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWhitespace(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function todayIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function berlinTimeHHmm() {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: [get("year"), get("month"), get("day")].filter(Boolean).join("-"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function normalizeTimeSetting(value: unknown, fallback = "08:00") {
  const text = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeFrequencySetting(value: unknown) {
  const text = cleanText(value);
  return ["daily", "hourly", "every_15_minutes"].includes(text) ? text : "daily";
}

function isTimeReached(currentTime: string, configuredTime: string) {
  return currentTime >= configuredTime;
}

function isFrequencyRunDue(lastRunValue: unknown, frequency: string) {
  const lastRunText = cleanText(lastRunValue);
  if (!lastRunText) return true;
  const lastRun = new Date(lastRunText);
  if (Number.isNaN(lastRun.getTime())) return true;
  const now = new Date();
  if (frequency === "every_15_minutes") {
    return now.getTime() - lastRun.getTime() >= 14 * 60 * 1000;
  }
  const nowParts = berlinParts(now);
  const lastParts = berlinParts(lastRun);
  if (frequency === "hourly") {
    return nowParts.date !== lastParts.date || nowParts.hour !== lastParts.hour;
  }
  return nowParts.date !== lastParts.date;
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatGermanDate(value: string) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatShortGermanDate(value: string) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getSeasonFromDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function normalizeSeasonKey(value: unknown) {
  const years = cleanText(value).match(/\d{4}/g) || [];
  return years.length >= 2 ? `${years[0]}-${years[1]}` : cleanText(value).replace(/\D+/g, "-");
}

function cleanFilenamePart(value: string) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function buildPdfFilename(reminder: ReminderRow) {
  const title = cleanFilenamePart(reminder.title) || "Turnier";
  const season = getSeasonFromDate(reminder.event_date);
  return ["Ausschreibung", title, season].filter(Boolean).join(" - ") + ".pdf";
}

function buildAutoReminderId(event: CalendarEvent) {
  const source = cleanText(event.id || event.link || `${event.date}-${event.title}`)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `auto-invitation-${source}`.slice(0, 220);
}

function buildReminderMessage(event: CalendarEvent) {
  const lines = [
    "NBV Ausschreibung",
    "",
    cleanText(event.title),
    `Termin: ${formatGermanDate(cleanText(event.date || ""))}`,
    event.time ? `Beginn: ${cleanText(event.time)} Uhr` : "",
    event.location ? `Ort: ${cleanText(event.location)}` : "",
    "",
    "Ausschreibung / Details:",
    cleanText(event.link),
  ];
  return lines.filter((line, index) => line || index === 1 || index === 6).join("\n").trim();
}

function buildAutoReminderPayload(event: CalendarEvent, daysBefore: number) {
  const eventDate = cleanText(event.date || "");
  const reminderDate = addDaysIso(eventDate, -daysBefore);
  if (!eventDate || !reminderDate || !cleanText(event.title) || !cleanText(event.link)) return null;
  return {
    id: buildAutoReminderId(event),
    event_id: cleanText(event.id || event.link || ""),
    event_date: eventDate,
    reminder_date: reminderDate,
    days_before: daysBefore,
    title: cleanText(event.title),
    location: cleanText(event.location || ""),
    link: cleanText(event.link || ""),
    message_text: buildReminderMessage(event),
    status: "open",
    updated_at: new Date().toISOString(),
  };
}

async function syncAutoRemindersFromCalendar(
  supabaseUrl: string,
  serviceRoleKey: string,
  adminClient: ReturnType<typeof createClient>,
  settings: CalendarSettingsRow,
  daysBefore: number,
) {
  const season = cleanText(settings.season || "");
  if (!season) return { syncedCount: 0, skippedSentCount: 0, calendarEventCount: 0, failedDisciplines: [] };
  const calendarResponse = await fetch(`${supabaseUrl}/functions/v1/get-nbv-calendar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      season,
      sourceUrl: cleanText(settings.source_url || ""),
      disciplines: Object.entries(NBV_DISCIPLINES).map(([id, label]) => ({ id, label })),
    }),
  });
  const calendarData = await calendarResponse.json().catch(() => ({}));
  if (!calendarResponse.ok) {
    throw new Error(cleanText(calendarData?.message || calendarData?.error || `NBV-Kalender Sync fehlgeschlagen (${calendarResponse.status})`));
  }
  const events = Array.isArray(calendarData?.events) ? calendarData.events as CalendarEvent[] : [];
  const payloads = events
    .map((event) => buildAutoReminderPayload(event, daysBefore))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const failedDisciplines = Array.isArray(calendarData?.failedDisciplines) ? calendarData.failedDisciplines : [];
  const ids = payloads.map((row) => String(row.id || ""));
  const eventIds = Array.from(new Set(payloads.map((row) => String(row.event_id || "")).filter(Boolean)));
  let existingRows: Array<{ id?: string; event_id?: string; status?: string }> = [];
  if (eventIds.length) {
    const { data, error: existingError } = await adminClient
      .from("calendar_club_reminders")
      .select("id, event_id, status")
      .in("event_id", eventIds);
    if (existingError) throw existingError;
    existingRows = data || [];
  }
  const sentEventIds = new Set((existingRows || [])
    .filter((row: { id?: string; status?: string }) => String(row.status || "") === "sent")
    .map((row: { event_id?: string }) => String(row.event_id || "")));
  const writablePayloads = payloads.filter((row) => !sentEventIds.has(String(row.event_id || "")));
  if (writablePayloads.length) {
    const { error: upsertError } = await adminClient
      .from("calendar_club_reminders")
      .upsert(writablePayloads, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }

  // A moved or deleted ClubCloud event can receive a new calendar ID. The old
  // reminder then no longer gets overwritten and would otherwise still be sent.
  // Only retire stale reminders after a complete calendar load; on partial
  // discipline failures the absence of an event is not reliable evidence.
  let skippedStaleCount = 0;
  if (!failedDisciplines.length) {
    const { data: openAutoRows, error: openAutoError } = await adminClient
      .from("calendar_club_reminders")
      .select("id, event_date")
      .eq("status", "open")
      .eq("days_before", daysBefore)
      .like("id", "auto-invitation-%");
    if (openAutoError) throw openAutoError;
    const currentIds = new Set(ids);
    const staleIds = (openAutoRows || [])
      .filter((row: { id?: string; event_date?: string }) =>
        normalizeSeasonKey(getSeasonFromDate(cleanText(row.event_date || ""))) === normalizeSeasonKey(season) &&
        !currentIds.has(cleanText(row.id || "")))
      .map((row: { id?: string }) => cleanText(row.id || ""))
      .filter(Boolean);
    if (staleIds.length) {
      const { data: skippedRows, error: skipError } = await adminClient
        .from("calendar_club_reminders")
        .update({
          status: "skipped",
          sent_by_name: "Automatisch deaktiviert: Termin geändert oder entfernt",
          updated_at: new Date().toISOString(),
        })
        .in("id", staleIds)
        .eq("status", "open")
        .select("id");
      if (skipError) throw skipError;
      skippedStaleCount = skippedRows?.length || 0;
    }
  }
  return {
    syncedCount: writablePayloads.length,
    skippedSentCount: sentEventIds.size,
    skippedStaleCount,
    calendarEventCount: events.length,
    failedDisciplines,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: "\"",
    lt: "<",
    gt: ">",
    nbsp: " ",
    auml: "ä",
    Auml: "Ä",
    ouml: "ö",
    Ouml: "Ö",
    uuml: "ü",
    Uuml: "Ü",
    szlig: "ß",
    eacute: "é",
    Eacute: "É",
  };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity);
    if (key[0] === "#") {
      const code = key.toLowerCase().startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] || match;
  });
}

function textFromHtml(value: string) {
  return normalizeWhitespace(decodeHtmlEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ));
}

function extractDetailCell(html: string, label: string) {
  const pattern = new RegExp(`<tr[^>]*>\\s*<td[^>]*>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const match = html.match(pattern);
  return match ? textFromHtml(match[1]) : "";
}

function getStartTimeFromText(value: string) {
  const match = String(value || "").match(/\bum\s*(\d{1,2}:\d{2})\s*Uhr/i);
  return match ? match[1].padStart(5, "0") : "";
}

function getDateFromText(value: string) {
  const match = String(value || "").match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
  return match ? match[1] : "";
}

function getStartTimeFromMessage(value: string) {
  const match = String(value || "").match(/Beginn:\s*(\d{1,2}:\d{2})\s*Uhr/i);
  return match ? match[1].padStart(5, "0") : "";
}

async function fetchInvitationDetails(link: string): Promise<InvitationDetails> {
  if (!link) return {};
  const url = link.startsWith("http") ? link : `https://www.ndbv.de/${link.replace(/^\/+/, "")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "billard-studio-calendar/1.0 (+https://www.billard-studio.de)" },
      signal: controller.signal,
    });
    if (!response.ok) return {};
    const html = await response.text();
    const dateText = extractDetailCell(html, "Datum");
    const locationLines = extractDetailCell(html, "Location").split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      tournament: extractDetailCell(html, "Turnier"),
      date: getDateFromText(dateText),
      startTime: getStartTimeFromText(dateText),
      deadline: getDateFromText(extractDetailCell(html, "Meldeschluss")),
      locationName: locationLines[0] || "",
      locationAddress: locationLines.slice(1),
      discipline: extractDetailCell(html, "Disziplin"),
      category: extractDetailCell(html, "Kategorie"),
      tournamentType: extractDetailCell(html, "Meisterschaftstyp"),
    };
  } catch (_error) {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

async function assertInvocationAllowed(request: Request, supabaseUrl: string, serviceRoleKey: string, requireAdminCenter = false) {
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const providedSecret = request.headers.get("x-cron-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!requireAdminCenter && cronSecret && providedSecret === cronSecret) return;
  if (!requireAdminCenter && !cronSecret) return;

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token && token !== cronSecret) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await adminClient.auth.getUser(token);
    const userId = userData?.user?.id || "";
    if (userId) {
      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role, calendar_access, admin_center_access")
        .eq("user_id", userId)
        .maybeSingle();
      const role = String(roleRow?.role || "").toLowerCase();
      const calendarAccess = String(roleRow?.calendar_access || "").toLowerCase();
      if (requireAdminCenter && (role === "admin" || roleRow?.admin_center_access === true)) return;
      if (!requireAdminCenter && (role === "admin" || calendarAccess === "edit" || roleRow?.admin_center_access === true)) return;
    }
  }
  throw new Error("Nicht autorisiert.");
}

function buildTransport() {
  const host = (Deno.env.get("INVITATION_SMTP_HOST") || Deno.env.get("SMTP_HOST") || "mail.gmx.net").replace(/^smtp:\/\//i, "");
  const port = Number(Deno.env.get("INVITATION_SMTP_PORT") || Deno.env.get("SMTP_PORT") || "465");
  const user = Deno.env.get("INVITATION_SMTP_USER") || Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("INVITATION_SMTP_PASS") || Deno.env.get("SMTP_PASS");

  if (!user || !pass) {
    throw new Error("Fehlende Secrets: INVITATION_SMTP_USER/INVITATION_SMTP_PASS oder SMTP_USER/SMTP_PASS.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function buildInvitationPdf(reminder: ReminderRow) {
  const details = await fetchInvitationDetails(reminder.link);
  const title = cleanText(details.tournament || reminder.title);
  const discipline = cleanText(details.discipline || "");
  const seenTypeParts = new Set<string>();
  const typeParts = [details.tournamentType, details.category]
    .map(cleanText)
    .filter(Boolean)
    .filter((value) => {
      const comparisonKey = value
        .toLocaleLowerCase("de-DE")
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9äöüß]+/gi, " ")
        .trim();
      if (seenTypeParts.has(comparisonKey)) return false;
      seenTypeParts.add(comparisonKey);
      return true;
    });
  const locationName = cleanText(details.locationName || reminder.location || "");
  const locationLines = [locationName, ...(details.locationAddress || [])].filter(Boolean);
  const startTime = cleanText(details.startTime || getStartTimeFromMessage(reminder.message_text));
  const deadline = cleanText(details.deadline || "");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  const green = rgb(0, 0.38, 0.13);
  const text = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.35, 0.4, 0.46);
  const line = rgb(0.78, 0.82, 0.87);
  const soft = rgb(0.97, 0.98, 0.99);

  const drawText = (value: string, x: number, y: number, size: number, options: { isBold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(value, {
      x,
      y,
      size,
      font: options.isBold ? bold : font,
      color: options.color || text,
    });
  };

  const getTextFont = (isBold = false) => isBold ? bold : font;

  const drawCenteredText = (value: string, centerX: number, y: number, size: number, options: { isBold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    const activeFont = getTextFont(Boolean(options.isBold));
    const width = activeFont.widthOfTextAtSize(value, size);
    drawText(value, centerX - width / 2, y, size, options);
  };

  const wrapByWidth = (value: string, maxWidth: number, size: number, isBold = false) => {
    const activeFont = getTextFont(isBold);
    const words = cleanText(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    const fits = (line: string) => activeFont.widthOfTextAtSize(line, size) <= maxWidth;
    const pushLongWord = (word: string) => {
      let chunk = "";
      for (const char of word) {
        const next = `${chunk}${char}`;
        if (chunk && !fits(next)) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = next;
        }
      }
      return chunk;
    };
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (fits(next)) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = fits(word) ? word : pushLongWord(word);
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  const drawFooter = () => {
    page.drawLine({ start: { x: 48, y: 62 }, end: { x: 547, y: 62 }, thickness: 0.8, color: muted });
    drawText("Norddeutscher Billard Verband e.V. (NBV)", 48, 42, 8, { color: muted });
    drawText(`Stand: ${formatGermanDate(todayIso()).replace(/^\S+,\s*/, "")}`, 465, 42, 8, { color: muted });
  };

  const drawDocumentHeader = (pageNumber: number) => {
    drawText("NBV", 48, 770, 28, { isBold: true, color: green });
    page.drawLine({ start: { x: 112, y: 762 }, end: { x: 112, y: 792 }, thickness: 1, color: muted });
    drawText("Turnierausschreibung", 130, 786, 13);
    drawText("Karambolage/Kegel", 130, 767, 13);
    drawText(`Seite ${pageNumber}`, 500, 786, 10, { color: muted });
    page.drawLine({ start: { x: 48, y: 738 }, end: { x: 547, y: 738 }, thickness: 1.2, color: green });
  };

  const wrap = (value: string, maxChars: number) => {
    const words = cleanText(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  const drawSection = (heading: string, startY: number) => {
    page.drawRectangle({ x: 48, y: startY - 4, width: 499, height: 28, color: soft, borderColor: line, borderWidth: 0.7 });
    drawText(heading, 64, startY + 5, 14, { isBold: true, color: green });
    return startY - 38;
  };

  const drawRows = (rows: string[][], startY: number) => {
    let currentY = startY;
    rows.forEach(([label, value]) => {
      const lines = wrap(value, label === "Details" ? 62 : 58).slice(0, 4);
      const rowHeight = Math.max(27, lines.length * 13 + 9);
      page.drawLine({ start: { x: 48, y: currentY + 11 }, end: { x: 547, y: currentY + 11 }, thickness: 0.5, color: line });
      page.drawLine({ start: { x: 178, y: currentY + 11 }, end: { x: 178, y: currentY - rowHeight + 16 }, thickness: 0.5, color: line });
      drawText(`${label}:`, 64, currentY, 10.5, { isBold: true });
      lines.forEach((lineText, index) => drawText(lineText, 194, currentY - index * 13, 10.5));
      currentY -= rowHeight;
    });
    return currentY;
  };

  drawDocumentHeader(1);

  page.drawRectangle({ x: 48, y: 642, width: 499, height: 72, color: soft, borderColor: line, borderWidth: 1 });
  drawCenteredText("Ausschreibung", 297.5, 690, 18, { isBold: true, color: green });
  const titleLines = wrapByWidth(title, 430, 14, true);
  titleLines.slice(0, 2).forEach((lineText, index) => drawCenteredText(lineText, 297.5, 668 - index * 14, 14, { isBold: true, color: green }));
  if (reminder.link) {
    drawCenteredText(reminder.link, 297.5, 645, 6.2, { color: muted });
  }

  let y = drawSection("Turnierinformationen", 606);
  y = drawRows([
    ["Veranstalter", "Norddeutscher Billard Verband e.V. (NBV)"],
    ["Verantwortlicher", "Landessportwart Karambolage/Kegel"],
    ["Turnierleitung", "Ausrichtender Verein"],
    ["Disziplin", discipline || "-"],
    ["Wettbewerb", typeParts.join(" / ") || "-"],
    ["Startberechtigt", "Alle NBV-Sportler/innen, die in der NBV-ClubCloud als aktiv gemeldet sind."],
  ], y);

  y -= 22;
  y = drawSection("Termine / Uhrzeit", y);
  y = drawRows([
    ["Termin", details.date || formatShortGermanDate(reminder.event_date)],
    ["Turnierbeginn", startTime ? `${startTime} Uhr` : "-"],
    ["Meldeschluss", deadline || "-"],
    ["Akkreditierung", "jeweils bis 15 Minuten vor Turnierbeginn"],
  ], y);

  y -= 22;
  y = drawSection("Spielort / Dresscode", y);
  y = drawRows([
    ["Spielort", locationLines.join("\n") || "-"],
    ["Kleidung", "gem. Pkt. 1.3 Spielkleidung der STO-BT Karambolage des NBV"],
  ], y);

  drawFooter();
  page = pdf.addPage([595, 842]);
  drawDocumentHeader(2);

  y = 688;
  y = drawSection("Modus / Turnierbesonderheit", y);
  y = drawRows([
    ["Modus", "Der Turniermodus wird entsprechend der STO-BTK, je nach Anmeldezahl festgelegt."],
  ], y);

  y -= 22;
  y = drawSection("Wichtiges", y);
  const importantRows = [
    ["Regeln", "Es gelten die Spielregeln und Spielregularien der DBU und die Bestimmungen der STO-BTK des NBV."],
    ["Doping", "Die Teilnehmer dieses Turniers erkennen mit ihrer Meldung die Richtlinien der NADA an."],
    ["Haftung", "Der Veranstalter übernimmt keine Haftung für Sach- und Personenschäden sowie Entwendung von Wertsachen."],
    ["Vorbehalte", "Kurzfristige Änderungen durch den Landessportwart bzw. die Turnierleitung bleiben vorbehalten."],
  ];
  importantRows.forEach(([label, value]) => {
    if (y < 102) return;
    page.drawLine({ start: { x: 48, y: y + 11 }, end: { x: 547, y: y + 11 }, thickness: 0.5, color: line });
    drawText(`${label}:`, 64, y, 9.5, { isBold: true });
    const lines = wrap(value, 68).slice(0, 2);
    lines.forEach((lineText, index) => drawText(lineText, 148, y - index * 12, 9.5));
    y -= Math.max(24, lines.length * 12 + 8);
  });

  if (y >= 84) {
    y -= 10;
    drawText("Mit sportlichem Gruß", 48, y, 10.5);
  }

  drawFooter();

  return await pdf.save();
}

function buildSubject(reminder: ReminderRow) {
  return buildPdfFilename(reminder).replace(/\.pdf$/i, "");
}

function buildDirectPdfFilename(invitation: NonNullable<RequestPayload["directInvitation"]>) {
  const title = cleanFilenamePart(cleanText(invitation.title || "Turnier")) || "Turnier";
  const season = getSeasonFromDate(cleanText(invitation.eventDate || ""));
  return cleanText(invitation.pdfFilename || "") || ["Einladung", title, season].filter(Boolean).join(" - ") + ".pdf";
}

function buildHtml(reminder: ReminderRow) {
  const detailsLink = reminder.link
    ? `<p><a href="${reminder.link}">Turnier in Club Cloud öffnen</a></p>`
    : "";
  return `
    <div style="font-family:Arial,sans-serif;color:#17202a;line-height:1.5">
      <p>Liebe Billardfreunde,</p>
      <p>im Anhang befindet sich die Ausschreibung zum folgenden Turnier:</p>
      <p>
        <strong>${cleanText(reminder.title)}</strong><br>
        Termin: ${formatGermanDate(reminder.event_date)}<br>
        ${reminder.location ? `Ort: ${cleanText(reminder.location)}<br>` : ""}
      </p>
      ${detailsLink}
      <p style="font-size:12px;line-height:1.25;margin:12px 0;">
        Verteiler in BCC:<br>
        --- Vereinssportwarte im NBV<br>
        --- Funktionsträger der Karambolage-Vereine im NBV<br>
        --- weitere interessierte NBV-Sportler
      </p>
      <p>Mit sportlichem Gruß<br>Norddeutscher Billard Verband e.V.</p>
    </div>
  `;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "service-role-missing" }, 500);
    }
    const payload = await request.json().catch(() => ({})) as RequestPayload;
    await assertInvocationAllowed(request, supabaseUrl, serviceRoleKey, Boolean(payload.testEmail));
    const dryRun = Boolean(payload.dryRun);
    const requestedReminderId = cleanText(payload.reminderId);
    const testEmail = normalizeEmail(payload.testEmail);
    const isTestEmail = Boolean(testEmail);
    if (payload.testEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return jsonResponse({ error: "invalid-test-email" }, 400);
    }
    const directInvitation = payload.directInvitation;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: settingsData, error: settingsError } = await adminClient
      .from("calendar_settings")
      .select("source_url, season, invitation_auto_send_enabled, invitation_auto_send_days_before, invitation_auto_send_time, invitation_auto_send_frequency, invitation_auto_send_last_run_at, invitation_auto_send_limit")
      .eq("key", "nbv_public_calendar")
      .maybeSingle();
    if (settingsError) throw settingsError;
    const settings = (settingsData || {}) as CalendarSettingsRow;
    const autoSendEnabled = settings.invitation_auto_send_enabled === true;
    const autoSendDaysBefore = clampInteger(settings.invitation_auto_send_days_before, 14, 0, 365);
    const autoSendTime = normalizeTimeSetting(settings.invitation_auto_send_time, "08:00");
    const autoSendFrequency = normalizeFrequencySetting(settings.invitation_auto_send_frequency);
    const currentBerlinTime = berlinTimeHHmm();
    const configuredLimit = clampInteger(settings.invitation_auto_send_limit, 10, 1, 25);
    const limit = requestedReminderId || isTestEmail ? 1 : configuredLimit;
    const isAutomaticRun = !dryRun && !requestedReminderId && !isTestEmail && !directInvitation?.pdfBase64;
    if (!dryRun && !requestedReminderId && !isTestEmail && !directInvitation?.pdfBase64 && !autoSendEnabled) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "auto-send-disabled",
        autoSendEnabled,
        daysBefore: autoSendDaysBefore,
        sendTime: autoSendTime,
        frequency: autoSendFrequency,
        currentTime: currentBerlinTime,
        limit,
      });
    }

    if (isAutomaticRun && !isTimeReached(currentBerlinTime, autoSendTime)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "auto-send-time-not-reached",
        autoSendEnabled,
        daysBefore: autoSendDaysBefore,
        sendTime: autoSendTime,
        frequency: autoSendFrequency,
        currentTime: currentBerlinTime,
        limit,
      });
    }

    if (isAutomaticRun && !isFrequencyRunDue(settings.invitation_auto_send_last_run_at, autoSendFrequency)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "auto-send-frequency-not-due",
        autoSendEnabled,
        daysBefore: autoSendDaysBefore,
        sendTime: autoSendTime,
        frequency: autoSendFrequency,
        currentTime: currentBerlinTime,
        lastRunAt: settings.invitation_auto_send_last_run_at || null,
        limit,
      });
    }

    let syncResult: Record<string, unknown> | null = null;
    if (!requestedReminderId && !directInvitation?.pdfBase64 && (dryRun || isTestEmail || autoSendEnabled)) {
      syncResult = await syncAutoRemindersFromCalendar(supabaseUrl, serviceRoleKey, adminClient, settings, autoSendDaysBefore);
    }

    const { data: recipientsData, error: recipientsError } = await adminClient
      .from("calendar_invitation_recipients")
      .select("name, email, recipient_group, delivery_type")
      .eq("active", true)
      .order("name", { ascending: true });
    if (recipientsError) throw recipientsError;

    const recipients = (recipientsData || [])
      .map((row: RecipientRow) => ({
        ...row,
        email: normalizeEmail(row.email),
        delivery_type: ["to", "cc"].includes(String(row.delivery_type || "").trim().toLowerCase())
          ? String(row.delivery_type || "").trim().toLowerCase()
          : "bcc",
      }))
      .filter((row: RecipientRow) => row.email);
    const toEmails = Array.from(new Set(recipients.filter((row: RecipientRow) => row.delivery_type === "to").map((row: RecipientRow) => row.email)));
    const ccEmails = Array.from(new Set(recipients.filter((row: RecipientRow) => row.delivery_type === "cc").map((row: RecipientRow) => row.email)));
    const bccEmails = Array.from(new Set(recipients.filter((row: RecipientRow) => row.delivery_type === "bcc").map((row: RecipientRow) => row.email)));
    const effectiveToEmails = isTestEmail ? [testEmail] : toEmails;
    const effectiveCcEmails = isTestEmail ? [] : ccEmails;
    const effectiveBccEmails = isTestEmail ? [] : bccEmails;
    const uniqueEmails = Array.from(new Set([...effectiveToEmails, ...effectiveCcEmails, ...effectiveBccEmails]));
    if (!uniqueEmails.length && !dryRun) {
      return jsonResponse({ ok: true, skipped: true, reason: "no-recipients" });
    }

    if (directInvitation?.pdfBase64) {
      const mailFrom = Deno.env.get("INVITATION_EMAIL_FROM") || Deno.env.get("INVITATION_SMTP_USER") || Deno.env.get("RESULT_EMAIL_FROM") || Deno.env.get("SMTP_USER");
      if (!mailFrom) throw new Error("Fehlendes Secret: INVITATION_EMAIL_FROM, INVITATION_SMTP_USER, RESULT_EMAIL_FROM oder SMTP_USER.");
      const transporter = buildTransport();
      const title = cleanText(directInvitation.title || "NBV Turnier");
      const reminder: ReminderRow = {
        id: cleanText(directInvitation.id || `direct-${Date.now()}`),
        event_id: cleanText(directInvitation.eventId || ""),
        event_date: cleanText(directInvitation.eventDate || todayIso()),
        reminder_date: todayIso(),
        days_before: 0,
        title,
        location: cleanText(directInvitation.location || ""),
        link: cleanText(directInvitation.link || ""),
        message_text: "",
        status: "open",
      };
      const subject = buildDirectPdfFilename(directInvitation).replace(/\.pdf$/i, "");
      const { error: directReminderError } = await adminClient
        .from("calendar_club_reminders")
        .upsert({
          id: reminder.id,
          event_id: reminder.event_id || "",
          event_date: reminder.event_date,
          reminder_date: reminder.reminder_date,
          days_before: 0,
          title: reminder.title,
          location: reminder.location,
          link: reminder.link,
          message_text: reminder.message_text,
          status: "open",
          updated_at: new Date().toISOString(),
        });
      if (directReminderError) throw directReminderError;
      const info = await transporter.sendMail({
        from: mailFrom,
        to: effectiveToEmails.length ? effectiveToEmails : mailFrom,
        cc: effectiveCcEmails.length ? effectiveCcEmails : undefined,
        bcc: effectiveBccEmails.length ? effectiveBccEmails : undefined,
        subject,
        html: buildHtml(reminder).replace(/Ausschreibung/g, "Einladung"),
        attachments: [{
          filename: buildDirectPdfFilename(directInvitation),
          content: directInvitation.pdfBase64,
          encoding: "base64",
          contentType: "application/pdf",
        }],
      });
      await adminClient
        .from("calendar_invitation_email_logs")
        .insert({
          reminder_id: reminder.id,
          event_id: reminder.event_id || "",
          subject,
          recipient_count: uniqueEmails.length,
          status: "sent",
          message_id: info.messageId || "",
        });
      await adminClient
        .from("calendar_club_reminders")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_by_name: "Manueller E-Mail-Versand",
          updated_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);
      return jsonResponse({ ok: true, direct: true, recipientCount: uniqueEmails.length, messageId: info.messageId || "" });
    }

    let reminderQuery = adminClient
      .from("calendar_club_reminders")
      .select("id, event_id, event_date, reminder_date, days_before, title, location, link, message_text, status")
      .eq("status", "open")
      .order("reminder_date", { ascending: true })
      .limit(limit);
    if (!isTestEmail) reminderQuery = reminderQuery.lte("reminder_date", todayIso());
    if (requestedReminderId) reminderQuery = reminderQuery.eq("id", requestedReminderId);
    if (!requestedReminderId && !isTestEmail) reminderQuery = reminderQuery.eq("days_before", autoSendDaysBefore);

    const { data: remindersData, error: remindersError } = await reminderQuery;
    if (remindersError) throw remindersError;
    const reminders = (remindersData || []) as ReminderRow[];
    if (requestedReminderId && reminders.length !== 1) {
      return jsonResponse({ ok: false, error: "reminder-not-found-or-not-open", reminderId: requestedReminderId }, 404);
    }
    if (isTestEmail && reminders.length !== 1) {
      return jsonResponse({ ok: false, error: "no-open-reminder-for-test" });
    }
    if (dryRun) {
      return jsonResponse({ ok: true, dryRun, reminderCount: reminders.length, recipientCount: uniqueEmails.length, autoSendEnabled, daysBefore: autoSendDaysBefore, sendTime: autoSendTime, frequency: autoSendFrequency, currentTime: currentBerlinTime, limit, sync: syncResult, reminders });
    }

    const mailFrom = Deno.env.get("INVITATION_EMAIL_FROM") || Deno.env.get("INVITATION_SMTP_USER") || Deno.env.get("RESULT_EMAIL_FROM") || Deno.env.get("SMTP_USER");
    if (!mailFrom) throw new Error("Fehlendes Secret: INVITATION_EMAIL_FROM, INVITATION_SMTP_USER, RESULT_EMAIL_FROM oder SMTP_USER.");
    const transporter = buildTransport();

    const results: Array<Record<string, unknown>> = [];

    for (const reminder of reminders) {
      const subject = `${isTestEmail ? "[TEST] " : ""}${buildSubject(reminder)}`;
      try {
        const pdfBytes = await buildInvitationPdf(reminder);
        const info = await transporter.sendMail({
          from: mailFrom,
          to: effectiveToEmails.length ? effectiveToEmails : mailFrom,
          cc: effectiveCcEmails.length ? effectiveCcEmails : undefined,
          bcc: effectiveBccEmails.length ? effectiveBccEmails : undefined,
          subject,
          html: buildHtml(reminder),
          attachments: [{
            filename: buildPdfFilename(reminder),
            content: bytesToBase64(pdfBytes),
            encoding: "base64",
            contentType: "application/pdf",
          }],
        });

        if (!isTestEmail) {
          await adminClient
            .from("calendar_invitation_email_logs")
            .insert({
              reminder_id: reminder.id,
              event_id: reminder.event_id || "",
              subject,
              recipient_count: uniqueEmails.length,
              status: "sent",
              message_id: info.messageId || "",
            });

          await adminClient
            .from("calendar_club_reminders")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              sent_by_name: "Automatischer E-Mail-Versand",
              updated_at: new Date().toISOString(),
            })
            .eq("id", reminder.id);
        }

        results.push({ reminderId: reminder.id, status: "sent", recipientCount: uniqueEmails.length, messageId: info.messageId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isTestEmail) {
          await adminClient
            .from("calendar_invitation_email_logs")
            .insert({
              reminder_id: reminder.id,
              event_id: reminder.event_id || "",
              subject,
              recipient_count: uniqueEmails.length,
              status: "failed",
              error_message: message,
            });
        }
        results.push({ reminderId: reminder.id, status: "failed", error: message });
      }
    }

    if (isAutomaticRun) {
      await adminClient
        .from("calendar_settings")
        .update({
          invitation_auto_send_last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("key", "nbv_public_calendar");
    }

    return jsonResponse({ ok: true, testEmail: isTestEmail ? testEmail : undefined, reminderCount: reminders.length, recipientCount: uniqueEmails.length, autoSendEnabled, daysBefore: autoSendDaysBefore, sendTime: autoSendTime, frequency: autoSendFrequency, currentTime: currentBerlinTime, limit, sync: syncResult, results });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
