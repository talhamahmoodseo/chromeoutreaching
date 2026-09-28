/* Read only MozBar-style metrics rendered next to a single Google result. */
(function (g) {
  'use strict';
  const C = PublisherCore;
  function metric(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  }
  function parseCard(input) {
    const s = C.clean(input);
    if (s.length > 180) return null;
    const da = s.match(/(?:^|\s)DA\s*[:：]?\s*(\d{1,3})(?=\s|$|[^\d])/i);
    const pa = s.match(/(?:^|\s)PA\s*[:：]?\s*(\d{1,3})(?=\s|$|[^\d])/i);
    if (!da || !pa || Math.abs(da.index - pa.index) > 130) return null;
    const value = metric(da[1]), pageAuthority = metric(pa[1]);
    return value === null || pageAuthority === null ? null : {value, pageAuthority};
  }
  function read(h) {
    let ancestor = h.parentElement;
    for (let level = 0; ancestor && ancestor !== h.ownerDocument.body && level < 10; level++, ancestor = ancestor.parentElement) {
      if (ancestor.querySelectorAll('h3').length !== 1) break;
      const cards = [];
      for (const node of ancestor.querySelectorAll('div,section,aside')) {
        if (node.contains(h) || node.querySelector('h3')) continue;
        const parsed = parseCard(node.innerText || node.textContent);
        if (parsed && !cards.some(x => x.value === parsed.value && x.pageAuthority === parsed.pageAuthority)) cards.push(parsed);
      }
      if (cards.length === 1) return cards[0];
      if (cards.length > 1) return null;
    }
    return null;
  }
  function attach(results, doc = document, base = location.href) {
    const candidates = [...doc.querySelectorAll('h3')].map(h => {
      const a = h.closest('a') || h.querySelector('a');
      if (!a) return null;
      let u = C.url(a.getAttribute('href'), base);
      if (u && new URL(u).hostname === new URL(base).hostname && new URL(u).pathname === '/url') {
        const q = new URL(u).searchParams;
        u = C.url(q.get('q') || q.get('url'));
      }
      return {url: u, title: C.clean(h.innerText || h.textContent), value: read(h)};
    }).filter(Boolean);
    return results.map(r => {
      const matches = candidates.filter(c => c.url === C.url(r.url) && c.title === C.clean(r.title));
      return matches.length === 1 && matches[0].value ? {...r, da: matches[0].value.value, pa: matches[0].value.pageAuthority, daSource: 'Visible Google result metric'} : r;
    });
  }
  function preflight(results) {
    const values = results.filter(r => r.daSource === 'Visible Google result metric' && metric(r.da) !== null && metric(r.pa) !== null);
    const domains = new Set(values.map(r => C.domain(r.url)).filter(Boolean));
    if (domains.size < 2) return {ok: false, count: values.length, reason: 'Could not read DA beside at least two separate Google results. Check that MozBar is signed in and its SERP overlay is visible.'};
    return {ok: true, count: values.length, reason: `${values.length} Google results have readable DA metrics.`};
  }
  g.PublisherDA = {metric, parseCard, attach, preflight};
})(globalThis);
