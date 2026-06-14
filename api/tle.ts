import type { IncomingMessage, ServerResponse } from 'http';

// NORAD ID for ISS
const ISS_NORAD_ID = 25544;

const CELESTRAK_ORG = (id: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`;

const CELESTRAK_COM = (id: number) =>
  `https://celestrak.com/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`;

const WHERETHEISS_TLE = `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`;

interface TLEData {
  line1: string;
  line2: string;
  fetchedAt: number;
  source: 'celestrak' | 'cached' | 'fallback';
}

function parseTLEString(raw: string): { line1: string; line2: string } | null {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const line1 = lines.find(l => l.startsWith('1 ') && l.length >= 68);
  const line2 = lines.find(l => l.startsWith('2 ') && l.length >= 68);

  if (line1 && line2) {
    const cat1 = line1.substring(2, 7).trim();
    const cat2 = line2.substring(2, 7).trim();
    if (cat1 === cat2) {
      return { line1, line2 };
    }
  }
  return null;
}

async function tryFetchWithSignal(
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal
): Promise<string | null> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onParentAbort);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', onParentAbort);
  }
}

async function fetchAndParse(
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
  sourceName: string
): Promise<TLEData> {
  const text = await tryFetchWithSignal(url, timeoutMs, parentSignal);
  if (!text) {
    throw new Error(`Fetch failed or timed out for ${sourceName}`);
  }
  const parsed = parseTLEString(text);
  if (!parsed) {
    throw new Error(`Failed to parse TLE from ${sourceName}`);
  }
  return {
    line1: parsed.line1,
    line2: parsed.line2,
    fetchedAt: Date.now(),
    source: 'celestrak',
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const controller = new AbortController();
  const signal = controller.signal;

  const promises: Promise<TLEData>[] = [
    fetchAndParse(CELESTRAK_ORG(ISS_NORAD_ID), 10_000, signal, 'celestrak-org'),
    fetchAndParse(CELESTRAK_COM(ISS_NORAD_ID), 10_000, signal, 'celestrak-com'),
    fetchAndParse(WHERETHEISS_TLE, 20_000, signal, 'wheretheiss'),
  ];

  try {
    const tle = await Promise.any(promises);
    controller.abort();
    
    // Cache the response at the edge for 1 hour (3600 seconds)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(tle));
  } catch (err) {
    controller.abort();
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'All TLE sources failed' }));
  }
}
