// ─────────────────────────────────────────────────────────────
// OppVerse – sync-opportunities Edge Function
// Strategy: RSS feeds (free discovery) + Gemini 1.5 Flash (single
// enrichment call) — reliable, quota-safe, real links.
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

// Use 1.5 Flash — higher free quota, no grounding needed
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const DB_TABLE = 'opportunities';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── RSS SOURCES (free, no API key needed) ───────────────────
// Mix of Google News + direct RSS feeds from real platforms
const RSS_QUERIES = [
  'hackathon India 2025 register',
  'internship India students apply 2025',
  'coding competition India open',
  'tech event India 2025',
  'college hackathon India',
  'fellowship India students 2025',
];

async function fetchRSS(query: string): Promise<any[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.map(m => {
      const block = m[1];
      const get = (tag: string) =>
        block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'))?.[1]?.trim() ?? '';

      const rawLink = get('link');
      // Extract actual URL from Google News redirect if possible
      const link = rawLink.includes('news.google.com')
        ? rawLink  // keep as-is, still a valid HTTP link
        : rawLink;

      return {
        title: get('title').replace(/\s*-\s*[^-]+$/, '').trim(),
        link,
        description: get('description').replace(/<[^>]+>/g, '').toLowerCase(),
        pubDate: get('pubDate'),
      };
    });
  } catch {
    return [];
  }
}

// ── FILTER: keep only real opportunity listings ──────────────
const TITLE_KEYWORDS = ['hackathon', 'internship', 'intern', 'competition', 'fellowship', 'workshop', 'bootcamp', 'challenge', 'event', 'grant', 'apply'];
const SKIP_KEYWORDS  = ['winner', 'winners', 'result', 'recap', 'review', 'opinion', 'what is', 'explained', 'history'];

function isRelevant(item: any): boolean {
  if (!item.link?.startsWith('http')) return false;
  const t = item.title.toLowerCase();
  const d = item.description.toLowerCase();
  if (SKIP_KEYWORDS.some(k => t.includes(k))) return false;
  return TITLE_KEYWORDS.some(k => t.includes(k) || d.includes(k));
}

// ── CATEGORY detector ────────────────────────────────────────
function detectCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('hack')) return 'Hackathon';
  if (t.includes('intern')) return 'Internship';
  if (t.includes('workshop') || t.includes('bootcamp')) return 'Workshop';
  return 'Event';
}

// ── SINGLE Gemini enrichment call ───────────────────────────
async function enrichWithGemini(items: any[], log: string[]): Promise<any[]> {
  if (!GEMINI_API_KEY) { log.push('No Gemini key — skipping enrichment'); return items; }

  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today    = new Date().toISOString().split('T')[0];

  const promptData = items.map((o, i) => ({ id: i, title: o.title, link: o.link }));

  const prompt = `Today is ${today}. You are enriching opportunity data for an Indian student platform.
Here are ${items.length} opportunities found via RSS feeds:
${JSON.stringify(promptData)}

For each item (matched by "id"), return a JSON array with:
- "id": same id number
- "location": Indian city or "Online" or "India"
- "mode": "Online", "Offline", or "Hybrid"
- "skills": relevant skills e.g. "Python, ML" or "Open to all"
- "eligibility": e.g. "UG Students", "Open to all"
- "team_size": e.g. "2-4 members" or "Individual" or "Check Website"
- "deadline": ISO date YYYY-MM-DD. If a real deadline is likely near, estimate it. Default: "${twoWeeks}"
- "venue": venue name/address or "Online" or "Check Website"
- "organization": organizer name (infer from title if possible)

Rules:
- Base answers on the title and URL — do NOT hallucinate fake deadlines
- Use "Check Website" only when you truly cannot infer the value
- Return ONLY a valid JSON array, no markdown fences`;

  try {
    log.push(`Gemini enriching ${items.length} items (single call)...`);
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.push(`Gemini enrich failed ${res.status}: ${err.slice(0, 200)}`);
      return items; // return unenriched items as fallback
    }

    const json = await res.json();
    const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let enriched: any[] = [];
    try {
      enriched = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { enriched = JSON.parse(m[0]); } catch { enriched = []; } }
    }

    if (!Array.isArray(enriched) || enriched.length === 0) {
      log.push('Gemini returned no enrichment data — using raw items');
      return items;
    }

    // Merge enrichment back by index
    const enrichMap: Record<number, any> = {};
    for (const e of enriched) { if (e.id !== undefined) enrichMap[e.id] = e; }

    log.push(`Gemini enriched ${Object.keys(enrichMap).length} items`);

    return items.map((o, i) => {
      const e = enrichMap[i] || {};
      return {
        title:        o.title,
        organization: e.organization || '',
        category:     detectCategory(o.title),
        location:     e.location     || 'India',
        mode:         e.mode         || 'Online',
        deadline:     e.deadline     || twoWeeks,
        link:         o.link,
        skills:       e.skills       || 'Check Website',
        eligibility:  e.eligibility  || 'Check Website',
        team_size:    e.team_size    || 'Check Website',
        venue:        e.venue        || 'Check Website',
      };
    });

  } catch (err) {
    log.push(`Gemini exception: ${err.message}`);
    return items;
  }
}

// ── MAIN ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const log: string[] = [];
  log.push(`Sync started at ${new Date().toISOString()}`);

  // Step 1: Fetch all RSS feeds in parallel (free, no quota)
  log.push(`Fetching ${RSS_QUERIES.length} RSS feeds in parallel...`);
  const rssResults = await Promise.allSettled(RSS_QUERIES.map(q => fetchRSS(q)));

  const rawItems: any[] = [];
  for (const r of rssResults) {
    if (r.status === 'fulfilled') rawItems.push(...r.value);
  }
  log.push(`RSS total: ${rawItems.length} items`);

  // Step 2: Filter for relevant items
  let filtered = rawItems.filter(isRelevant);
  if (filtered.length < 5) {
    log.push('Fewer than 5 after filter — using top 10 raw items as fallback');
    filtered = rawItems.slice(0, 10);
  }

  // Step 3: Deduplicate by link
  const seen = new Set<string>();
  const unique = filtered.filter(o => {
    if (seen.has(o.link)) return false;
    seen.add(o.link);
    return true;
  }).slice(0, 20); // cap at 20 to keep Gemini prompt small

  log.push(`After dedup: ${unique.length} items`);

  // Step 4: Single Gemini enrichment call
  const enriched = await enrichWithGemini(unique, log);

  // Normalize deadlines — never store "Check Website" in deadline column
  // because the frontend Supabase filter (deadline.gte.today) would hide them
  const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const readyToSave = enriched.map(o => ({
    ...o,
    deadline: (o.deadline && o.deadline !== 'Check Website' && /^\d{4}-\d{2}-\d{2}/.test(o.deadline))
      ? o.deadline
      : twoWeeksFromNow,   // always a real future date
  }));

  log.push(`Normalized deadlines. Sample: ${readyToSave[0]?.deadline}`);

  // Upsert to Supabase — ignoreDuplicates:false so stale entries get refreshed
  const { data: inserted, error: dbError } = await supabase
    .from(DB_TABLE)
    .upsert(readyToSave, { onConflict: 'link', ignoreDuplicates: false })
    .select();

  if (dbError) {
    log.push(`DB Error: ${dbError.message}`);
  } else {
    log.push(`Saved: ${inserted?.length ?? 0} new entries to DB`);
  }

  return new Response(
    JSON.stringify({ log, count: enriched.length, saved: inserted?.length ?? 0 }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});