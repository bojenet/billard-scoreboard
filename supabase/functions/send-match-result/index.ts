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

function toSeries(values?: number[]) {
  return Array.isArray(values) ? values.map((value) => Number(value || 0)) : [];
}

async function buildPdf(match: MatchPayload) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bg = rgb(1, 1, 1);
  const panel = rgb(1, 1, 1);
  const header = rgb(0.95, 0.95, 0.95);
  const line = rgb(0.55, 0.55, 0.55);
  const text = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.28, 0.28, 0.28);

  page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: bg });
  page.drawRectangle({ x: 24, y: 24, width: 794, height: 547, color: panel, borderColor: line, borderWidth: 1 });

  const drawText = (value: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(String(value || ""), {
      x,
      y,
      size,
      font: opts.bold ? bold : font,
      color: opts.color || text,
    });
  };

  const drawCell = (x: number, yTop: number, width: number, height: number, left: string, right = "", options: { valueBold?: boolean; center?: boolean; fill?: ReturnType<typeof rgb>; labelWidth?: number } = {}) => {
    page.drawRectangle({
      x,
      y: yTop - height,
      width,
      height,
      color: options.fill || panel,
      borderColor: line,
      borderWidth: 1,
    });
    if (options.center) {
      const textWidth = (options.valueBold ? bold : font).widthOfTextAtSize(left, 13);
      drawText(left, x + (width - textWidth) / 2, yTop - height / 2 - 5, 13, { bold: options.valueBold });
      return;
    }
    const labelWidth = options.labelWidth ?? 92;
    if (left) drawText(left, x + 10, yTop - height / 2 - 5, 12, { color: muted });
    if (right) drawText(right, x + 10 + labelWidth, yTop - height / 2 - 5, 12, { bold: options.valueBold });
  };

  drawText("Partie-Ergebnis", 46, 520, 34, { bold: true });
  drawText("Datum", 548, 522, 18, { color: muted });
  drawText(formatDate(match.finishedAt), 620, 522, 20, { bold: true });

  const metaTop = 470;
  const rowH = 34;
  drawCell(24, metaTop, 390, rowH, "Spieler 1", match.player1, { valueBold: true, labelWidth: 92 });
  drawCell(414, metaTop, 404, rowH, "Spieler 2", match.player2, { valueBold: true, labelWidth: 92 });
  drawCell(24, metaTop - rowH, 390, rowH, "Disziplin 1", match.discipline1 || "-", { labelWidth: 102 });
  drawCell(414, metaTop - rowH, 404, rowH, "Disziplin 2", match.discipline2 || "-", { labelWidth: 102 });
  drawCell(24, metaTop - rowH * 2, 390, rowH, "Ergebnis", `${match.score1} : ${match.score2}`, { valueBold: true, labelWidth: 84 });
  drawCell(414, metaTop - rowH * 2, 404, rowH, "Aufnahmen", String(match.innings ?? 0), { valueBold: true, labelWidth: 98 });

  const leftSeries = toSeries(match.series1);
  const rightSeries = toSeries(match.series2);
  const rowCount = Math.max(leftSeries.length, rightSeries.length, Number(match.innings || 0), 5);
  const gridTop = 368;
  const gridHeaderH = 34;
  const gridRowH = 30;
  const cols = [24, 203, 382, 452, 631];
  const widths = [179, 179, 70, 179, 187];

  ["Serie", "Gesamt", "Aufn.", "Serie", "Gesamt"].forEach((label, index) => {
    page.drawRectangle({
      x: cols[index],
      y: gridTop - gridHeaderH,
      width: widths[index],
      height: gridHeaderH,
      color: header,
      borderColor: line,
      borderWidth: 1,
    });
    const labelWidth = bold.widthOfTextAtSize(label, 13);
    drawText(label, cols[index] + (widths[index] - labelWidth) / 2, gridTop - 22, 13, { bold: true, color: muted });
  });

  let sumLeft = 0;
  let sumRight = 0;
  for (let i = 0; i < rowCount; i++) {
    const yTop = gridTop - gridHeaderH - i * gridRowH;
    const leftValue = Number(leftSeries[i] || 0);
    const rightValue = Number(rightSeries[i] || 0);
    const hasLeft = i < leftSeries.length;
    const hasRight = i < rightSeries.length;
    if (hasLeft) sumLeft += leftValue;
    if (hasRight) sumRight += rightValue;
    const values = [
      hasLeft ? String(leftValue || "-") : "-",
      sumLeft ? String(sumLeft) : "-",
      String(i + 1),
      hasRight ? String(rightValue || "-") : "-",
      sumRight ? String(sumRight) : "-",
    ];

    values.forEach((value, index) => {
      page.drawRectangle({
        x: cols[index],
        y: yTop - gridRowH,
        width: widths[index],
        height: gridRowH,
        color: panel,
        borderColor: line,
        borderWidth: 1,
      });
      const width = font.widthOfTextAtSize(value, 11);
      drawText(value, cols[index] + (widths[index] - width) / 2, yTop - 19, 11);
    });
  }

  const summaryTop = gridTop - gridHeaderH - rowCount * gridRowH - 2;
  page.drawRectangle({ x: 24, y: 24, width: 397, height: summaryTop - 24, borderColor: line, borderWidth: 1, color: panel });
  page.drawRectangle({ x: 421, y: 24, width: 397, height: summaryTop - 24, borderColor: line, borderWidth: 1, color: panel });

  const statRowsLeft = [
    ["Anzahl der Bälle", String(match.score1 ?? 0)],
    ["Anzahl der Aufnahmen", String(match.innings ?? 0)],
    ["Durchschnitt", String(match.avg1 || "0.000")],
    ["Höchstserie", String(match.hs1 ?? 0)],
  ];
  const statRowsRight = [
    ["Anzahl der Bälle", String(match.score2 ?? 0)],
    ["Anzahl der Aufnahmen", String(match.innings ?? 0)],
    ["Durchschnitt", String(match.avg2 || "0.000")],
    ["Höchstserie", String(match.hs2 ?? 0)],
  ];

  const drawStatColumn = (x: number, rows: string[][]) => {
    let y = summaryTop - 24;
    rows.forEach(([label, value], index) => {
      if (index > 0) {
        page.drawLine({ start: { x: x + 14, y }, end: { x: x + 383, y }, thickness: 1, color: line });
        y -= 22;
      }
      drawText(label, x + 14, y - 8, 11, { color: muted });
      const width = bold.widthOfTextAtSize(value, 12);
      drawText(value, x + 383 - width, y - 9, 12, { bold: true });
      y -= 38;
    });
  };

  drawStatColumn(24, statRowsLeft);
  drawStatColumn(421, statRowsRight);

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
          filename: "Partie-Ergebnis.pdf",
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
