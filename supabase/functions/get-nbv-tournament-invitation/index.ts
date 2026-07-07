const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvitationRequest = {
  sourceUrl?: string;
  disciplineId?: string;
  disciplineLabel?: string;
  rankingSeason?: string;
};

type InvitationParticipant = {
  number: string;
  name: string;
  club: string;
  seedRank?: string;
  seedGd?: string;
  originalNumber?: string;
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
  disciplineId: string;
  category: string;
  tournamentType: string;
  rankingSeason: string;
  rankingSourceUrl: string;
  seedingNote: string;
  participants: InvitationParticipant[];
};

type RankingRow = {
  rank: string;
  gd: string;
  name: string;
  club: string;
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

function getPreviousSeason(season: string) {
  const match = cleanInline(season).match(/^(20\d{2})\/(20\d{2})$/);
  if (!match) return "";
  const start = Number(match[1]) - 1;
  const end = Number(match[2]) - 1;
  return `${start}/${end}`;
}

function buildGdRankingUrl(season: string, disciplineId: string) {
  const safeSeason = cleanInline(season);
  const safeDisciplineId = cleanInline(disciplineId).replace(/[^\d]/g, "");
  if (!safeSeason || !safeDisciplineId) return "";
  return `https://www.ndbv.de/btd.php?p=20--${safeSeason}---${safeDisciplineId}-2---1`;
}

function normalizeName(value: string) {
  return cleanInline(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\b(dr|prof|professor|dipl|ing)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function nameVariants(value: string) {
  const raw = cleanInline(value);
  const variants = new Set<string>();
  const add = (candidate: string) => {
    const normalized = normalizeName(candidate);
    if (normalized) variants.add(normalized);
  };

  add(raw);
  if (raw.includes(",")) {
    const [lastName, ...rest] = raw.split(",");
    add(`${rest.join(" ")} ${lastName}`);
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      add(`${parts.slice(1).join(" ")} ${parts[0]}`);
    }
  }

  return variants;
}

function parseGdRanking(html: string): RankingRow[] {
  return extractTableRows(html)
    .map((row) => {
      const cells = row.cells.map(cleanInline);
      const rank = cells[0] || "";
      const gd = cells[1] || "";
      if (!/^\d+$/.test(rank) || !gd) return null;

      const playerCell = row.cells.find((cell, index) => index >= 2 && cleanText(cell).split("\n").filter(Boolean).length >= 2) || "";
      const lines = cleanText(playerCell).split("\n").map(cleanInline).filter(Boolean);
      const name = lines[0] || "";
      const club = lines.slice(1).join(" ");
      if (!name) return null;
      return { rank, gd, name, club };
    })
    .filter((row): row is RankingRow => Boolean(row));
}

function applySeeding(invitation: InvitationPayload, rankingRows: RankingRow[]) {
  if (!invitation.participants.length || !rankingRows.length) return;

  const rankingByKey = new Map<string, RankingRow>();
  rankingRows.forEach((row) => {
    nameVariants(row.name).forEach((key) => {
      if (!rankingByKey.has(key)) rankingByKey.set(key, row);
    });
  });

  const seeded = invitation.participants.map((participant, originalIndex) => {
    let ranking: RankingRow | undefined;
    for (const key of nameVariants(participant.name)) {
      ranking = rankingByKey.get(key);
      if (ranking) break;
    }
    return {
      participant: {
        ...participant,
        originalNumber: participant.number,
        seedRank: ranking?.rank || "",
        seedGd: ranking?.gd || "",
      },
      originalIndex,
      rankNumber: Number(ranking?.rank || Number.POSITIVE_INFINITY),
    };
  });

  seeded.sort((left, right) => {
    if (left.rankNumber !== right.rankNumber) return left.rankNumber - right.rankNumber;
    return left.originalIndex - right.originalIndex;
  });

  invitation.participants = seeded.map((entry, index) => ({
    ...entry.participant,
    number: String(index + 1),
  }));
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
    disciplineId: "",
    category: "",
    tournamentType: "",
    rankingSeason: "",
    rankingSourceUrl: "",
    seedingNote: "",
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
    invitation.disciplineId = cleanInline(body?.disciplineId || "");
    if (!invitation.discipline && body?.disciplineLabel) {
      invitation.discipline = cleanInline(body.disciplineLabel);
    }

    const rankingSeason = cleanInline(body?.rankingSeason || getPreviousSeason(invitation.season));
    const rankingSourceUrl = buildGdRankingUrl(rankingSeason, invitation.disciplineId);
    invitation.rankingSeason = rankingSeason;
    invitation.rankingSourceUrl = rankingSourceUrl;

    if (rankingSourceUrl) {
      try {
        const rankingHtml = await fetchHtmlWithRetry(rankingSourceUrl);
        const rankingRows = parseGdRanking(rankingHtml);
        applySeeding(invitation, rankingRows);
        invitation.seedingNote = rankingRows.length
          ? `Setzliste nach GD-Rangliste ${rankingSeason}.`
          : `Keine GD-Ranglisteneinträge für ${rankingSeason} gefunden.`;
      } catch (rankingError) {
        invitation.seedingNote = `GD-Rangliste ${rankingSeason} konnte nicht geladen werden.`;
        console.warn("GD-Rangliste konnte nicht geladen werden", {
          rankingSourceUrl,
          message: rankingError instanceof Error ? rankingError.message : String(rankingError),
        });
      }
    }

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
