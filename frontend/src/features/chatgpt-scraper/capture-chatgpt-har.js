/*
 * Captures the chatgpt.com plugin directory into a HAR file. Run it once a day, then upload the file on the
 * app's ChatGPT page.
 *
 * 1. Sign in at https://chatgpt.com/plugins in your own browser.
 * 2. Open DevTools (F12) > Console. If Chrome says pasting is blocked, type: allow pasting
 * 3. Paste this whole file and press Enter. It reads the home list and then every category, one request at a
 *    time, and downloads chatgpt-plugins-YYYY-MM-DD.har.
 *
 * It runs inside your own signed-in tab (same site, your own cookies), so nothing is sent anywhere else and the
 * file holds only the directory responses, never your cookies or headers. If chatgpt.com answers 401, 403 or 429
 * it stops at once and says so; it never retries.
 */
(async () => {
  const API = '/backend-api/ps';
  const GAP_MS = 300;
  const PAGE_LIMIT = 100;
  const MAX_PAGES = 50;
  const REFUSED = [401, 403, 429];
  const HEADERS = {
    accept: '*/*',
    'oai-language': 'en-US',
    'oai-product-sku': 'CONNECTOR_SETTING',
    'x-codex-surface': 'plugin_directory',
    originator: 'Codex Browser',
    'x-openai-codex-window-type': 'browser',
    'x-openai-web-frontend': 'codex_webview',
  };
  const PAGE_HEADERS = { accept: 'application/json' };
  const CURSOR_KEYS = ['next_cursor', 'nextCursor', 'next_page_token', 'nextPageToken', 'next', 'cursor', 'after', 'end_cursor'];
  const PARAM_GUESSES = ['cursor', 'after', 'page_token', 'pageToken', 'next_cursor', 'next', 'token'];

  if (location.hostname !== 'chatgpt.com') {
    console.error('Open https://chatgpt.com/plugins (signed in) and run this there.');
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const entries = [];

  async function get(path, headers = HEADERS) {
    const url = location.origin + path;
    const started = new Date();
    const t0 = performance.now();
    const res = await fetch(url, { headers, credentials: 'same-origin' });
    const text = await res.text();
    const entry = {
      startedDateTime: started.toISOString(),
      time: Math.round(performance.now() - t0),
      request: { method: 'GET', url, httpVersion: 'HTTP/1.1', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 },
      response: {
        status: res.status,
        statusText: res.statusText,
        httpVersion: 'HTTP/1.1',
        headers: [],
        cookies: [],
        content: { size: text.length, mimeType: res.headers.get('content-type') || 'application/json', text },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: Math.round(performance.now() - t0), receive: 0 },
    };
    entries.push(entry);
    await sleep(GAP_MS);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (REFUSED.includes(res.status)) throw new Error(`HTTP ${res.status} from chatgpt.com for ${path}. Stopped; not retried.`);
    return { status: res.status, json, entry };
  }

  const pluginsOf = (j) => {
    if (!j) return [];
    for (const k of ['plugins', 'items', 'results', 'data', 'connectors', 'apps']) if (Array.isArray(j[k])) return j[k];
    const fromSections = isObj(j.directory) && Array.isArray(j.directory.sections) ? j.directory.sections.flatMap((s) => (Array.isArray(s.plugins) ? s.plugins : [])) : [];
    return fromSections;
  };
  const idOf = (p) => (isObj(p) ? p.id || p.plugin_id || p.connector_id || (isObj(p.plugin) && p.plugin.id) || '' : '');

  function nextOf(j) {
    if (!isObj(j)) return null;
    for (const s of [j, j.pagination, j.page_info, j.pageInfo, j.paging, j.meta].filter(isObj)) {
      if (s.has_more === false || s.hasMore === false || s.hasNextPage === false) return null;
      for (const k of CURSOR_KEYS) if (typeof s[k] === 'string' && s[k].trim()) return { key: k, value: s[k].trim() };
    }
    return null;
  }

  const report = [];
  let followParam = null; // the query parameter that carries the cursor, learned the first time a category has a second page

  try {
    console.log('Reading the home list…');
    const home = await get(`${API}/plugins/home`);
    if (home.status !== 200 || !home.json) throw new Error(`The home request answered HTTP ${home.status}. Are you signed in at chatgpt.com?`);
    const sections = Array.isArray(home.json.sections) ? home.json.sections : [];
    const slugs = sections.map((s) => s.url_slug || s.slug || s.id).filter(Boolean);
    if (!slugs.length) throw new Error('The home response had no categories.');
    console.log(`${slugs.length} categories: ${slugs.join(', ')}`);

    for (const slug of slugs) {
      const base = `${API}/plugin-categories/${encodeURIComponent(slug)}/plugins?scope=GLOBAL&limit=${PAGE_LIMIT}`;
      const seen = new Set();
      const newIds = (r) => pluginsOf(r.json).map(idOf).filter((id) => id && !seen.has(id));
      let pages = 0;
      let note = '';

      // First choice: the request the plugins page itself makes for a category. It returns the whole category in one response.
      const whole = await get(`/plugins?category=${encodeURIComponent(slug)}`, PAGE_HEADERS);
      const wholeIds = whole.status === 200 && whole.json ? pluginsOf(whole.json).map(idOf).filter(Boolean) : [];
      if (wholeIds.length) {
        wholeIds.forEach((id) => seen.add(id));
        const more = isObj(whole.json.directory) && whole.json.directory.next;
        note = more ? 'the response has a "next" value that was not followed' : '';
        report.push({ category: slug, plugins: seen.size, pages: 1, note });
        console.log(`${slug}: ${seen.size} plugins${note ? ' (' + note + ')' : ''}`);
        continue;
      }
      entries.pop(); // it did not answer with plugins: leave it out and use the paged API route below

      let r = await get(base);
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (r.status !== 200 || !r.json) {
          note = `HTTP ${r.status}`;
          break;
        }
        pages++;
        const fresh = newIds(r);
        fresh.forEach((id) => seen.add(id));
        const next = nextOf(r.json);
        if (!next || !fresh.length) break;

        // The next page: a ready-made path in the response, else the cursor sent as a query parameter. The parameter's
        // name is not documented, so the first continuation tries a few; the one that returns new plugins is reused.
        let following = null;
        const tried = [];
        if (/^(https?:)?\//.test(next.value)) {
          const u = new URL(next.value, location.origin);
          following = await get(u.pathname + u.search);
        } else {
          for (const param of followParam ? [followParam] : [...new Set([next.key, ...PARAM_GUESSES])]) {
            const t = await get(`${base}&${encodeURIComponent(param)}=${encodeURIComponent(next.value)}`);
            if (t.status === 200 && t.json && newIds(t).length) {
              followParam = param;
              following = t;
              break;
            }
            tried.push(`${param} -> HTTP ${t.status}${t.status === 200 ? ' (nothing new)' : ''}`);
            entries.pop(); // a parameter that did not move the list: leave it out of the file
          }
        }
        if (!following) {
          note = `has more pages but the cursor "${next.key}" could not be followed`;
          console.warn(
            `${slug}: the response carries ${next.key} (${next.value.length} characters) and ${fresh.length} plugins, but no query parameter moved it on.\n` +
              `Tried: ${tried.join('; ')}\nResponse keys: ${Object.keys(r.json).join(', ')}\n` +
              `To find the real one: on chatgpt.com/plugins open this category, scroll to load more, and copy the next request from DevTools > Network (right-click > Copy as cURL).`
          );
          break;
        }
        r = following;
      }
      report.push({ category: slug, plugins: seen.size, pages, note });
      console.log(`${slug}: ${seen.size} plugins in ${pages} page(s)${note ? ' (' + note + ')' : ''}`);
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    console.warn('Saving what was read so far.');
  }

  if (!entries.some((e) => e.response.status === 200)) {
    console.error('Nothing was read, so no file was saved.');
    return;
  }
  console.table(report);
  const har = { log: { version: '1.2', creator: { name: 'capture-chatgpt-har.js', version: '1' }, pages: [], entries } };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(har)], { type: 'application/json' }));
  a.download = `chatgpt-plugins-${new Date().toISOString().slice(0, 10)}.har`;
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(`Saved ${a.download}: ${entries.length} responses. Upload it on the app's ChatGPT page.`);
})();
