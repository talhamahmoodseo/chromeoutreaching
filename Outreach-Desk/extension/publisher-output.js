/* Optional write-back to a user-owned Google Sheet through a bound Apps Script. */
(function (g) {
  'use strict';

  const ENDPOINT_HOST = 'script.google.com';
  const MAX_RECORDS = 100;
  const MAX_PAYLOAD_BYTES = 400 * 1024;
  const REQUEST_TIMEOUT_MS = 25000;
  const TEXT_FIELDS = {
    campaignName: 120, emailType: 80, language: 60,
    bestEmail: 254, emails: 3000, contactPages: 5000, contributionPages: 5000,
    contactForms: 3000, opportunityTypes: 800, summary: 1500, keywords: 3000,
    firstSeen: 40, lastCollected: 40, decisionReason: 1000
  };

  function clean(value, limit) {
    let text = String(value == null ? '' : value);
    if (typeof text.normalize === 'function') text = text.normalize('NFKC');
    return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function host(value) {
    let raw = clean(value, 2048);
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return '';
      let hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (hostname.startsWith('www.')) hostname = hostname.slice(4);
      if (hostname.length > 253 || hostname.includes('..') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return '';
      return hostname;
    } catch (_) { return ''; }
  }

  function safeUrl(value, allowBareHost) {
    let raw = clean(value, 2048);
    if (!raw) return '';
    if (allowBareHost && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || !host(parsed.hostname)) return '';
      parsed.hash = '';
      return parsed.href.slice(0, 2048);
    } catch (_) { return ''; }
  }

  function normalizedNiche(value) { return clean(value, 90) || 'General'; }
  function campaignId(value) { return clean(value, 120).replace(/[^A-Za-z0-9_.-]/g, '') || ''; }
  function stableKey(domain, niche, id) {
    return id ? id + '|' + host(domain) : 'legacy|' + host(domain) + '|' + normalizedNiche(niche).toLowerCase();
  }
  function metric(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
  }
  function isoDate(value) {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }
  function unique(values, limit, map) {
    const seen = new Set(), output = [];
    for (const value of values) {
      const mapped = map(value);
      if (mapped && !seen.has(mapped)) {
        seen.add(mapped); output.push(mapped);
        if (output.length >= limit) break;
      }
    }
    return output;
  }
  function emailAddress(value) {
    const candidate = clean(value, 254).toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(candidate) ? candidate : '';
  }
  function statusFor(lead) {
    if (lead.doNotContact) return 'Rejected';
    const bucket = String(lead.bucket || lead.status || '').toLowerCase().replace(/[ _-]+/g, ' ').trim();
    if (bucket === 'ready' || bucket === 'email') return 'Ready';
    if (bucket === 'form' || bucket === 'form only') return 'Form only';
    if (bucket === 'rejected') return 'Rejected';
    if (bucket === 'no email' || bucket === 'no useful email' || bucket === 'no_email') return 'No useful email';
    return 'Review';
  }

  function record(lead) {
    if (!lead || typeof lead !== 'object' || Array.isArray(lead)) throw new Error('Choose a publisher record to export.');
    const website = safeUrl(lead.website || lead.discoveredURL || lead.domain, true);
    if (!website) throw new Error('Publisher website must be a valid HTTP or HTTPS URL.');
    const websiteHost = host(website), domain = host(lead.domain || websiteHost);
    if (!domain || !(websiteHost === domain || websiteHost.endsWith('.' + domain))) throw new Error('Publisher domain must match the website.');
    const niche = normalizedNiche(lead.niche);
    const campaign = campaignId(lead.campaignId);
    const campaignName = clean(lead.campaignName, TEXT_FIELDS.campaignName);
    const researchStatus = statusFor(lead);
    const contacts = Array.isArray(lead.emails) ? lead.emails : [];
    const emails = unique(contacts, 20, item => emailAddress(typeof item === 'string' ? item : item && item.email)).join('; ');
    const bestEmail = researchStatus !== 'Rejected' && !lead.doNotContact ? emailAddress(lead.bestEmail || lead.selectedEmail) : '';
    const selectedContact = contacts.find(item => item && item.email === bestEmail);
    const emailType = clean(lead.emailType || (selectedContact && (selectedContact.kind || selectedContact.type)), TEXT_FIELDS.emailType);
    const contactPages = unique(Array.isArray(lead.contactPages) ? lead.contactPages : [], 20,
      item => safeUrl(typeof item === 'string' ? item : item && item.url, false)).join('; ');
    const opportunities = Array.isArray(lead.opportunities) ? lead.opportunities : [];
    const contributionPages = unique([
      ...opportunities.filter(item => item && item.decision === 'qualified').map(item => item.url), lead.contributionURL
    ], 20, item => safeUrl(item, false)).join('; ');
    const opportunityTypes = unique(opportunities.filter(item => item && item.decision === 'qualified')
      .flatMap(item => [...(Array.isArray(item.types) ? item.types : []), item.role]), 12, item => clean(item, 80)).join('; ');
    const contactForms = unique(Array.isArray(lead.forms) ? lead.forms : [], 12,
      item => safeUrl(typeof item === 'string' ? item : item && item.url, false)).join('; ');
    const keywords = unique(Array.isArray(lead.discoveries) ? lead.discoveries : [], 30,
      item => clean(item && item.query, 160)).join('; ');
    return {
      campaignId: campaign, campaignName, stableKey: stableKey(domain, niche, campaign),
      domain, website, niche, researchStatus, score: metric(lead.score),
      language: clean(lead.language || lead.detectedLanguage, TEXT_FIELDS.language), emailType, bestEmail, emails,
      da: metric(lead.da), pa: metric(lead.pa),
      decisionReason: clean(lead.decisionReason || lead.screenReason || lead.stopReason, TEXT_FIELDS.decisionReason),
      contactPages, contributionPages, contactForms, opportunityTypes,
      summary: clean(lead.summary, TEXT_FIELDS.summary), keywords,
      firstSeen: isoDate(lead.createdAt || lead.firstSeen), lastCollected: isoDate(lead.collectedAt || lead.lastCollected),
    };
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Enter the Apps Script web app URL and secret.');
    const rawEndpoint = clean(config.endpoint, 2048);
    let parsed;
    try { parsed = new URL(rawEndpoint); } catch (_) { throw new Error('Use the deployed Google Apps Script /exec URL.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== ENDPOINT_HOST || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)) {
      throw new Error('Endpoint must be an HTTPS script.google.com/macros/s/.../exec web app URL.');
    }
    const secret = typeof config.secret === 'string' ? config.secret : '';
    if (secret.length < 32 || secret.length > 256 || /[^A-Za-z0-9_-]/.test(secret) || new Set(secret).size < 10 || /^(.)\1+$/.test(secret)) {
      throw new Error('Secret must be a strong 32–256 character base64url or hexadecimal value.');
    }
    return { endpoint: parsed.origin + parsed.pathname, secret };
  }

  function transportRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Publisher export record is invalid.');
    const domain = host(value.domain), website = safeUrl(value.website, false), niche = normalizedNiche(value.niche);
    const websiteHost = host(website);
    if (!domain || !website || !(websiteHost === domain || websiteHost.endsWith('.' + domain))) throw new Error('Publisher export domain does not match its website.');
    const campaign = campaignId(value.campaignId);
    if (value.campaignId && campaign !== clean(value.campaignId, 120)) throw new Error('Publisher campaign ID is invalid.');
    const researchStatus = clean(value.researchStatus, 40);
    if (!['Ready', 'Form only', 'Review', 'No useful email', 'Rejected'].includes(researchStatus)) throw new Error('Publisher export status is invalid.');
    const expectedKey = stableKey(domain, niche, campaign);
    if (value.stableKey !== expectedKey) throw new Error('Publisher export key does not match its campaign and domain.');
    const split = (field, limit, mapper) => unique(clean(value[field], limit).split(';'), 30, mapper).join('; ');
    const emails = split('emails', TEXT_FIELDS.emails, emailAddress);
    const urlList = field => split(field, TEXT_FIELDS[field], item => safeUrl(item, false));
    return {
      campaignId: campaign, campaignName: clean(value.campaignName, TEXT_FIELDS.campaignName),
      stableKey: expectedKey, domain, website, niche, researchStatus,
      score: metric(value.score), language: clean(value.language, TEXT_FIELDS.language),
      emailType: clean(value.emailType, TEXT_FIELDS.emailType),
      bestEmail: researchStatus === 'Rejected' ? '' : emailAddress(value.bestEmail), emails,
      da: metric(value.da), pa: metric(value.pa),
      decisionReason: clean(value.decisionReason, TEXT_FIELDS.decisionReason),
      contactPages: urlList('contactPages'), contributionPages: urlList('contributionPages'),
      contactForms: urlList('contactForms'), opportunityTypes: clean(value.opportunityTypes, TEXT_FIELDS.opportunityTypes),
      summary: clean(value.summary, TEXT_FIELDS.summary), keywords: clean(value.keywords, TEXT_FIELDS.keywords),
      firstSeen: isoDate(value.firstSeen), lastCollected: isoDate(value.lastCollected),
    };
  }

  function outputError(message) {
    const error = new Error(message);
    error.publisherOutputError = true;
    return error;
  }

  async function send(config, action, records, fetcher) {
    const checked = validateConfig(config);
    if (action !== 'upsert' && action !== 'ping') throw new Error('Action must be upsert or ping.');
    if (!Array.isArray(records)) throw new Error('Records must be provided as a list.');
    if (action === 'ping' && records.length) throw new Error('Connection test does not accept records.');
    if (action === 'upsert' && (!records.length || records.length > MAX_RECORDS)) throw new Error('Send between 1 and 100 publisher records at a time.');
    const rows = action === 'upsert' ? records.map(value => value && typeof value.stableKey === 'string' ? transportRecord(value) : record(value)) : [];
    const body = JSON.stringify({ secret: checked.secret, action, records: rows });
    if (new TextEncoder().encode(body).length > MAX_PAYLOAD_BYTES) throw new Error('Export is too large. Send fewer publisher records at a time.');
    const request = fetcher || g.fetch;
    if (typeof request !== 'function') throw new Error('Fetch is unavailable in this extension context.');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error('Apps Script request timed out after 25 seconds.');
        error.name = 'TimeoutError'; reject(error);
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([(async () => {
        const response = await request(checked.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body,
          credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal
        });
        if (!response || response.ok !== true) throw outputError('Apps Script returned an HTTP error. Check the deployment URL and access setting.');
        let acknowledgement;
        try {
          const readBody = typeof response.text === 'function' ? response.text() : response.json().then(JSON.stringify);
          acknowledgement = JSON.parse(await Promise.race([readBody, timeout]));
        } catch (error) {
          if (error && error.name === 'TimeoutError') throw error;
          throw outputError('Apps Script did not return a readable JSON acknowledgement. Check deployment access and Chrome’s redirect behavior.');
        }
        if (!acknowledgement || acknowledgement.ok !== true) {
          throw outputError(clean(acknowledgement && acknowledgement.error, 300) || 'Apps Script did not accept the request.');
        }
        if (!Number.isInteger(acknowledgement.accepted) || acknowledgement.accepted !== rows.length) {
          throw outputError('Apps Script acknowledgement count did not match the submitted records.');
        }
        return acknowledgement;
      })(), timeout]);
    } catch (error) {
      if (error && error.name === 'TimeoutError') throw error;
      if (error && error.publisherOutputError) throw error;
      if (error && error.name === 'AbortError') throw new Error('Apps Script request timed out after 25 seconds.');
      throw new Error('Could not reach the Apps Script web app. Check deployment access and Chrome’s Apps Script redirect behavior, then run the connection test.');
    } finally { clearTimeout(timer); }
  }

  async function test(config, fetcher) {
    const acknowledgement = await send(config, 'ping', [], fetcher);
    if (acknowledgement.message !== 'pong') throw new Error('Apps Script connection test did not return pong.');
    return acknowledgement;
  }
  g.PublisherOutput = Object.freeze({ validateConfig, record, send, test });
})(globalThis);
