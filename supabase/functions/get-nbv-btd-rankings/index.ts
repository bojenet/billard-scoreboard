const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const LANDING_URLS = [
  "https://www.ndbv.de/btd.php",
];

type RankingRequest = {
  forceRefresh?: boolean;
};

type RankingRow = {
  id: string;
  rank: string;
  playerName: string;
  club: string;
  balls: string;
  innings: string;
  gd: string;
  hs: string;
  bestGame: string;
  btg: string;
  earnedClassCurrentSeason: string;
  gdPrevSeason1: string;
  earnedClassPrevSeason1: string;
  gdPrevSeason2: string;
  earnedClassPrevSeason2: string;
  currentClass: string;
  details: Array<{ label: string; value: string }>;
};

type DisciplineSummary = {
  id: string;
  label: string;
  order: number;
};

type DisciplineRanking = {
  disciplineId: string;
  disciplineLabel: string;
  rows: RankingRow[];
};

type RankingResponse = {
  disciplines: DisciplineSummary[];
  rankings: DisciplineRanking[];
  fetchedAt: string;
  cacheAgeSeconds: number;
  sourceUrl: string;
  failedDisciplines: Array<{ id: string; label: string; message: string }>;
};

type CachedPayload = {
  createdAt: number;
  payload: RankingResponse;
};

type HtmlResult = {
  html: string;
  url: string;
};

type DisciplineLink = {
  id: string;
  label: string;
  url: string;
  order: number;
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
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : "";
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

function replaceGermanChars(value: string) {
  return String(value || "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
}

function normalizeToken(value: string) {
  return replaceGermanChars(cleanText(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function slugify(value: string) {
  return replaceGermanChars(cleanText(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "discipline";
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
      "User-Agent": "billard-studio-btd/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`BTD request failed with HTTP ${response.status}`);
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

async function fetchFirstAvailableHtml(urls: string[]) {
  const failures: string[] = [];

  for (const url of urls) {
    try {
      return await fetchHtmlWithRetry(url);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`BTD landing page not reachable. ${failures.join(" | ")}`);
}

function isLikelyDisciplineLabel(label: string) {
  const normalized = normalizeToken(label);
  if (!normalized || normalized.length < 3) return false;
  const keywords = [
    "cadre",
    "band",
    "einband",
    "freiepartie",
    "partie",
    "dreiband",
    "biathlon",
    "kegel",
    "eurokegel",
    "352",
    "472",
    "522",
    "712",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isLikelyDisciplineHref(href: string) {
  const normalized = String(href || "").toLowerCase();
  return normalized.includes("btd.php");
}

function resolveHref(rawHref: string, baseUrl: string) {
  try {
    return new URL(rawHref, baseUrl).toString();
  } catch (_) {
    return "";
  }
}

function addDisciplineCandidate(
  candidates: DisciplineLink[],
  seen: Set<string>,
  label: string,
  href: string,
  baseUrl: string,
  order: number,
) {
  const cleanLabel = cleanText(label);
  const resolvedHref = resolveHref(href, baseUrl);
  if (!cleanLabel || !resolvedHref) return;
  if (!isLikelyDisciplineHref(resolvedHref) || !isLikelyDisciplineLabel(cleanLabel)) return;
  const key = `${normalizeToken(cleanLabel)}::${resolvedHref}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({
    id: slugify(cleanLabel),
    label: cleanLabel,
    url: resolvedHref,
    order,
  });
}

function extractDisciplineLinks(html: string, baseUrl: string) {
  const candidates: DisciplineLink[] = [];
  const seen = new Set<string>();
  let order = 0;

  const inlineLinkRegex = /<a\b([^>]*)href=(['"])([^'"]*btd\.php[^'"]*)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineLinkRegex.exec(html)) !== null) {
    const rawLabel = stripTags(inlineMatch[5]);
    addDisciplineCandidate(candidates, seen, rawLabel, inlineMatch[3], baseUrl, order);
    order += 1;
  }

  const optionRegex = /<option\b([^>]*)value=(['"])([^'"]*btd\.php[^'"]*)\2([^>]*)>([\s\S]*?)<\/option>/gi;
  let optionMatch: RegExpExecArray | null;
  while ((optionMatch = optionRegex.exec(html)) !== null) {
    addDisciplineCandidate(candidates, seen, stripTags(optionMatch[5]), optionMatch[3], baseUrl, order);
    order += 1;
  }

  const onclickRegex = /<([a-z0-9]+)\b([^>]*)onclick=(['"])([\s\S]*?)\3([^>]*)>([\s\S]*?)<\/\1>/gi;
  let onclickMatch: RegExpExecArray | null;
  while ((onclickMatch = onclickRegex.exec(html)) !== null) {
    const rawLabel = stripTags(onclickMatch[6]);
    const matches = onclickMatch[4].match(/['"]([^'"]*btd\.php[^'"]*)['"]/gi) || [];
    matches.forEach((match) => {
      const href = match.replace(/^['"]|['"]$/g, "");
      addDisciplineCandidate(candidates, seen, rawLabel, href, baseUrl, order);
      order += 1;
    });
  }

  return candidates;
}

function extractSeasonLabel(text: string) {
  const match = cleanText(text).match(/\b(20\d{2})\/(?:(20)?(\d{2}|\d{4}))\b/);
  if (!match) return "";
  if (match[3].length === 4) return `${match[1]}/${match[3]}`;
  return `${match[1]}/${match[3]}`;
}

function seasonLabelToToken(seasonLabel: string) {
  const match = String(seasonLabel || "").match(/^20(\d{2})\/(?:20)?(\d{2})$/);
  if (!match) return "";
  return `${match[1]}${match[2]}`;
}

function previousSeasonToken(token: string, step: number) {
  if (!/^\d{4}$/.test(token)) return "";
  const start = 2000 + Number(token.slice(0, 2));
  const end = 2000 + Number(token.slice(2, 4));
  const prevStart = start - step;
  const prevEnd = end - step;
  return `${String(prevStart).slice(-2)}${String(prevEnd).slice(-2)}`;
}

function extractDisciplineLabelFromPage(html: string) {
  const titleCandidates = [
    stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""),
    stripTags((html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || ""),
    stripTags((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
    stripTags(html).slice(0, 200),
  ].filter(Boolean);

  for (const candidate of titleCandidates) {
    const match = candidate.match(/Rangliste\s+(.+?)\s+TB/i);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
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
    if (nonEmpty.length < 4) continue;
    const first = cleanText(nonEmpty[0]);
    if (/^\d+$/.test(first)) {
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

function buildSeasonColumnLookup(headers: string[], currentSeasonToken: string) {
  const gdSeasonColumns: string[] = [];
  const classSeasonColumns: string[] = [];

  headers.forEach((header) => {
    const raw = cleanText(header);
    const normalized = normalizeToken(raw);
    const seasonMatch = raw.match(/(?:20)?(\d{2})\s*\/\s*(?:20)?(\d{2})/);
    if (!seasonMatch) return;
    const token = `${seasonMatch[1]}${seasonMatch[2]}`;
    if (normalized.startsWith("gd")) {
      gdSeasonColumns.push(token);
    }
    if (normalized.includes("erspielteklasse")) {
      classSeasonColumns.push(token);
    }
  });

  const orderedPrevious = [previousSeasonToken(currentSeasonToken, 1), previousSeasonToken(currentSeasonToken, 2)].filter(Boolean);
  return {
    gdPrev1Token: orderedPrevious[0] || gdSeasonColumns[0] || "",
    gdPrev2Token: orderedPrevious[1] || gdSeasonColumns[1] || "",
    classCurrentToken: currentSeasonToken || classSeasonColumns[0] || "",
    classPrev1Token: orderedPrevious[0] || classSeasonColumns[1] || "",
    classPrev2Token: orderedPrevious[1] || classSeasonColumns[2] || "",
  };
}

function createRowId(disciplineId: string, rank: string, playerName: string, club: string) {
  return `${disciplineId}-${rank}-${playerName}-${club}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isDecimalValue(value: string) {
  return /^\d+(?:[.,]\d+)?$/.test(cleanText(value));
}

function isIntegerValue(value: string) {
  return /^\d+$/.test(cleanText(value));
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

function extractPlayerAndClub(row: TableRowDetail) {
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

    if (playerName && !isIntegerValue(playerName)) {
      return {
        playerName,
        club,
      };
    }
  }

  const fallbackText = row.cellsText.find((value) => /[a-zA-ZÄÖÜäöüß]/.test(value) && !isIntegerValue(value)) || "";
  const fallbackParts = fallbackText
    .split("\n")
    .map((entry) => cleanText(entry))
    .filter(Boolean);

  return {
    playerName: fallbackParts[0] || "",
    club: fallbackParts[1] || "",
  };
}

function findBtdValue(row: TableRowDetail, rank: string) {
  const values = row.cellsText.map((value) => cleanText(value)).filter(Boolean);
  for (const value of values) {
    if (value === rank) continue;
    if (isDecimalValue(value) && /[.,]/.test(value)) {
      return value;
    }
  }
  return "";
}

function parseRankingRows(
  disciplineId: string,
  headers: string[],
  rows: TableRowDetail[],
  pageLabel: string,
  pageText: string,
) {
  const seasonLabel = extractSeasonLabel(`${pageLabel} ${pageText}`);
  const currentSeasonToken = seasonLabelToToken(seasonLabel);
  const seasonLookup = buildSeasonColumnLookup(headers, currentSeasonToken);

  const rankIndex = findHeaderIndex(headers, (normalized) => normalized === "rang" || normalized === "platz" || normalized === "nr") >= 0
    ? findHeaderIndex(headers, (normalized) => normalized === "rang" || normalized === "platz" || normalized === "nr")
    : 0;
  const firstNameIndex = findHeaderIndex(headers, (normalized) => normalized === "vorname");
  const lastNameIndex = findHeaderIndex(headers, (normalized) => normalized === "name" || normalized === "nachname");
  const combinedNameIndex = findHeaderIndex(headers, (normalized) => normalized.includes("namevorname") || normalized === "spieler" || normalized === "name");
  const clubIndex = findHeaderIndex(headers, (normalized) => normalized.includes("verein") || normalized.includes("club"));
  const ballsIndex = findHeaderIndex(headers, (normalized) => normalized.includes("balle") || normalized.includes("baelle"));
  const inningsIndex = findHeaderIndex(headers, (normalized) => normalized.includes("aufnahmen"));
  const gdIndex = findHeaderIndex(headers, (normalized) => normalized === "gd" || normalized.startsWith("gd"));
  const hsIndex = findHeaderIndex(headers, (normalized) => normalized === "hs" || normalized.includes("hoechstserie") || normalized.includes("hochserie"));
  const bestGameIndex = findHeaderIndex(headers, (normalized) => normalized.includes("bestepartie") || normalized.includes("bestpartie"));
  const btgIndex = findHeaderIndex(headers, (normalized) => normalized === "btg");
  const currentClassIndex = findHeaderIndex(headers, (normalized) => normalized.includes("klasseaktuell") || normalized.includes("aktuelleklasse"));
  const earnedClassCurrentIndex = seasonLookup.classCurrentToken
    ? findHeaderIndex(headers, (_normalized, raw) => normalizeToken(raw).includes(`erspielteklasse${seasonLookup.classCurrentToken}`))
    : findHeaderIndex(headers, (normalized) => normalized.includes("erspielteklasse"));
  const gdPrev1Index = seasonLookup.gdPrev1Token
    ? findHeaderIndex(headers, (_normalized, raw) => normalizeToken(raw).startsWith(`gd${seasonLookup.gdPrev1Token}`))
    : -1;
  const earnedClassPrev1Index = seasonLookup.classPrev1Token
    ? findHeaderIndex(headers, (_normalized, raw) => normalizeToken(raw).includes(`erspielteklasse${seasonLookup.classPrev1Token}`))
    : -1;
  const gdPrev2Index = seasonLookup.gdPrev2Token
    ? findHeaderIndex(headers, (_normalized, raw) => normalizeToken(raw).startsWith(`gd${seasonLookup.gdPrev2Token}`))
    : -1;
  const earnedClassPrev2Index = seasonLookup.classPrev2Token
    ? findHeaderIndex(headers, (_normalized, raw) => normalizeToken(raw).includes(`erspielteklasse${seasonLookup.classPrev2Token}`))
    : -1;

  return rows
    .map((row) => {
      const values = row.cellsText;
      const rank = cleanText(values[rankIndex] || values[0]);
      if (!/^\d+$/.test(rank)) return null;

      let playerName = "";
      if (firstNameIndex >= 0 && lastNameIndex >= 0 && firstNameIndex !== lastNameIndex) {
        const parts = [
          { index: firstNameIndex, value: cleanText(values[firstNameIndex]) },
          { index: lastNameIndex, value: cleanText(values[lastNameIndex]) },
        ]
          .filter((entry) => entry.value)
          .sort((left, right) => left.index - right.index)
          .map((entry) => entry.value);
        playerName = parts.join(" ");
      }
      if (!playerName && combinedNameIndex >= 0) {
        playerName = cleanText(values[combinedNameIndex]);
      }
      if (!playerName && lastNameIndex >= 0) {
        playerName = cleanText(values[lastNameIndex]);
      }

      const extractedPlayer = extractPlayerAndClub(row);
      if (!playerName || isIntegerValue(playerName)) {
        playerName = extractedPlayer.playerName;
      }

      let club = cleanText(values[clubIndex]);
      if (!club) {
        club = extractedPlayer.club;
      }

      const btdValue = cleanText(values[btgIndex]) || findBtdValue(row, rank);
      const details = headers
        .map((header, index) => ({
          label: cleanText(header) || `Spalte ${index + 1}`,
          value: cleanText(values[index]),
        }))
        .filter((entry) => entry.value);

      if (!playerName && !club) return null;

      return {
        id: createRowId(disciplineId, rank, playerName, club),
        rank,
        playerName,
        club,
        balls: cleanText(values[ballsIndex]),
        innings: cleanText(values[inningsIndex]),
        gd: cleanText(values[gdIndex]),
        hs: cleanText(values[hsIndex]),
        bestGame: cleanText(values[bestGameIndex]),
        btg: btdValue,
        earnedClassCurrentSeason: cleanText(values[earnedClassCurrentIndex]),
        gdPrevSeason1: cleanText(values[gdPrev1Index]),
        earnedClassPrevSeason1: cleanText(values[earnedClassPrev1Index]),
        gdPrevSeason2: cleanText(values[gdPrev2Index]),
        earnedClassPrevSeason2: cleanText(values[earnedClassPrev2Index]),
        currentClass: cleanText(values[currentClassIndex]),
        details,
      } satisfies RankingRow;
    })
    .filter((row): row is RankingRow => Boolean(row));
}

function parseRankingTable(html: string, disciplineId: string, fallbackLabel: string) {
  const tables = extractTableHtmlBlocks(html);
  const pageLabel = extractDisciplineLabelFromPage(html) || fallbackLabel;
  const pageText = stripTags(html);

  let bestRows: RankingRow[] = [];
  for (const table of tables) {
    const grid = buildTableGrid(table);
    const rowDetails = extractTableRowDetails(table);
    const dataStartIndex = findDataStartIndex(grid);
    if (dataStartIndex < 0) continue;
    const headers = deriveColumnLabels(grid, dataStartIndex);
    const rows = parseRankingRows(disciplineId, headers, rowDetails.slice(dataStartIndex), pageLabel, pageText);
    if (rows.length > bestRows.length) {
      bestRows = rows;
    }
  }

  if (!bestRows.length) {
    throw new Error(`Keine auswertbare Ranglisten-Tabelle für ${fallbackLabel} gefunden.`);
  }

  return {
    disciplineLabel: pageLabel,
    rows: bestRows,
  };
}

async function loadDisciplinesAndRankings() {
  const landing = await fetchFirstAvailableHtml(LANDING_URLS);
  const resolvedLanding = landing;
  const landingPageLabel = extractDisciplineLabelFromPage(resolvedLanding.html);
  const candidates = extractDisciplineLinks(resolvedLanding.html, resolvedLanding.url);

  const disciplineLinks = candidates.length
    ? candidates
    : [{
        id: slugify(landingPageLabel || "rangliste"),
        label: landingPageLabel || "Rangliste",
        url: resolvedLanding.url,
        order: 0,
      }];

  const disciplines: DisciplineSummary[] = [];
  const rankings: DisciplineRanking[] = [];
  const failedDisciplines: Array<{ id: string; label: string; message: string }> = [];

  for (const discipline of disciplineLinks) {
    try {
      const result = discipline.url === resolvedLanding.url
        ? parseRankingTable(resolvedLanding.html, discipline.id, discipline.label)
        : parseRankingTable((await fetchHtmlWithRetry(discipline.url)).html, discipline.id, discipline.label);

      disciplines.push({
        id: discipline.id,
        label: result.disciplineLabel || discipline.label,
        order: discipline.order,
      });
      rankings.push({
        disciplineId: discipline.id,
        disciplineLabel: result.disciplineLabel || discipline.label,
        rows: result.rows,
      });
    } catch (error) {
      failedDisciplines.push({
        id: discipline.id,
        label: discipline.label,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await delay(120);
  }

  if (!rankings.length) {
    throw new Error(failedDisciplines[0]?.message || "Keine Schnitte konnten geladen werden.");
  }

  const mergedDisciplines = rankings
    .map((ranking, index) => {
      const discipline = disciplines.find((entry) => entry.id === ranking.disciplineId);
      return {
        id: ranking.disciplineId,
        label: ranking.disciplineLabel,
        order: discipline?.order ?? index,
      };
    })
    .sort((left, right) => left.order - right.order);

  const sortedRankings = rankings
    .map((ranking) => {
      const discipline = mergedDisciplines.find((entry) => entry.id === ranking.disciplineId);
      return {
        disciplineId: ranking.disciplineId,
        disciplineLabel: ranking.disciplineLabel,
        order: discipline?.order ?? 0,
        rows: ranking.rows.sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999)),
      };
    })
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...ranking }) => ranking);

  return {
    disciplines: mergedDisciplines,
    rankings: sortedRankings,
    sourceUrl: resolvedLanding.url,
    failedDisciplines,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST"
      ? await request.json().catch(() => ({})) as RankingRequest
      : {};
    const forceRefresh = Boolean(body?.forceRefresh);
    const cacheKey = "default";
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

    const result = await loadDisciplinesAndRankings();
    const payload: RankingResponse = {
      disciplines: result.disciplines,
      rankings: result.rankings,
      fetchedAt: new Date(now).toISOString(),
      cacheAgeSeconds: 0,
      sourceUrl: result.sourceUrl,
      failedDisciplines: result.failedDisciplines,
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
    console.error("get-nbv-btd-rankings failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(JSON.stringify({
      error: "nbv-btd-rankings-failed",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
