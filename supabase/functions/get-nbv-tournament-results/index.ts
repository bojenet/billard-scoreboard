const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_TTL_MS = 5 * 60 * 1000;

type TournamentRequest = {
  sourceUrl?: string;
  forceRefresh?: boolean;
};

type MatchPlayer = {
  name: string;
  balls: string;
  innings: string;
  hs: string;
  average: string;
  points: string;
};

type TournamentMatchRow = {
  groupLabel: string;
  phaseLabel: string;
  phaseType: string;
  matchNo: string;
  score: string;
  scheduledDate: string;
  scheduledTime: string;
  player1: MatchPlayer;
  player2: MatchPlayer;
  details: Array<{ label: string; value: string }>;
};

type TournamentMeta = {
  title: string;
  shortCode: string;
  season: string;
  date: string;
  startTime: string;
  discipline: string;
  location: string;
  status: string;
};

type TournamentResponse = {
  sourceUrl: string;
  resultsUrl: string;
  fetchedAt: string;
  cacheAgeSeconds: number;
  meta: TournamentMeta;
  headers: string[];
  matches: TournamentMatchRow[];
};

type CachedPayload = {
  createdAt: number;
  payload: TournamentResponse;
};

type HtmlResult = {
  html: string;
  url: string;
};

type TableRowDetail = {
  cellsHtml: string[];
  cellsText: string[];
};

const responseCache = new Map<string, CachedPayload>();

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
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
    .replace(/&oslash;|&Oslash;/gi, "Ø")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : "";
    });
}

function stripTagsWithBreaks(value: string) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

function stripTags(value: string) {
  return cleanText(stripTagsWithBreaks(value));
}

function normalizeToken(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /refused stream|http2 error|sendrequest|connection reset|network|tempor|resolve host|dns/i.test(message);
}

async function fetchHtml(url: string): Promise<HtmlResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "billard-studio-tournament-results/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Turnierseite nicht erreichbar: HTTP ${response.status}`);
  }

  return {
    html: await response.text(),
    url: response.url || url,
  };
}

async function fetchHtmlWithRetry(url: string, maxAttempts = 4): Promise<HtmlResult> {
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

function resolveHref(rawHref: string, baseUrl: string) {
  try {
    return new URL(rawHref, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function parseGermanDateToIso(value: string) {
  const match = cleanText(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function extractAnchorTexts(html: string) {
  const values: string[] = [];
  const regex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const text = stripTags(match[1]);
    if (text) values.push(text);
  }
  return values;
}

function parseStatValue(text: string, labelPattern: RegExp) {
  const match = cleanText(text).match(labelPattern);
  return cleanText(match?.[1] || "");
}

function extractTableHtmlBlocks(html: string) {
  const tables: string[] = [];
  const tableRegex = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(html)) !== null) {
    tables.push(match[0]);
  }
  return tables;
}

function extractTableRowDetails(tableHtml: string) {
  const rows: TableRowDetail[] = [];
  const spanMap: Record<number, { html: string; text: string; remaining: number }> = {};
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cellsHtml: string[] = [];
    const cellsText: string[] = [];
    let columnIndex = 0;

    while (spanMap[columnIndex]?.remaining > 0) {
      cellsHtml[columnIndex] = spanMap[columnIndex].html;
      cellsText[columnIndex] = spanMap[columnIndex].text;
      spanMap[columnIndex].remaining -= 1;
      columnIndex += 1;
    }

    const cellRegex = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      while (spanMap[columnIndex]?.remaining > 0) {
        cellsHtml[columnIndex] = spanMap[columnIndex].html;
        cellsText[columnIndex] = spanMap[columnIndex].text;
        spanMap[columnIndex].remaining -= 1;
        columnIndex += 1;
      }

      const attrs = cellMatch[2] || "";
      const innerHtml = cellMatch[3] || "";
      const text = stripTags(innerHtml);
      const colspan = Math.max(1, Number((attrs.match(/\bcolspan=(['"]?)(\d+)\1/i) || [])[2] || "1"));
      const rowspan = Math.max(1, Number((attrs.match(/\browspan=(['"]?)(\d+)\1/i) || [])[2] || "1"));

      for (let offset = 0; offset < colspan; offset += 1) {
        cellsHtml[columnIndex + offset] = innerHtml;
        cellsText[columnIndex + offset] = text;
        if (rowspan > 1) {
          spanMap[columnIndex + offset] = {
            html: innerHtml,
            text,
            remaining: rowspan - 1,
          };
        }
      }

      columnIndex += colspan;
    }

    if (cellsText.some(Boolean)) {
      rows.push({
        cellsHtml: cellsHtml.map((value) => value || ""),
        cellsText: cellsText.map((value) => cleanText(value || "")),
      });
    }
  }

  return rows;
}

function buildTableGrid(tableHtml: string) {
  const rows = extractTableRowDetails(tableHtml).map((row) => row.cellsText);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows
    .map((row) => Array.from({ length: width }, (_, index) => cleanText(row[index] || "")))
    .filter((row) => row.some(Boolean));
}

function findDataStartIndex(grid: string[][]) {
  for (let index = 0; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length < 3) continue;
    if (/^\d+$/.test(cleanText(nonEmpty[0] || ""))) {
      return index;
    }
  }
  return -1;
}

function deriveColumnLabels(grid: string[][], dataStartIndex: number) {
  const headerRows = grid.slice(0, dataStartIndex);
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);

  return Array.from({ length: width }, (_, columnIndex) => {
    const parts: string[] = [];
    headerRows.forEach((row) => {
      const value = cleanText(row[columnIndex]);
      if (value && !parts.includes(value)) {
        parts.push(value);
      }
    });
    return parts.join(" ");
  });
}

function findHeaderIndex(headers: string[], matcher: (normalized: string, raw: string) => boolean) {
  for (let index = 0; index < headers.length; index += 1) {
    const raw = cleanText(headers[index]);
    const normalized = normalizeToken(raw);
    if (!normalized) continue;
    if (matcher(normalized, raw)) {
      return index;
    }
  }
  return -1;
}

function isLikelyResultLinkLabel(label: string) {
  const normalized = normalizeToken(label);
  return normalized.includes("ergebnisse") || normalized === "ergebnis" || normalized.includes("result");
}

function extractResultsTabUrl(html: string, baseUrl: string) {
  const linkRegex = /<a\b([^>]*)href=(['"])([^'"]+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const label = stripTags(match[5]);
    if (!isLikelyResultLinkLabel(label)) continue;
    const href = resolveHref(match[3], baseUrl);
    if (href) return href;
  }

  const onclickRegex = /<([a-z0-9]+)\b([^>]*)onclick=(['"])([\s\S]*?)\3([^>]*)>([\s\S]*?)<\/\1>/gi;
  let onclickMatch: RegExpExecArray | null;
  while ((onclickMatch = onclickRegex.exec(html)) !== null) {
    const label = stripTags(onclickMatch[6]);
    if (!isLikelyResultLinkLabel(label)) continue;
    const urlMatch = onclickMatch[4].match(/['"]([^'"]*sb_(?:meisterschaft|einzelrangliste)\.php[^'"]*)['"]/i);
    if (!urlMatch?.[1]) continue;
    const href = resolveHref(urlMatch[1], baseUrl);
    if (href) return href;
  }

  return "";
}

function extractMetaValue(pageText: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i");
  const match = pageText.match(regex);
  return cleanText(match?.[1] || "");
}

function extractMeta(html: string, sourceUrl: string): TournamentMeta {
  const pageText = stripTags(html);
  const pageTextWithBreaks = stripTagsWithBreaks(html);
  const titleCandidates = [
    stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""),
    stripTags((html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ""),
    stripTags((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
  ].filter(Boolean);
  const pageTitle = titleCandidates[0] || "";
  const seasonMatch = sourceUrl.match(/20-\d{2}-(20\d{2}\/20\d{2})-/);
  const dateMatch = pageText.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
  const startTimeMatch = pageText.match(/Spielbeginn am\s+\d{2}\.\d{2}\.\d{4}\s+um\s+(\d{2}:\d{2})\s+Uhr/i);
  const disciplineMatch = pageTextWithBreaks.match(/Disziplin\s+([^\n]+)/i);
  const locationMatch = pageTextWithBreaks.match(/Location\s+([^\n]+)/i);
  const shortCodeMatch = pageTextWithBreaks.match(/Kürzel\s+([^\n]+)/i);

  return {
    title: pageTitle || extractMetaValue(pageText, "Turnier") || extractMetaValue(pageText, "Bezeichnung"),
    shortCode: cleanText(shortCodeMatch?.[1] || "") || extractMetaValue(pageText, "Kürzel") || extractMetaValue(pageText, "Kuerzel"),
    season: seasonMatch?.[1] || extractMetaValue(pageText, "Saison"),
    date: parseGermanDateToIso(dateMatch?.[1] || extractMetaValue(pageText, "Datum")),
    startTime: cleanText(startTimeMatch?.[1] || ""),
    discipline: cleanText(disciplineMatch?.[1] || "") || extractMetaValue(pageText, "Disziplin") || extractMetaValue(pageText, "Kategorie"),
    location: cleanText(locationMatch?.[1] || "") || extractMetaValue(pageText, "Austragungsort") || extractMetaValue(pageText, "Spiellokal") || extractMetaValue(pageText, "Ort"),
    status: extractMetaValue(pageText, "Status") || (pageText.includes("Ergebnisse") ? "beendet" : ""),
  };
}

function parsePlayerCell(html: string, text: string, balls: string): MatchPlayer {
  const anchors = extractAnchorTexts(html);
  const lines = stripTagsWithBreaks(html)
    .split("\n")
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  const fallbackText = stripTagsWithBreaks(text);
  const firstLine = lines[0] || fallbackText.split("\n")[0] || "";
  const inlineNameMatch = firstLine.match(/^(.*?)(?=\s+HS\s*:|\s+Aufn\.?\s*:|\s+Ø\s*:|$)/i);
  const name = cleanText(anchors[0] || inlineNameMatch?.[1] || firstLine);
  const statsText = lines
    .map((line, index) => (index === 0 && name ? cleanText(line.slice(name.length)) : line))
    .join(" ");
  return {
    name,
    balls,
    innings: parseStatValue(statsText, /Aufn\.?\s*:\s*([0-9.,]+)/i),
    hs: parseStatValue(statsText, /HS\s*:\s*([0-9.,]+)/i),
    average: parseStatValue(statsText, /Ø\s*:\s*([0-9.,]+)/i),
    points: "",
  };
}

function calculateMatchPoints(leftBalls: string, rightBalls: string) {
  const left = Number(String(leftBalls || "").replace(",", "."));
  const right = Number(String(rightBalls || "").replace(",", "."));
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return { leftPoints: "", rightPoints: "" };
  }
  if (left > right) {
    return { leftPoints: "2", rightPoints: "0" };
  }
  if (left < right) {
    return { leftPoints: "0", rightPoints: "2" };
  }
  return { leftPoints: "1", rightPoints: "1" };
}

function findNearestFilledIndex(values: string[], startIndex: number, direction: -1 | 1, stopIndex?: number) {
  let index = startIndex + direction;
  while (index >= 0 && index < values.length) {
    if (stopIndex !== undefined && ((direction > 0 && index >= stopIndex) || (direction < 0 && index <= stopIndex))) {
      break;
    }
    if (cleanText(values[index])) return index;
    index += direction;
  }
  return -1;
}

function parseScheduledCell(text: string) {
  const dateMatch = cleanText(text).match(/(\d{2}\.\d{2}\.\d{4})/);
  const timeMatch = cleanText(text).match(/(\d{2}:\d{2})/);
  return {
    scheduledDate: parseGermanDateToIso(dateMatch?.[1] || ""),
    scheduledTime: cleanText(timeMatch?.[1] || ""),
  };
}

function isPhaseHeaderLabel(text: string) {
  const normalized = normalizeToken(text);
  return [
    "gruppe",
    "halbfinale",
    "viertelfinale",
    "achtelfinale",
    "finale",
    "platz",
    "spielumplatz",
    "zwischenrunde",
    "vorrunde",
    "endrunde",
    "qualifikation",
    "ko",
  ].some((keyword) => normalized.includes(keyword));
}

function detectPhaseType(label: string) {
  const normalized = normalizeToken(label);
  if (normalized.includes("gruppe")) return "group";
  if (normalized.includes("achtelfinale")) return "round_of_16";
  if (normalized.includes("viertelfinale")) return "quarterfinal";
  if (normalized.includes("halbfinale")) return "semifinal";
  if (normalized.includes("finale")) return "final";
  if (normalized.includes("platz")) return "placement";
  if (normalized.includes("zwischenrunde")) return "intermediate_round";
  if (normalized.includes("vorrunde")) return "preliminary_round";
  if (normalized.includes("qualifikation")) return "qualification";
  if (normalized.includes("ko")) return "knockout";
  return "results";
}

function parseMatchTables(html: string) {
  const tables = extractTableHtmlBlocks(html);
  const matches: TournamentMatchRow[] = [];
  let bestHeaders: string[] = [];

  for (const table of tables) {
    const grid = buildTableGrid(table);
    const rowDetails = extractTableRowDetails(table);
    const headerIndex = grid.findIndex((row) => row.some((cell) => normalizeToken(cell) === "partie") && row.some((cell) => normalizeToken(cell).includes("begegnung")));
    if (headerIndex < 0) continue;

    const headers = deriveColumnLabels(grid, headerIndex + 1);
    if (!bestHeaders.length) {
      bestHeaders = headers.filter(Boolean);
    }

    let currentGroupLabel = "";
    for (let index = headerIndex + 1; index < rowDetails.length; index += 1) {
      const row = rowDetails[index];
      const values = row.cellsText.map((value) => cleanText(value));
      const filledValues = values.filter(Boolean);
      if (!filledValues.length) continue;

      if (filledValues.length <= 3 && isPhaseHeaderLabel(filledValues.join(" "))) {
        currentGroupLabel = filledValues.join(" ");
        continue;
      }

      const scoreIndex = values.findIndex((value) => /^\d+\s*:\s*\d+$/.test(value));
      const matchNoIndex = values.findIndex((value) => /^\d+$/.test(value));
      if (scoreIndex < 0) continue;

      const scheduleIndex = values.findIndex((value) => /\d{2}\.\d{2}\.\d{4}/.test(value));
      const leftIndex = findNearestFilledIndex(values, scoreIndex, -1, matchNoIndex >= 0 ? matchNoIndex : undefined);
      const rightIndex = scheduleIndex > scoreIndex
        ? findNearestFilledIndex(values, scoreIndex, 1, scheduleIndex)
        : findNearestFilledIndex(values, scoreIndex, 1);
      if (leftIndex < 0 || rightIndex < 0) continue;

      const score = values[scoreIndex];
      const scoreParts = score.split(":").map((part) => cleanText(part));
      const player1 = parsePlayerCell(row.cellsHtml[leftIndex] || "", values[leftIndex] || "", scoreParts[0] || "");
      const player2 = parsePlayerCell(row.cellsHtml[rightIndex] || "", values[rightIndex] || "", scoreParts[1] || "");
      if (!player1.name || !player2.name) continue;
      const matchPoints = calculateMatchPoints(player1.balls, player2.balls);
      player1.points = matchPoints.leftPoints;
      player2.points = matchPoints.rightPoints;

      const schedule = parseScheduledCell(scheduleIndex >= 0 ? values[scheduleIndex] : "");
      matches.push({
        groupLabel: currentGroupLabel,
        phaseLabel: currentGroupLabel || "Ergebnisse",
        phaseType: detectPhaseType(currentGroupLabel || "Ergebnisse"),
        matchNo: matchNoIndex >= 0 ? values[matchNoIndex] : String(matches.length + 1),
        score,
        scheduledDate: schedule.scheduledDate,
        scheduledTime: schedule.scheduledTime,
        player1,
        player2,
        details: [
          { label: "Phase", value: currentGroupLabel || "Ergebnisse" },
          { label: "Partie", value: matchNoIndex >= 0 ? values[matchNoIndex] : String(matches.length + 1) },
        ].filter((entry) => entry.value),
      });
    }
  }

  if (!matches.length) {
    throw new Error("Keine auswertbaren Begegnungen im Tab Ergebnisse gefunden.");
  }

  return {
    headers: bestHeaders,
    matches,
  };
}

async function loadTournamentResults(sourceUrl: string) {
  const mainPage = await fetchHtmlWithRetry(sourceUrl);
  const resultsTabUrl = extractResultsTabUrl(mainPage.html, mainPage.url);
  const resultsPage = resultsTabUrl && resultsTabUrl !== mainPage.url
    ? await fetchHtmlWithRetry(resultsTabUrl)
    : mainPage;

  const parsed = parseMatchTables(resultsPage.html);
  return {
    sourceUrl: mainPage.url,
    resultsUrl: resultsPage.url,
    meta: extractMeta(mainPage.html, mainPage.url),
    headers: parsed.headers,
    matches: parsed.matches,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST"
      ? await request.json().catch(() => ({})) as TournamentRequest
      : {};
    const sourceUrl = String(body?.sourceUrl || "").trim();
    const forceRefresh = Boolean(body?.forceRefresh);

    if (!sourceUrl) {
      return new Response(JSON.stringify({
        error: "missing-source-url",
        message: "Bitte eine NBV-Turnier-URL übergeben.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/^https:\/\/www\.ndbv\.de\/sb_(?:meisterschaft|einzelrangliste|einzelergebnisse)\.php/i.test(sourceUrl)) {
      return new Response(JSON.stringify({
        error: "invalid-source-url",
        message: "Erwartet wird eine NBV-Seite unter https://www.ndbv.de/sb_meisterschaft.php, https://www.ndbv.de/sb_einzelrangliste.php oder https://www.ndbv.de/sb_einzelergebnisse.php",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cacheKey = sourceUrl;
    const now = Date.now();
    const cached = responseCache.get(cacheKey);

    if (!forceRefresh && cached && now - cached.createdAt < CACHE_TTL_MS) {
      return new Response(JSON.stringify({
        ...cached.payload,
        cacheAgeSeconds: Math.max(0, Math.floor((now - cached.createdAt) / 1000)),
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
        },
      });
    }

    const result = await loadTournamentResults(sourceUrl);
    const payload: TournamentResponse = {
      sourceUrl: result.sourceUrl,
      resultsUrl: result.resultsUrl,
      fetchedAt: new Date(now).toISOString(),
      cacheAgeSeconds: 0,
      meta: result.meta,
      headers: result.headers,
      matches: result.matches,
    };

    responseCache.set(cacheKey, {
      createdAt: now,
      payload,
    });

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    console.error("get-nbv-tournament-results failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: "nbv-tournament-results-failed",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
