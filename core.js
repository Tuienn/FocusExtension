// Pure accounting: the worker is the only owner of persisted state.
export const MAX_GAP_MS = 45_000;
export const DEFAULT_SITES = [
  { domain: 'youtube.com', label: 'YouTube' },
  { domain: 'facebook.com', label: 'Facebook' },
  { domain: 'reddit.com', label: 'Reddit' },
  { domain: 'tiktok.com', label: 'TikTok' },
  { domain: 'instagram.com', label: 'Instagram' },
  { domain: 'x.com', label: 'X' },
  { domain: 'twitter.com', label: 'X' },
];

export function createData() {
  return { version: 1, settings: { sites: structuredClone(DEFAULT_SITES), afterGoals: 'allow' },
    days: {}, focusRunning: false, sessionFocusMs: 0 };
}

export function dayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyDay(key) {
  return { key, initialized: false, goals: [], focusMs: 0, distractionMs: 0, stopped: 0, visits: [] };
}

export function getDay(data, now = Date.now()) {
  const key = dayKey(now);
  return data.days[key] ??= emptyDay(key);
}

export function normalizeSites(input) {
  if (!Array.isArray(input)) throw new Error('Enter a valid site address.');
  const result = [];
  for (const item of input) {
    let raw = (typeof item === 'string' ? item : item?.domain)?.trim().toLowerCase();
    if (!raw) throw new Error('Enter a valid site address.');
    let url;
    try { url = new URL(raw.includes('://') ? raw : `https://${raw}`); }
    catch { throw new Error('Enter a valid site address.'); }
    const domain = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
      throw new Error('Enter a domain such as youtube.com.');
    }
    if (!result.some(site => site.domain === domain)) {
      result.push({ domain, label: DEFAULT_SITES.find(site => site.domain === domain)?.label ?? domain });
    }
  }
  return result;
}

export function findSite(url, sites) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  // Specific entries win if both a parent domain and a subdomain are configured.
  const match = [...sites].sort((a, b) => b.domain.length - a.domain.length)
    .find(site => host === site.domain || host.endsWith(`.${site.domain}`));
  if (!match) return null;
  // The two default X addresses are a single site for visit continuity.
  return match.domain === 'twitter.com' ? { ...match, domain: 'x.com' } : match;
}

export function setGoals(data, texts, now = Date.now()) {
  if (!Array.isArray(texts) || texts.length > 3 || texts.some(t => typeof t !== 'string')) {
    throw new Error('Choose up to 3 goals.');
  }
  const cleaned = texts.map(text => text.trim()).filter(Boolean);
  if (!cleaned.length) throw new Error('Choose at least one goal.');
  if (cleaned.some(text => text.length > 200)) throw new Error('Keep each goal under 200 characters.');
  const day = getDay(data, now);
  day.goals = cleaned.map((text, index) => {
    const prior = day.goals[index];
    return { id: prior?.id ?? `${day.key}-${index}`, text, done: prior?.text === text ? prior.done : false };
  });
  day.initialized = true;
}

export function toggleGoal(data, id, now = Date.now()) {
  const goal = getDay(data, now).goals.find(g => g.id === id);
  if (!goal) throw new Error('This goal is no longer available.');
  goal.done = !goal.done;
}

export function allGoalsDone(day) {
  return day.goals.length > 0 && day.goals.every(goal => goal.done);
}

export function settle(data, runtime, now = Date.now()) {
  const from = runtime.lastAt;
  runtime.lastAt = now;
  if (!Number.isFinite(from) || now <= from || now - from > MAX_GAP_MS) return;
  const mode = runtime.mode ?? {};
  if (!mode.focus && !mode.visit) return;
  let cursor = from;
  while (cursor < now) {
    const next = new Date(cursor);
    next.setHours(24, 0, 0, 0);
    const end = Math.min(now, next.getTime());
    const duration = end - cursor;
    const day = getDay(data, cursor);
    if (mode.visit) {
      day.distractionMs += duration;
      const visit = mode.visit;
      let row = day.visits.find(entry => entry.id === visit.id);
      if (!row) {
        row = { id: visit.id, site: visit.site, reason: visit.reason ?? '',
          startedAt: Math.max(visit.startedAt ?? cursor, new Date(`${day.key}T00:00:00`).getTime()),
          endedAt: null, durationMs: 0 };
        day.visits.push(row);
      }
      row.durationMs += duration;
      if (end < now) row.endedAt = end;
    } else if (mode.focus && data.focusRunning) {
      day.focusMs += duration;
      data.sessionFocusMs += duration;
    }
    cursor = end;
  }
}

export function buildSnapshot(data, runtime, now = Date.now()) {
  const day = getDay(data, now);
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    const key = dayKey(date);
    return data.days[key] ?? emptyDay(key);
  });
  return { day, dateKey: day.key, week, settings: data.settings,
    focusRunning: data.focusRunning, sessionFocusMs: data.sessionFocusMs,
    focusPaused: data.focusRunning && !runtime.mode?.focus };
}
