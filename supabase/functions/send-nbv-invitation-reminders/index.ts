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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
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

  drawText("NBV", 48, 770, 28, { isBold: true, color: green });
  page.drawLine({ start: { x: 112, y: 762 }, end: { x: 112, y: 792 }, thickness: 1, color: muted });
  drawText("Turniereinladung", 130, 786, 13);
  drawText("Karambolage/Kegel", 130, 767, 13);
  page.drawLine({ start: { x: 48, y: 738 }, end: { x: 547, y: 738 }, thickness: 1.2, color: green });

  page.drawRectangle({ x: 48, y: 660, width: 499, height: 54, color: soft, borderColor: line, borderWidth: 1 });
  drawText("Ausschreibung / Erinnerung", 190, 690, 18, { isBold: true, color: green });
  const titleLines = wrap(cleanText(reminder.title), 50);
  titleLines.slice(0, 2).forEach((lineText, index) => drawText(lineText, 72, 666 - index * 15, 14, { isBold: true, color: green }));

  const rows = [
    ["Turnier", reminder.title],
    ["Termin", formatGermanDate(reminder.event_date)],
    ["Erinnerung", `${reminder.days_before} Tage vor Turniertermin`],
    ["Ort", reminder.location || "-"],
    ["Details", reminder.link || "-"],
  ];

  let y = 610;
  rows.forEach(([label, value]) => {
    page.drawLine({ start: { x: 48, y: y + 11 }, end: { x: 547, y: y + 11 }, thickness: 0.5, color: line });
    drawText(`${label}:`, 64, y, 11, { isBold: true });
    const lines = wrap(value, label === "Details" ? 62 : 58);
    lines.slice(0, 3).forEach((lineText, index) => drawText(lineText, 170, y - index * 14, 11));
    y -= Math.max(28, lines.slice(0, 3).length * 14 + 8);
  });

  y -= 10;
  drawText("Hinweis", 48, y, 14, { isBold: true, color: green });
  y -= 22;
  const note = "Die Turnierdaten stehen in der Club Cloud bzw. im NBV-Kalender. Bitte rechtzeitig pruefen und Rueckmeldungen intern abstimmen.";
  wrap(note, 78).forEach((lineText) => {
    drawText(lineText, 48, y, 10.5, { color: muted });
    y -= 14;
  });

  page.drawLine({ start: { x: 48, y: 62 }, end: { x: 547, y: 62 }, thickness: 0.8, color: muted });
  drawText("Norddeutscher Billard-Verband e.V. (NBV)", 48, 42, 8, { color: muted });
  drawText("www.nbv-billard.de", 254, 42, 8, { color: muted });
  drawText(`Stand: ${formatGermanDate(todayIso()).replace(/^\S+,\s*/, "")}`, 465, 42, 8, { color: muted });

  return await pdf.save();
}

function buildSubject(reminder: ReminderRow) {
  return `NBV Ausschreibung: ${cleanText(reminder.title)} (${formatGermanDate(reminder.event_date)})`;
}

function buildHtml(reminder: ReminderRow) {
  const detailsLink = reminder.link
    ? `<p><a href="${reminder.link}">Ausschreibung / Details öffnen</a></p>`
    : "";
  return `
    <div style="font-family:Arial,sans-serif;color:#17202a;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#006020">NBV Turniererinnerung</h2>
      <p>Im Anhang befindet sich die Ausschreibung/Erinnerung zum folgenden Turnier:</p>
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
    const limit = Math.max(1, Math.min(25, Number(payload.limit || 10)));
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
    if (payload.reminderId) reminderQuery = reminderQuery.eq("id", cleanText(payload.reminderId));

    const { data: remindersData, error: remindersError } = await reminderQuery;
    if (remindersError) throw remindersError;
    const reminders = (remindersData || []) as ReminderRow[];
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
            filename: `NBV-Ausschreibung-${reminder.event_date}-${reminder.id}.pdf`,
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
