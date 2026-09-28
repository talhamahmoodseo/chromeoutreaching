# Outreach Desk — project handoff

**Version:** 0.6.0  
**Type:** Standalone Chrome Manifest V3 extension for guest post outreach research  
**Status:** Testable personal tool. Live Google, MozBar, Gemini and Google Sheets integrations still need testing in the owner's Chrome account.

## Purpose

Outreach Desk finds websites with a possible guest post, contributor, sponsored content or advertising opportunity. It researches the publisher's relevant pages, collects published contacts, checks existing outreach databases, and presents a scored shortlist. It does **not** send emails, bargain, authenticate an inbox or automatically submit contact forms. This project is separate from the Agency Scout client hunting extension.

The owner's priority is **fewer accurate opportunities**, with a clean, professional dashboard and a practical export. Preserve the existing multi-page email extraction while improving relevance decisions and usability.

## What is implemented

- Campaigns with separate names, niche/topics, language, DA requirement, sender profile, targets, database/contact-history switches, results and reports. The same domain can appear in different campaigns without overwriting either result.
- Suggested related topics and editable Google queries. Google result pagination runs up to the campaign limit. Manual website URLs are also supported.
- Title/domain screening for obvious listicles, directories, irrelevant platforms and unrelated results, followed by checks of the actual website content. Relevant pages include contribution, advertising, editorial, contact and about pages.
- Published email collection and classification; sources, form links, keyword, evidence, notes, history and outreach status are retained. A usable contact normally enters **Ready for outreach** with a 0–100 quality score. Clear exclusions remain rejected. Ready is a contact decision, not proof that a guest post will be accepted.
- Optional MozBar DA values read from visible Google results. Missing metrics present **Continue without Moz** or **Stop campaign**. Stop and resume preserve the current search position and pending pages.
- Campaign research language checks. Clear mismatches are rejected; unknown languages remain visible.
- Public Google Sheets and imported CSV/XLSX as read-only duplicate/contact-history sources. Domain and email indexes include recognized contacted statuses. Per-campaign checks can be disabled independently.
- Optional Gemini topic suggestions and bounded website assessment. Local rules continue on API failure. Gemini cannot add an email that was not extracted from the website.
- All-campaign overview and per-campaign report selector; email, niche, score, DA, TLD, language and recency filters; publisher CSV and per-contact audit CSV.
- Optional separate Google Sheet output via the included Apps Script. Its campaign-scoped upserts preserve manual outreach fields on recognized sheets.
- Local sender profiles for contact-form drafts. Form preparation requires a click and does not submit.

## Repository map

| Path | Responsibility |
| --- | --- |
| `extension/manifest.json` | MV3 permissions, service worker, side panel and icons. Chrome 120+ required. |
| `extension/publisher-worker.js` | Campaign job state, navigation, retries, stop/resume, local storage, messages and output queue. |
| `extension/publisher-collector.js` | Reads Google results and publisher pages in browser tabs; extracts page evidence and contacts. |
| `extension/publisher-rules.js` | Result screening, opportunity and email classification, readiness and quality scoring. |
| `extension/publisher-model.js` | Lead schema, page merging, counts, migration and backup restoration. |
| `extension/publisher-language.js` | Conservative page language identification. |
| `extension/publisher-da.js` | MozBar result metric parsing and DA preflight. |
| `extension/publisher-topics.js` | Built-in topic and query suggestions. |
| `extension/publisher-ai.js` | Optional Gemini request, response validation and evidence grounding. |
| `extension/publisher-sheets.js` | Public Sheet, XLSX and CSV database parsing and contacted indexes. |
| `extension/publisher-output.js` | Output Sheet transport and campaign-scoped record mapping. |
| `extension/publisher-export.js` | Structured and spreadsheet-safe CSV modes. |
| `extension/publisher.html`, `publisher.css`, `publisher-ui.js` | Dashboard, campaign reports, settings, dialogs and detail view. |
| `extension/publisher-panel.html`, `publisher-panel.js` | Compact extension side panel. |
| `sheets-apps-script/Code.gs`, `SETUP.md` | Optional writable Sheet integration and deployment instructions. |
| `tests/` | Node tests and synthetic browser fixtures. |
| `docs/` | Product plan, release notes and validation details. |

The production extension runs from `extension/`. `extension/vendor/publisher-deps.js` is bundled and checked in; users do not need Node or npm to install. `node_modules/` is for local development and should not be committed.

## Research and state flow

1. Create a campaign with its criteria. Enabled public Sheets refresh before discovery; an unavailable enabled source blocks discovery so duplicates are not silently missed.
2. Collect Google organic results or supplied URLs. Screen obvious non-opportunities and optional DA/TLD requirements before opening publishers.
3. Visit eligible publisher pages with a per-website time and page budget. Persist work after each step. Keep partial findings from unavailable sites; wait for the user when verification appears.
4. Merge page evidence and emails into a result owned by that campaign. Apply language and contact-history checks, optional Gemini assessment, and local quality/readiness rules.
5. Show the result in the campaign report and queue an optional output Sheet upsert. Export current filtered/selected rows or a JSON backup when requested.

Main state lives in `chrome.storage.local` under `publisherDesk` (schema version 3). It contains `campaigns`, `leads`, `databases`, `senderProfiles`, `settings`, `output` and `activeId`. A lead carries `campaignId`, domain, discoveries, opportunities, emails, forms, evidence/history, score, bucket and relationship fields. A campaign carries its own pending jobs, current job, query/page position, DA/language/database options, counts and status. The Gemini key (`publisherGeminiKey`) and output configuration (`publisherOutputConfig`) use separate local entries and are excluded from the JSON backup. Do not log or commit real keys, contact lists or personal backups.

The dashboard sends `PUB_*` messages to the service worker. The worker serializes mutations, saves state and uses a recovery alarm. Review job persistence carefully when changing navigation, errors or status transitions. A stopped campaign must resume from its saved position. Output sync failures must not stop local research.

## Run and test

```bash
npm ci
npm test
npm run preview:fixtures
npm run dev
```

The local preview uses **synthetic data** and mocked extension messages. Open the preview's browser fixture page and run its checks. To use the actual extension, load `extension/` at `chrome://extensions` → Developer mode → Load unpacked. Read `README.md` and `sheets-apps-script/SETUP.md` before using the live Sheet connection.

At the 0.6.0 handoff, **114 Node tests** and **14 synthetic browser extraction checks** passed. These checks do not establish that live Google layouts, an installed MozBar overlay, the owner's Gemini key or a deployed Apps Script work in the owner's account. Test those manually in Chrome before relying on large campaigns.

## Engineering priorities for the next developer

1. **Live smoke test:** Google pagination, blocked/verification sites, Moz present/absent, stop/resume after a browser restart, Gemini with the owner's key, and a separate test output Sheet. Record exact failures and fix them before adding features.
2. **Measure relevance precision:** Build a small labeled set of actual search results across the owner's niches. Compare title screening, page evidence, false positives, false negatives, email type and language decisions. Keep evidence visible when decisions change.
3. **Scale safely:** Profile Chrome storage and UI responsiveness on hundreds/thousands of results and several campaigns. Keep saved work recoverable and make output retries idempotent.
4. **Improve international research:** Local contribution rules are primarily English. Add language-specific evidence only with labeled examples and tests; keep unknown language distinct from a confirmed mismatch.
5. **Refine layout with real data:** Verify report, filters, sender form, output settings, detail drawer and CSV in the owner's Windows Chrome at normal zoom and narrow widths.

Do not treat speculative features as already implemented. In particular, sender profiles are **not mailbox connections** and Sheet statuses are **not automatic sent-mail detection**. Live integration changes may require provider authentication, quotas or revised permissions.

## Change acceptance checklist

- Campaign-specific criteria never alter a different campaign's results; a global do-not-contact decision remains respected.
- Research reaches the requested count of ready contacts or a real stopping limit, advances pages, and preserves its exact place after stop/resume or recoverable failure.
- Clearly irrelevant pages and excluded/contacted emails do not become ready through a higher score or an AI response.
- Extraction retains all published emails and sources; CSV columns and output Sheet rows retain campaign and keyword attribution. User-edited outreach status and notes survive an output refresh.
- No email or contact form is sent automatically. Credentials stay out of backups, Git history, logs and UI exports.
- Run the relevant tests and perform a Chrome smoke test for UI/integration changes. Update `README.md`, `docs/VALIDATION.md` and this file when behavior or limitations change.

## GitHub handoff

Place this `PROJECT.md` at the **repository root**, alongside `README.md`, `package.json`, `extension/`, `tests/` and `sheets-apps-script/`. Upload the **extracted source folder**, not only the release ZIP. Keep `node_modules/`, real CSV/XLSX databases, backups, API keys and deployment secrets out of the repository. Give a developer or coding LLM the repository link and ask them to read `PROJECT.md`, `README.md` and `docs/VALIDATION.md` before editing code.

For end-user installation, see `README.md`. For output Sheet deployment, see `sheets-apps-script/SETUP.md`.
