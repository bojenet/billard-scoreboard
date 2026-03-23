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
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateForFilename(value?: string) {
  if (!value) return "unbekannt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unbekannt";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
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
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bg = rgb(1, 1, 1);
  const panel = rgb(1, 1, 1);
  const header = rgb(0.95, 0.95, 0.95);
  const line = rgb(0.55, 0.55, 0.55);
  const text = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.28, 0.28, 0.28);
  const pageWidth = 595;
  const pageHeight = 842;
  const page = pdf.addPage([pageWidth, pageHeight]);

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: bg });
  page.drawRectangle({ x: 24, y: 24, width: 547, height: 794, color: panel, borderColor: line, borderWidth: 1 });

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

  drawText("Partie-Ergebnis", 42, 774, 28, { bold: true });
  drawText("Datum", 378, 778, 14, { color: muted });
  drawText(formatDate(match.finishedAt), 430, 778, 16, { bold: true });

  const metaTop = 728;
  const rowH = 28;
  drawCell(24, metaTop, 273, rowH, "Spieler 1", match.player1, { valueBold: true, labelWidth: 76 });
  drawCell(297, metaTop, 274, rowH, "Spieler 2", match.player2, { valueBold: true, labelWidth: 76 });
  drawCell(24, metaTop - rowH, 273, rowH, "Disziplin 1", match.discipline1 || "-", { labelWidth: 84 });
  drawCell(297, metaTop - rowH, 274, rowH, "Disziplin 2", match.discipline2 || "-", { labelWidth: 84 });
  drawCell(24, metaTop - rowH * 2, 273, rowH, "Ergebnis", `${match.score1} : ${match.score2}`, { valueBold: true, labelWidth: 68 });
  drawCell(297, metaTop - rowH * 2, 274, rowH, "Aufnahmen", String(match.innings ?? 0), { valueBold: true, labelWidth: 82 });

  const leftSeries = toSeries(match.series1);
  const rightSeries = toSeries(match.series2);
  const rowCount = Math.max(leftSeries.length, rightSeries.length, Number(match.innings || 0), 5);
  const maxRowsFirstPage = 30;
  const firstPageRows = Math.min(rowCount, maxRowsFirstPage);
  const gridTop = 644;
  const gridHeaderH = 28;
  const gridRowH = 14;
  const cols = [24, 152, 280, 339, 467];
  const widths = [128, 128, 59, 128, 104];

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
    const labelWidth = bold.widthOfTextAtSize(label, 11);
    drawText(label, cols[index] + (widths[index] - labelWidth) / 2, gridTop - 18, 11, { bold: true, color: muted });
  });

  let sumLeft = 0;
  let sumRight = 0;
  for (let i = 0; i < firstPageRows; i++) {
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
      const width = font.widthOfTextAtSize(value, 9.5);
      drawText(value, cols[index] + (widths[index] - width) / 2, yTop - 10, 9.5);
    });
  }

  const summaryTop = gridTop - gridHeaderH - firstPageRows * gridRowH - 4;
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

  const drawStatColumn = (targetPage: typeof page, x: number, top: number, columnWidth: number, rows: string[][]) => {
    let y = top - 24;
    rows.forEach(([label, value], index) => {
      if (index > 0) {
        targetPage.drawLine({ start: { x: x + 14, y }, end: { x: x + columnWidth - 14, y }, thickness: 1, color: line });
        y -= 22;
      }
      targetPage.drawText(label, { x: x + 14, y: y - 8, size: 11, font, color: muted });
      const textWidth = bold.widthOfTextAtSize(value, 12);
      targetPage.drawText(value, { x: x + columnWidth - 14 - textWidth, y: y - 9, size: 12, font: bold, color: text });
      y -= 38;
    });
  };

  if (summaryTop >= 188) {
    page.drawRectangle({ x: 24, y: 24, width: 273, height: summaryTop - 24, borderColor: line, borderWidth: 1, color: panel });
    page.drawRectangle({ x: 297, y: 24, width: 274, height: summaryTop - 24, borderColor: line, borderWidth: 1, color: panel });
    drawStatColumn(page, 24, summaryTop, 273, statRowsLeft);
    drawStatColumn(page, 297, summaryTop, 274, statRowsRight);
  } else {
    const secondPage = pdf.addPage([pageWidth, pageHeight]);
    secondPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: bg });
    secondPage.drawRectangle({ x: 24, y: 24, width: 547, height: 794, color: panel, borderColor: line, borderWidth: 1 });
    secondPage.drawText("Partie-Ergebnis", { x: 42, y: 778, size: 24, font: bold, color: text });
    secondPage.drawText("Kennzahlen", { x: 42, y: 748, size: 14, font, color: muted });
    secondPage.drawRectangle({ x: 24, y: 482, width: 273, height: 250, borderColor: line, borderWidth: 1, color: panel });
    secondPage.drawRectangle({ x: 297, y: 482, width: 274, height: 250, borderColor: line, borderWidth: 1, color: panel });
    drawStatColumn(secondPage, 24, 716, 273, statRowsLeft);
    drawStatColumn(secondPage, 297, 716, 274, statRowsRight);

    const remainingRows = rowCount - firstPageRows;
    if (remainingRows > 0) {
      const secondGridTop = 446;
      ["Serie", "Gesamt", "Aufn.", "Serie", "Gesamt"].forEach((label, index) => {
        secondPage.drawRectangle({
          x: cols[index],
          y: secondGridTop - gridHeaderH,
          width: widths[index],
          height: gridHeaderH,
          color: header,
          borderColor: line,
          borderWidth: 1,
        });
        const labelWidth = bold.widthOfTextAtSize(label, 11);
        secondPage.drawText(label, {
          x: cols[index] + (widths[index] - labelWidth) / 2,
          y: secondGridTop - 18,
          size: 11,
          font: bold,
          color: muted,
        });
      });

      for (let i = firstPageRows; i < rowCount; i++) {
        const yTop = secondGridTop - gridHeaderH - (i - firstPageRows) * gridRowH;
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
          secondPage.drawRectangle({
            x: cols[index],
            y: yTop - gridRowH,
            width: widths[index],
            height: gridRowH,
            color: panel,
            borderColor: line,
            borderWidth: 1,
          });
          const width = font.widthOfTextAtSize(value, 9.5);
          secondPage.drawText(value, {
            x: cols[index] + (widths[index] - width) / 2,
            y: yTop - 10,
            size: 9.5,
            font,
            color: text,
          });
        });
      }
    }
  }

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
    const pdfFilename = `Partie-Ergebnis_${formatDateForFilename(match.finishedAt)}_${match.matchId}.pdf`;

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
          filename: pdfFilename,
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
