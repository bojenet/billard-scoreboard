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

type TournamentResultRow = {
  rank: string;
  playerName: string;
  club: string;
  gd: string;
  hs: string;
  points: string;
  details: Array<{ label: string; value: string }>;
};

type TournamentMeta = {
  title: string;
  season: string;
  date: string;
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
  results: TournamentResultRow[];
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
    .replace(/&Auml;/gi, "Ä")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : "";
    });
}

function stripTags(value: string) {
  return cleanText(
    decodeHtmlEntities(
      String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/\n+/g, "\n"),
  );
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
    const urlMatch = onclickMatch[4].match(/['"]([^'"]*sb_meisterschaft\.php[^'"]*)['"]/i);
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
  const titleCandidates = [
    stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""),
    stripTags((html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ""),
    stripTags((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
  ].filter(Boolean);
  const pageTitle = titleCandidates[0] || "";
  const seasonMatch = sourceUrl.match(/20-\d{2}-(20\d{2}\/20\d{2})-/);
  const dateMatch = pageText.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);

  return {
    title: pageTitle || extractMetaValue(pageText, "Turnier") || extractMetaValue(pageText, "Bezeichnung"),
    season: seasonMatch?.[1] || extractMetaValue(pageText, "Saison"),
    date: parseGermanDateToIso(dateMatch?.[1] || extractMetaValue(pageText, "Datum")),
    discipline: extractMetaValue(pageText, "Disziplin") || extractMetaValue(pageText, "Kategorie"),
    location: extractMetaValue(pageText, "Austragungsort") || extractMetaValue(pageText, "Spiellokal") || extractMetaValue(pageText, "Ort"),
    status: extractMetaValue(pageText, "Status") || (pageText.includes("Ergebnisse") ? "beendet" : ""),
  };
}

function extractPlayerAndClub(row: TableRowDetail, combinedNameIndex: number, clubIndex: number) {
  const directName = combinedNameIndex >= 0 ? cleanText(row.cellsText[combinedNameIndex]) : "";
  const directClub = clubIndex >= 0 ? cleanText(row.cellsText[clubIndex]) : "";
  if (directName && directClub) {
    return { playerName: directName, club: directClub };
  }

  for (let index = row.cellsHtml.length - 1; index >= 0; index -= 1) {
    const html = row.cellsHtml[index] || "";
    const text = row.cellsText[index] || "";
    const anchors = extractAnchorTexts(html);
    if (!anchors.length && !/[a-zA-ZÄÖÜäöüß]/.test(text)) continue;

    let playerName = anchors[0] || "";
    let club = "";

    if (anchors[0]) {
      const parts = stripTags(html)
        .split("\n")
        .map((entry) => cleanText(entry))
        .filter(Boolean);
      const remaining = parts.filter((entry) => entry !== anchors[0]);
      club = remaining[0] || "";
    } else {
      const parts = text
        .split("\n")
        .map((entry) => cleanText(entry))
        .filter(Boolean);
      playerName = parts[0] || "";
      club = parts[1] || "";
    }

    if (playerName && !/^\d+$/.test(playerName)) {
      return {
        playerName: directName || playerName,
        club: directClub || club,
      };
    }
  }

  return {
    playerName: directName,
    club: directClub,
  };
}

function scoreResultTable(headers: string[], rows: TableRowDetail[]) {
  if (!rows.length) return -1;
  const headerScore =
    (findHeaderIndex(headers, (normalized) => normalized === "rang" || normalized === "platz") >= 0 ? 5 : 0) +
    (findHeaderIndex(headers, (normalized) => normalized === "name" || normalized === "spieler" || normalized.includes("name")) >= 0 ? 5 : 0) +
    (findHeaderIndex(headers, (normalized) => normalized.includes("verein") || normalized.includes("club")) >= 0 ? 3 : 0) +
    (findHeaderIndex(headers, (normalized) => normalized === "gd") >= 0 ? 1 : 0) +
    (findHeaderIndex(headers, (normalized) => normalized === "hs") >= 0 ? 1 : 0);
  const rankLikeRows = rows.filter((row) => /^\d+$/.test(cleanText(row.cellsText[0] || ""))).length;
  return headerScore + rankLikeRows;
}

function parseResultsTable(html: string) {
  const tables = extractTableHtmlBlocks(html);
  let best:
    | {
        headers: string[];
        rows: TournamentResultRow[];
      }
    | null = null;
  let bestScore = -1;

  for (const table of tables) {
    const grid = buildTableGrid(table);
    const rowDetails = extractTableRowDetails(table);
    const dataStartIndex = findDataStartIndex(grid);
    if (dataStartIndex < 0) continue;

    const headers = deriveColumnLabels(grid, dataStartIndex);
    const dataRows = rowDetails.slice(dataStartIndex);
    const score = scoreResultTable(headers, dataRows);
    if (score < bestScore) continue;

    const rankIndex = findHeaderIndex(headers, (normalized) => normalized === "rang" || normalized === "platz") >= 0
      ? findHeaderIndex(headers, (normalized) => normalized === "rang" || normalized === "platz")
      : 0;
    const combinedNameIndex = findHeaderIndex(headers, (normalized) => normalized === "name" || normalized === "spieler" || normalized.includes("name"));
    const clubIndex = findHeaderIndex(headers, (normalized) => normalized.includes("verein") || normalized.includes("club"));
    const gdIndex = findHeaderIndex(headers, (normalized) => normalized === "gd" || normalized.startsWith("gd"));
    const hsIndex = findHeaderIndex(headers, (normalized) => normalized === "hs" || normalized.includes("hochserie") || normalized.includes("hoechstserie"));
    const pointsIndex = findHeaderIndex(headers, (normalized) => normalized === "punkte" || normalized === "pkt" || normalized === "matchpunkte");

    const parsedRows = dataRows
      .map((row) => {
        const rank = cleanText(row.cellsText[rankIndex] || row.cellsText[0]);
        if (!/^\d+$/.test(rank)) return null;

        const person = extractPlayerAndClub(row, combinedNameIndex, clubIndex);
        if (!person.playerName) return null;

        const details = headers
          .map((header, index) => ({
            label: cleanText(header) || `Spalte ${index + 1}`,
            value: cleanText(row.cellsText[index]),
          }))
          .filter((entry) => entry.value);

        return {
          rank,
          playerName: person.playerName,
          club: person.club,
          gd: cleanText(row.cellsText[gdIndex]),
          hs: cleanText(row.cellsText[hsIndex]),
          points: cleanText(row.cellsText[pointsIndex]),
          details,
        } satisfies TournamentResultRow;
      })
      .filter((row): row is TournamentResultRow => Boolean(row));

    if (parsedRows.length > 0) {
      best = {
        headers,
        rows: parsedRows,
      };
      bestScore = score;
    }
  }

  if (!best) {
    throw new Error("Keine auswertbare Ergebnistabelle gefunden.");
  }

  return best;
}

async function loadTournamentResults(sourceUrl: string) {
  const mainPage = await fetchHtmlWithRetry(sourceUrl);
  const resultsTabUrl = extractResultsTabUrl(mainPage.html, mainPage.url);
  const resultsPage = resultsTabUrl && resultsTabUrl !== mainPage.url
    ? await fetchHtmlWithRetry(resultsTabUrl)
    : mainPage;

  const parsed = parseResultsTable(resultsPage.html);
  return {
    sourceUrl: mainPage.url,
    resultsUrl: resultsPage.url,
    meta: extractMeta(mainPage.html, mainPage.url),
    headers: parsed.headers,
    results: parsed.rows,
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

    if (!/^https:\/\/www\.ndbv\.de\/sb_meisterschaft\.php/i.test(sourceUrl)) {
      return new Response(JSON.stringify({
        error: "invalid-source-url",
        message: "Erwartet wird eine NBV-Turnierseite unter https://www.ndbv.de/sb_meisterschaft.php",
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
      results: result.results,
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
