const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvitationRequest = {
  sourceUrl?: string;
};

type InvitationParticipant = {
  number: string;
  name: string;
  club: string;
};

type InvitationPayload = {
  sourceUrl: string;
  fetchedAt: string;
  title: string;
  shortCode: string;
  season: string;
  date: string;
  startTime: string;
  locationName: string;
  locationAddress: string[];
  registrationDeadline: string;
  section: string;
  discipline: string;
  category: string;
  tournamentType: string;
  participants: InvitationParticipant[];
};

type TableRow = {
  cells: string[];
};

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&auml;/gi, "ä")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : "";
    });
}

function stripTagsWithBreaks(value: string) {
  return cleanText(
    decodeHtmlEntities(
      String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function cleanInline(value: string | null | undefined) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function parseGermanDateToIso(value: string) {
  const match = cleanInline(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseSeasonFromUrl(sourceUrl: string) {
  try {
    const decoded = decodeURIComponent(sourceUrl);
    const match = decoded.match(/\b(20\d{2}\/20\d{2})\b/);
    return match?.[1] || "";
  } catch (_error) {
    const match = sourceUrl.match(/\b(20\d{2}\/20\d{2})\b/);
    return match?.[1] || "";
  }
}

function parseCellAttributes(attrs: string) {
  const colspan = Math.max(1, Number((attrs.match(/\bcolspan=(['"]?)(\d+)\1/i) || [])[2] || "1"));
  const rowspan = Math.max(1, Number((attrs.match(/\browspan=(['"]?)(\d+)\1/i) || [])[2] || "1"));
  return { colspan, rowspan };
}

function extractTableRows(html: string): TableRow[] {
  const rows: TableRow[] = [];
  const spanMap: Record<number, { text: string; remaining: number }> = {};
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    let columnIndex = 0;

    while (spanMap[columnIndex]?.remaining > 0) {
      cells[columnIndex] = spanMap[columnIndex].text;
      spanMap[columnIndex].remaining -= 1;
      columnIndex += 1;
    }

    const cellRegex = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      while (spanMap[columnIndex]?.remaining > 0) {
        cells[columnIndex] = spanMap[columnIndex].text;
        spanMap[columnIndex].remaining -= 1;
        columnIndex += 1;
      }

      const attrs = cellMatch[2] || "";
      const text = stripTagsWithBreaks(cellMatch[3] || "");
      const { colspan, rowspan } = parseCellAttributes(attrs);
      for (let offset = 0; offset < colspan; offset += 1) {
        cells[columnIndex + offset] = text;
        if (rowspan > 1) {
          spanMap[columnIndex + offset] = { text, remaining: rowspan - 1 };
        }
      }
      columnIndex += colspan;
    }

    if (cells.some(Boolean)) {
      rows.push({ cells: cells.map((cell) => cleanText(cell || "")) });
    }
  }

  return rows;
}

function parseInvitation(html: string, sourceUrl: string): InvitationPayload {
  const rows = extractTableRows(html);
  const payload: InvitationPayload = {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    title: "",
    shortCode: "",
    season: parseSeasonFromUrl(sourceUrl),
    date: "",
    startTime: "",
    locationName: "",
    locationAddress: [],
    registrationDeadline: "",
    section: "",
    discipline: "",
    category: "",
    tournamentType: "",
    participants: [],
  };

  for (const row of rows) {
    if (row.cells.length < 2) continue;
    const label = cleanInline(row.cells[0]).toLowerCase();
    const value = row.cells[1] || "";

    if (label === "turnier") payload.title = cleanInline(value);
    if (label === "kürzel" || label === "kuerzel") payload.shortCode = cleanInline(value);
    if (label === "meldeschluss") payload.registrationDeadline = cleanInline(value);
    if (label === "sparte") payload.section = cleanInline(value);
    if (label === "disziplin") payload.discipline = cleanInline(value);
    if (label === "kategorie") payload.category = cleanInline(value);
    if (label === "meisterschaftstyp") payload.tournamentType = cleanInline(value);

    if (label === "datum") {
      const lines = value.split("\n").map(cleanInline).filter(Boolean);
      payload.date = parseGermanDateToIso(lines[0] || "");
      const timeMatch = value.match(/um\s+(\d{2}:\d{2})\s+Uhr/i);
      payload.startTime = cleanInline(timeMatch?.[1] || "");
    }

    if (label === "location") {
      const lines = value.split("\n").map(cleanInline).filter(Boolean);
      payload.locationName = lines[0] || "";
      payload.locationAddress = lines.slice(1);
    }
  }

  const seenNames = new Set<string>();
  for (const row of rows) {
    if (row.cells.length < 3 || !/^\d+$/.test(cleanInline(row.cells[0]))) continue;
    const lines = String(row.cells[2] || "").split("\n").map(cleanInline).filter(Boolean);
    const name = lines[0] || "";
    const club = lines[1] || "";
    if (!name.includes(",") || !club || seenNames.has(name)) continue;
    seenNames.add(name);
    payload.participants.push({
      number: cleanInline(row.cells[0]),
      name,
      club,
    });
  }

  if (!payload.title) {
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    payload.title = cleanInline(stripTagsWithBreaks(titleMatch?.[1] || "NBV Turnier"));
  }

  return payload;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /refused stream|http2 error|sendrequest|connection reset|network|tempor|resolve host|dns/i.test(message);
}

function assertAllowedNbvUrl(sourceUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch (_error) {
    throw new Error("Bitte eine gültige NBV-Turnier-URL übergeben.");
  }
  if (parsed.hostname !== "www.ndbv.de" || !parsed.pathname.endsWith("/sb_meisterschaft.php")) {
    throw new Error("Es sind nur NBV-Detailseiten aus sb_meisterschaft.php erlaubt.");
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "billard-scoreboard-nbv-invitation/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`NBV-Turnierseite nicht erreichbar: HTTP ${response.status}`);
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
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) throw error;
      await delay(250 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) as InvitationRequest : {};
    const sourceUrl = String(body?.sourceUrl || "").trim();
    if (!sourceUrl) {
      throw new Error("Es wurde keine NBV-Turnier-URL übergeben.");
    }
    assertAllowedNbvUrl(sourceUrl);

    const html = await fetchHtmlWithRetry(sourceUrl);
    const invitation = parseInvitation(html, sourceUrl);

    return new Response(JSON.stringify({ invitation }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get-nbv-tournament-invitation failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: "nbv-tournament-invitation-failed",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
