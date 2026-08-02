const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RankingRequest = {
  season?: string;
  disciplineId?: string;
  type?: "gd" | "btd";
};

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
  return cleanText(decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")));
}

function resolveHref(rawHref: string, baseUrl: string) {
  try {
    return new URL(rawHref, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function parseGermanNumber(value: string) {
  const parsed = Number(cleanText(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSeason(value: string) {
  const match = cleanText(value).match(/^(\d{4})\/(\d{4})$/);
  if (!match) return "";
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 ? `${start}/${end}` : "";
}

function normalizeDisciplineId(value: string) {
  const normalized = cleanText(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "billard-studio-nbv-ranking-list/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Rangliste nicht erreichbar: HTTP ${response.status}`);
  }

  return {
    html: await response.text(),
    url: response.url || url,
  };
}

function extractCells(rowHtml: string) {
  const cells: string[] = [];
  const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
    cells.push(cellMatch[1] || "");
  }
  return cells;
}

function extractRankingEntries(html: string, baseUrl: string) {
  const entries: Array<{
    rank: number;
    value: string;
    valueNumber: number;
    name: string;
    club: string;
    playerId: string;
    url: string;
  }> = [];

  const rowRegex = /<tr\b[^>]*class=['"][^'"]*(?:odd|even|red)[^'"]*['"][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1] || "");
    if (cells.length < 4) continue;

    const rank = Number(stripTags(cells[0]).replace(/\D+/g, ""));
    const value = stripTags(cells[1]);
    const valueNumber = parseGermanNumber(value);
    const nameCell = cells[3] || "";
    const nameMatch = nameCell.match(/<a\b[^>]*href=(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/i);
    const name = stripTags(nameMatch?.[3] || "");
    const club = stripTags(nameCell.replace(/[\s\S]*?<\/a>/i, "").replace(/<br\s*\/?>/gi, " "));
    const href = nameMatch?.[2] || "";
    const playerId = (href.match(/btd\.php\?p=20--[^-]+\/[^-]+---\d+-\d+-(\d+)-/i) || [])[1] || "";
    const url = href ? resolveHref(href, baseUrl) : "";

    if (!rank || valueNumber === null || !name) continue;
    entries.push({ rank, value, valueNumber, name, club, playerId, url });
  }

  return entries;
}

function normalizeNameKey(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeRankingEntries(entries: ReturnType<typeof extractRankingEntries>) {
  const byName = new Map<string, typeof entries[number]>();
  entries.forEach((entry) => {
    const key = normalizeNameKey(entry.name);
    if (!key) return;
    const existing = byName.get(key);
    if (!existing || (!existing.playerId && entry.playerId)) {
      byName.set(key, entry);
    }
  });
  return Array.from(byName.values()).sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (right.valueNumber !== left.valueNumber) return right.valueNumber - left.valueNumber;
    return left.name.localeCompare(right.name, "de");
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = request.method === "POST"
      ? await request.json().catch(() => ({})) as RankingRequest
      : {};
    const season = normalizeSeason(String(body?.season || ""));
    const disciplineId = normalizeDisciplineId(String(body?.disciplineId || ""));
    const type = body?.type === "gd" ? "gd" : "btd";
    const typeFlag = type === "gd" ? "1" : "2";

    if (!season || !disciplineId) {
      return new Response(JSON.stringify({
        error: "invalid-request",
        message: "Bitte Saison und Disziplin übergeben.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://ndbv.de/btd.php?p=20--${season}---${encodeURIComponent(disciplineId)}-2---${typeFlag}`;
    const page = await fetchHtml(url);
    const entries = dedupeRankingEntries(extractRankingEntries(page.html, page.url));

    return new Response(JSON.stringify({
      season,
      disciplineId,
      type,
      sourceUrl: page.url,
      fetchedAt: new Date().toISOString(),
      entries,
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: "ranking-list-failed",
      message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
