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

function cleanFilenamePart(value: string) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPdfFilename(reminder: ReminderRow) {
  const title = cleanFilenamePart(reminder.title) || "Turnier";
  const season = getSeasonFromDate(reminder.event_date);
  return ["Ausschreibung", title, season].filter(Boolean).join(" - ") + ".pdf";
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

function assertInvocationAllowed(request: Request) {
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  if (!cronSecret) return;
  const providedSecret = request.headers.get("x-cron-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (providedSecret !== cronSecret) {
    throw new Error("Nicht autorisiert.");
  }
}

function buildTransport() {
  const host = Deno.env.get("SMTP_HOST") || "mail.gmx.net";
  const port = Number(Deno.env.get("SMTP_PORT") || "465");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");

  if (!user || !pass) {
    throw new Error("Fehlende Secrets: SMTP_USER oder SMTP_PASS.");
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
  const typeParts = [details.tournamentType, details.category].map(cleanText).filter(Boolean);
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
    drawText("Norddeutscher Billard-Verband e.V. (NBV)", 48, 42, 8, { color: muted });
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
    ["Haftung", "Der Veranstalter uebernimmt keine Haftung fuer Sach- und Personenschaeden sowie Entwendung von Wertsachen."],
    ["Vorbehalte", "Kurzfristige Aenderungen durch den Landessportwart bzw. die Turnierleitung bleiben vorbehalten."],
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
    drawText("Mit sportlichem Gruss", 48, y, 10.5);
  }

  drawFooter();

  return await pdf.save();
}

function buildSubject(reminder: ReminderRow) {
  return buildPdfFilename(reminder).replace(/\.pdf$/i, "");
}

function buildHtml(reminder: ReminderRow) {
  const detailsLink = reminder.link
    ? `<p><a href="${reminder.link}">Ausschreibung / Details öffnen</a></p>`
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
      <p>Mit sportlichem Gruß<br>Norddeutscher Billard-Verband e.V.</p>
    </div>
  `;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    assertInvocationAllowed(request);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "service-role-missing" }, 500);
    }

    const payload = await request.json().catch(() => ({})) as RequestPayload;
    const dryRun = Boolean(payload.dryRun);
    const requestedReminderId = cleanText(payload.reminderId);
    const limit = requestedReminderId ? 1 : Math.max(1, Math.min(25, Number(payload.limit || 10)));
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: recipientsData, error: recipientsError } = await adminClient
      .from("calendar_invitation_recipients")
      .select("name, email, recipient_group")
      .eq("active", true)
      .order("name", { ascending: true });
    if (recipientsError) throw recipientsError;

    const recipients = (recipientsData || [])
      .map((row: RecipientRow) => ({ ...row, email: normalizeEmail(row.email) }))
      .filter((row: RecipientRow) => row.email);
    const uniqueEmails = Array.from(new Set(recipients.map((row: RecipientRow) => row.email)));
    if (!uniqueEmails.length) {
      return jsonResponse({ ok: true, skipped: true, reason: "no-recipients" });
    }

    let reminderQuery = adminClient
      .from("calendar_club_reminders")
      .select("id, event_id, event_date, reminder_date, days_before, title, location, link, message_text, status")
      .eq("status", "open")
      .lte("reminder_date", todayIso())
      .order("reminder_date", { ascending: true })
      .limit(limit);
    if (requestedReminderId) reminderQuery = reminderQuery.eq("id", requestedReminderId);

    const { data: remindersData, error: remindersError } = await reminderQuery;
    if (remindersError) throw remindersError;
    const reminders = (remindersData || []) as ReminderRow[];
    if (requestedReminderId && reminders.length !== 1) {
      return jsonResponse({ ok: false, error: "reminder-not-found-or-not-open", reminderId: requestedReminderId }, 404);
    }
    if (dryRun) {
      return jsonResponse({ ok: true, dryRun, reminderCount: reminders.length, recipientCount: uniqueEmails.length, reminders });
    }

    const mailFrom = Deno.env.get("INVITATION_EMAIL_FROM") || Deno.env.get("RESULT_EMAIL_FROM") || Deno.env.get("SMTP_USER");
    if (!mailFrom) throw new Error("Fehlendes Secret: INVITATION_EMAIL_FROM, RESULT_EMAIL_FROM oder SMTP_USER.");
    const transporter = buildTransport();
    const results: Array<Record<string, unknown>> = [];

    for (const reminder of reminders) {
      const subject = buildSubject(reminder);
      try {
        const pdfBytes = await buildInvitationPdf(reminder);
        const info = await transporter.sendMail({
          from: mailFrom,
          to: uniqueEmails,
          subject,
          html: buildHtml(reminder),
          attachments: [{
            filename: buildPdfFilename(reminder),
            content: bytesToBase64(pdfBytes),
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
            sent_by_name: "Automatischer E-Mail-Versand",
            updated_at: new Date().toISOString(),
          })
          .eq("id", reminder.id);

        results.push({ reminderId: reminder.id, status: "sent", recipientCount: uniqueEmails.length, messageId: info.messageId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
        results.push({ reminderId: reminder.id, status: "failed", error: message });
      }
    }

    return jsonResponse({ ok: true, reminderCount: reminders.length, recipientCount: uniqueEmails.length, results });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
