const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const LANDING_URLS = [
  "https://www.ndbv.de/btd.php",
  "https://ndbv.club-cloud.de/btd.php",
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

const responseCache = new Map<string, CachedPayload>();

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    headers: {
      "User-Agent": "billard-studio-btd/1.0",
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

function parseHtmlDocument(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    throw new Error("BTD HTML konnte nicht geparst werden.");
  }
  return doc;
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
  const doc = parseHtmlDocument(html);
  const candidates: DisciplineLink[] = [];
  const seen = new Set<string>();
  let order = 0;

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    addDisciplineCandidate(
      candidates,
      seen,
      cleanText(anchor.textContent),
      anchor.getAttribute("href") || "",
      baseUrl,
      order,
    );
    order += 1;
  });

  doc.querySelectorAll("[onclick]").forEach((element) => {
    const onclick = element.getAttribute("onclick") || "";
    const label = cleanText(element.textContent);
    const matches = onclick.match(/['"]([^'"]*btd\.php[^'"]*)['"]/gi) || [];
    matches.forEach((match) => {
      const href = match.replace(/^['"]|['"]$/g, "");
      addDisciplineCandidate(candidates, seen, label, href, baseUrl, order);
      order += 1;
    });
  });

  doc.querySelectorAll("option").forEach((option) => {
    const value = option.getAttribute("value") || "";
    const label = cleanText(option.textContent);
    if (value.includes("btd.php")) {
      addDisciplineCandidate(candidates, seen, label, value, baseUrl, order);
      order += 1;
    }
  });

  const inlineLinkRegex = /<a[^>]+href=(['"])([^'"]*btd\.php[^'"]*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineLinkRegex.exec(html)) !== null) {
    const rawLabel = cleanText(inlineMatch[3].replace(/<[^>]+>/g, " "));
    addDisciplineCandidate(candidates, seen, rawLabel, inlineMatch[2], baseUrl, order);
    order += 1;
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

function extractDisciplineLabelFromPage(doc: Document) {
  const titleCandidates = [
    cleanText(doc.querySelector("h1")?.textContent),
    cleanText(doc.querySelector("h2")?.textContent),
    cleanText(doc.title),
    cleanText(doc.body?.textContent).slice(0, 200),
  ].filter(Boolean);

  for (const candidate of titleCandidates) {
    const match = candidate.match(/Rangliste\s+(.+?)\s+TB/i);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
}

function buildTableGrid(table: Element) {
  const rows: string[][] = [];
  const spanMap: Record<number, number> = {};

  table.querySelectorAll("tr").forEach((tr) => {
    const row: string[] = [];
    let columnIndex = 0;

    while (spanMap[columnIndex] > 0) {
      spanMap[columnIndex] -= 1;
      columnIndex += 1;
    }

    tr.querySelectorAll("th, td").forEach((cell) => {
      while (spanMap[columnIndex] > 0) {
        spanMap[columnIndex] -= 1;
        columnIndex += 1;
      }

      const cellText = cleanText(cell.textContent);
      const colspan = Math.max(1, Number(cell.getAttribute("colspan") || "1"));
      const rowspan = Math.max(1, Number(cell.getAttribute("rowspan") || "1"));

      for (let offset = 0; offset < colspan; offset += 1) {
        row[columnIndex + offset] = cellText;
        if (rowspan > 1) {
          spanMap[columnIndex + offset] = rowspan - 1;
        }
      }

      columnIndex += colspan;
    });

    rows.push(row.map((cell) => cleanText(cell)));
  });

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

function parseRankingRows(
  disciplineId: string,
  headers: string[],
  rows: string[][],
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
      const rank = cleanText(row[rankIndex] || row[0]);
      if (!/^\d+$/.test(rank)) return null;

      let playerName = "";
      if (firstNameIndex >= 0 && lastNameIndex >= 0 && firstNameIndex !== lastNameIndex) {
        const parts = [
          { index: firstNameIndex, value: cleanText(row[firstNameIndex]) },
          { index: lastNameIndex, value: cleanText(row[lastNameIndex]) },
        ]
          .filter((entry) => entry.value)
          .sort((left, right) => left.index - right.index)
          .map((entry) => entry.value);
        playerName = parts.join(" ");
      }
      if (!playerName && combinedNameIndex >= 0) {
        playerName = cleanText(row[combinedNameIndex]);
      }
      if (!playerName && lastNameIndex >= 0) {
        playerName = cleanText(row[lastNameIndex]);
      }

      const club = cleanText(row[clubIndex]);
      const details = headers
        .map((header, index) => ({
          label: cleanText(header) || `Spalte ${index + 1}`,
          value: cleanText(row[index]),
        }))
        .filter((entry) => entry.value);

      if (!playerName && !club) return null;

      return {
        id: createRowId(disciplineId, rank, playerName, club),
        rank,
        playerName,
        club,
        balls: cleanText(row[ballsIndex]),
        innings: cleanText(row[inningsIndex]),
        gd: cleanText(row[gdIndex]),
        hs: cleanText(row[hsIndex]),
        bestGame: cleanText(row[bestGameIndex]),
        btg: cleanText(row[btgIndex]),
        earnedClassCurrentSeason: cleanText(row[earnedClassCurrentIndex]),
        gdPrevSeason1: cleanText(row[gdPrev1Index]),
        earnedClassPrevSeason1: cleanText(row[earnedClassPrev1Index]),
        gdPrevSeason2: cleanText(row[gdPrev2Index]),
        earnedClassPrevSeason2: cleanText(row[earnedClassPrev2Index]),
        currentClass: cleanText(row[currentClassIndex]),
        details,
      } satisfies RankingRow;
    })
    .filter((row): row is RankingRow => Boolean(row));
}

function parseRankingTable(html: string, disciplineId: string, fallbackLabel: string) {
  const doc = parseHtmlDocument(html);
  const tables = Array.from(doc.querySelectorAll("table"));
  const pageLabel = extractDisciplineLabelFromPage(doc) || fallbackLabel;
  const pageText = cleanText(doc.body?.textContent);

  let bestRows: RankingRow[] = [];
  for (const table of tables) {
    const grid = buildTableGrid(table);
    const dataStartIndex = findDataStartIndex(grid);
    if (dataStartIndex < 0) continue;
    const headers = deriveColumnLabels(grid, dataStartIndex);
    const rows = parseRankingRows(disciplineId, headers, grid.slice(dataStartIndex), pageLabel, pageText);
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
  const landingDoc = parseHtmlDocument(landing.html);
  const landingPageLabel = extractDisciplineLabelFromPage(landingDoc);
  const candidates = extractDisciplineLinks(landing.html, landing.url);

  const disciplineLinks = candidates.length
    ? candidates
    : [{
        id: slugify(landingPageLabel || "rangliste"),
        label: landingPageLabel || "Rangliste",
        url: landing.url,
        order: 0,
      }];

  const disciplines: DisciplineSummary[] = [];
  const rankings: DisciplineRanking[] = [];
  const failedDisciplines: Array<{ id: string; label: string; message: string }> = [];

  for (const discipline of disciplineLinks) {
    try {
      const result = discipline.url === landing.url
        ? parseRankingTable(landing.html, discipline.id, discipline.label)
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
    sourceUrl: landing.url,
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
