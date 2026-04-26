// ─────────────────────────────────────────────────────────────
// OppVerse – sync-opportunities Edge Function (FIXED VERSION)
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const DB_TABLE       = 'opportunities';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Keyword lists ──────────────────────
const TITLE_KEYWORDS   = ['hackathon','internship','intern','event','competition','fellowship','workshop','bootcamp','challenge','grant'];
const QUALITY_KEYWORDS = ['apply','register','deadline','open','applications','participate','submission','enroll'];
const SKIP_KEYWORDS    = ['review','analysis','opinion','interview','history of','what is','explained','recap','winner','winners','result'];

// City → display name map (ordered: specific before generic)
const CITY_MAP: [RegExp, string][] = [
  [/\bnavi mumbai\b/i,       'Navi Mumbai'],
  [/\bthane\b/i,             'Thane'],
  [/\bpune\b/i,              'Pune'],
  [/\bmumbai\b/i,            'Mumbai'],
  [/\bnagpur\b/i,            'Nagpur'],
  [/\bnashik\b/i,            'Nashik'],
  [/\bsambhajinagar\b|\baurangabad\b/i, 'Sambhajinagar'],
  [/\bamravati\b/i,          'Amravati'],
  [/\bjalgaon\b/i,           'Jalgaon'],
  [/\bsolapur\b/i,           'Solapur'],
  [/\bkolhapur\b/i,          'Kolhapur'],
  [/\bbengaluru\b|\bbangalore\b/i, 'Bengaluru'],
  [/\bdelhi\b|\bnew delhi\b/i,     'Delhi'],
  [/\bhyderabad\b/i,         'Hyderabad'],
  [/\bchennai\b/i,           'Chennai'],
  [/\bkolkata\b/i,           'Kolkata'],
  [/\bahmedabad\b/i,         'Ahmedabad'],
  [/\bjaipur\b/i,            'Jaipur'],
  [/\bsurat\b/i,             'Surat'],
  [/\bchandigarh\b/i,        'Chandigarh'],
  [/\bindore\b/i,            'Indore'],
  [/\bbhopal\b/i,            'Bhopal'],
  [/\bpatna\b/i,             'Patna'],
  [/\blucknow\b/i,           'Lucknow'],
  [/\bkochi\b|\bcochin\b/i,  'Kochi'],
];

// ── RSS ─────────────────────────────────
async function fetchRSS(query: string): Promise<any[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res  = await fetch(url);
    if (!res.ok) return [];
    const xml  = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.map(m => {
      const block = m[1];
      const get   = (tag: string) =>
        block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'))?.[1]?.trim() ?? '';

      return {
        title: get('title').replace(/\s*-\s*[^-]+$/, '').trim(),
        link: get('link'),
        description: get('description').replace(/<[^>]+>/g, '').toLowerCase()
      };
    });
  } catch {
    return [];
  }
}

// ── FIXED FILTER ─────────────────────────
function isQualityItem(item: any): boolean {
  const t = item.title.toLowerCase();
  const d = item.description.toLowerCase();

  if (!item.link?.startsWith('http')) return false;

  // ✅ FIX 1: relaxed keyword check
  const hasKeyword =
    TITLE_KEYWORDS.some(k => t.includes(k)) ||
    QUALITY_KEYWORDS.some(k => d.includes(k));

  if (!hasKeyword) return false;

  // ✅ FIX 2: only title-based skip
  if (SKIP_KEYWORDS.some(k => t.includes(k))) return false;

  return true;
}

// ── CATEGORY ────────────────────────────
function detectCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('hack')) return 'Hackathon';
  if (t.includes('intern')) return 'Internship';
  if (t.includes('workshop') || t.includes('bootcamp')) return 'Workshop';
  return 'Event';
}

// ── LOCATION ────────────────────────────
function tagLocation(title: string, description = ''): string {
  const text = `${title} ${description}`.toLowerCase();
  for (const [regex, city] of CITY_MAP) {
    if (regex.test(text)) return city;
  }
  // Online / virtual check
  if (/\bonline\b|\bvirtual\b|\bremote\b/.test(text)) return 'Online';
  // Default to India (never Unknown)
  return 'India';
}

// ── GEMINI ENRICHMENT (Strict Mode) ──────────────────
async function enrichWithGemini(items: any[], log: string[]): Promise<any[]> {
  try {
    const promptData = items.map((o, i) => ({ id: i, title: o.title, link: o.link }));
    const prompt = `You are an AI data extractor. Extract details for these opportunities based on their title and URL.
Data: ${JSON.stringify(promptData)}

Return ONLY a JSON array matching the exact input order. Each object must have:
- "location" (prefer Indian city, else "India")
- "full_address" (full venue/address or "Check Website")
- "skills" (comma separated or "Check Website")
- "eligibility" (e.g. "UG students", "Open to all" or "Check Website")
- "team_size" (e.g. "1-4 members" or "Check Website")
- "deadline" (ISO string if found, else "Check Website")

Do not generate fake data. Never leave fields empty, use "Check Website". Return ONLY valid JSON array.`;

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let enriched: any[] = [];
    try {
      enriched = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) enriched = JSON.parse(m[0]);
    }

    if (!Array.isArray(enriched) || enriched.length === 0) return items;

    // Merge back
    return items.map((o, i) => {
      const e = enriched[i] || {};
      return {
        ...o,
        location: e.location && e.location !== 'Check Website' ? e.location : o.location,
        venue: e.full_address || 'Check Website',
        skills: e.skills || 'Check Website',
        eligibility: e.eligibility || 'Check Website',
        team_size: e.team_size || 'Check Website',
        deadline: e.deadline && e.deadline !== 'Check Website' ? e.deadline : o.deadline
      };
    });

  } catch (err) {
    log.push(`Gemini Error: ${err.message}`);
    return items;
  }
}

// ── MAIN ────────────────────────────────
Deno.serve(async () => {

  let log: string[] = [];

  const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.allSettled([
    fetchRSS('hackathon India'),
    fetchRSS('internship India students'),
    fetchRSS('tech events India'),
    fetchRSS('coding competition India'),
    fetchRSS('startup internship India'),
    fetchRSS('college hackathon India'),
    fetchRSS('AI hackathon 2026'),
    fetchRSS('engineering internship India')
  ]);

  const raw = [
    ...(r1.status === 'fulfilled' ? r1.value : []),
    ...(r2.status === 'fulfilled' ? r2.value : []),
    ...(r3.status === 'fulfilled' ? r3.value : []),
    ...(r4.status === 'fulfilled' ? r4.value : []),
    ...(r5.status === 'fulfilled' ? r5.value : []),
    ...(r6.status === 'fulfilled' ? r6.value : []),
    ...(r7.status === 'fulfilled' ? r7.value : []),
    ...(r8.status === 'fulfilled' ? r8.value : []),
  ];

  log.push(`RSS: ${raw.length}`);

  // ✅ FIX 2: fallback added
  let filtered = raw.filter(isQualityItem);
  if (filtered.length < 5) {
    log.push('Filter relaxed fallback');
    filtered = raw.slice(0, 10);
  }

  let data = filtered.map(s => ({
    title: s.title,
    organization: '',
    category: detectCategory(s.title),
    location: tagLocation(s.title, s.description),
    mode: /offline|in.person|on.campus|physical/i.test(s.description) ? 'Offline' : 'Online',
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    link: s.link,
    _tag: tagLocation(s.title, s.description)
  }));

  // remove duplicates first (limit to 15)
  const seen = new Set();
  const uniqueItems = data.filter(o => {
    if (seen.has(o.link)) return false;
    seen.add(o.link);
    return true;
  }).slice(0, 15);

  log.push(`Unique: ${uniqueItems.length}`);

  // Enqueue to Gemini for enrichment
  log.push("Gemini enriching data...");
  const final = await enrichWithGemini(uniqueItems, log);

  log.push(`Final: ${final.length}`);

  // ── DB UPSERT ──────────────────
  const finalData = final.map(({ _tag, ...rest }) => rest); // strip internal _tag field
  const { data: inserted, error: dbError } = await supabase
    .from(DB_TABLE)
    .upsert(finalData, {
      onConflict: 'link',
      ignoreDuplicates: true
    })
    .select();

  if (dbError) {
    log.push(`DB Error: ${dbError.message}`);
  } else {
    log.push(`Saved: ${inserted?.length ?? 0}`);
  }

  return new Response(JSON.stringify({ log, count: final.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});