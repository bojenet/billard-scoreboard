import nodemailer from "npm:nodemailer@6.10.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type Recipient = {
  name?: string;
  email: string;
};

type MatchPayload = {
  matchId: string;
  player1: string;
  player2: string;
  score1: number;
  score2: number;
  innings: number;
  avg1: string;
  avg2: string;
  hs1: number;
  hs2: number;
  series1: number[];
  series2: number[];
  duration: number;
  discipline1?: string;
  discipline2?: string;
  target1?: number;
  target2?: number;
  maxInnings?: number;
  startedAt?: string;
  finishedAt?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDuration(totalSeconds: number) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function wrapLine(text: string, maxChars: number) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
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
}

async function buildPdf(match: MatchPayload) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const color = rgb(0.09, 0.12, 0.2);
  let y = 790;

  const drawBlock = (label: string, value: string, size = 12) => {
    page.drawText(label, { x: 50, y, size, font: bold, color });
    y -= size + 4;
    const lines = wrapLine(value, 82);
    lines.forEach((line) => {
      page.drawText(line, { x: 50, y, size, font, color });
      y -= size + 4;
    });
    y -= 10;
  };

  page.drawText("Partie-Ergebnis", { x: 50, y, size: 24, font: bold, color });
  y -= 40;

  drawBlock("Partie", `${match.player1} vs. ${match.player2}`);
  drawBlock("Ergebnis", `${match.score1} : ${match.score2}`);
  drawBlock("Disziplin", `${match.discipline1 || "-"} / ${match.discipline2 || "-"}`);
  drawBlock("Aufnahmen", String(match.innings ?? 0));
  drawBlock("Durchschnitt", `${match.player1}: ${match.avg1}   |   ${match.player2}: ${match.avg2}`);
  drawBlock("Höchstserie", `${match.player1}: ${match.hs1 ?? 0}   |   ${match.player2}: ${match.hs2 ?? 0}`);
  drawBlock("Dauer", formatDuration(Number(match.duration || 0)));
  drawBlock("Gestartet", formatDate(match.startedAt));
  drawBlock("Beendet", formatDate(match.finishedAt));
  drawBlock(`Serienverlauf ${match.player1}`, (match.series1 || []).length ? match.series1.join(", ") : "-");
  drawBlock(`Serienverlauf ${match.player2}`, (match.series2 || []).length ? match.series2.join(", ") : "-");

  return await pdf.save();
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const mailFrom = Deno.env.get("RESULT_EMAIL_FROM") || Deno.env.get("SMTP_USER");
    if (!mailFrom) {
      return new Response(JSON.stringify({ error: "Fehlendes Secret: RESULT_EMAIL_FROM oder SMTP_USER." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const recipients = Array.isArray(payload?.recipients) ? payload.recipients as Recipient[] : [];
    const match = payload?.match as MatchPayload | undefined;

    if (!match?.matchId || !match?.player1 || !match?.player2) {
      return new Response(JSON.stringify({ error: "Ungültige Matchdaten." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const to = recipients.map((item) => String(item.email || "").trim().toLowerCase()).filter(Boolean);
    if (!to.length) {
      return new Response(JSON.stringify({ skipped: true, reason: "no-recipients" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pdfBytes = await buildPdf(match);
    const transporter = buildTransport();
    const subject = `Partie-Ergebnis: ${match.player1} ${match.score1} : ${match.score2} ${match.player2}`;

    const html = `
      <div style="font-family:Arial,sans-serif;color:#1b1f2b;line-height:1.5">
        <h2 style="margin-bottom:12px">Partie-Ergebnis</h2>
        <p>Im Anhang befindet sich das PDF mit dem Ergebnis der gespielten Partie.</p>
        <p><strong>${match.player1}</strong> ${match.score1} : ${match.score2} <strong>${match.player2}</strong></p>
        <p>Aufnahmen: ${match.innings ?? 0}<br />Durchschnitt: ${match.avg1} / ${match.avg2}<br />Dauer: ${formatDuration(Number(match.duration || 0))}</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: mailFrom,
      to,
      subject,
      html,
      attachments: [
        {
          filename: `partie-${match.matchId}.pdf`,
          content: bytesToBase64(pdfBytes),
          encoding: "base64",
          contentType: "application/pdf",
        },
      ],
    });

    return new Response(JSON.stringify({ ok: true, to, messageId: info.messageId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
