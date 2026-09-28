# Validation — Outreach Desk 0.6.0

Checked 27 September 2026.

## Automated checks

114 Node tests pass. Coverage includes extraction/relevance, keyword topics, DA parsing, campaign isolation, Moz fallback, exact stop/resume, database/contacted checks, language mismatch, sender snapshots, Gemini validation/fallback, CSV quoting/formula protection, Sheet indexes/output, preserved manual notes, and old-record migration/restore.

## Chromium checks

14/14 local browser fixture checks pass: published emails and placeholders; contribution evidence; editorial/feedback classification; listicle rejection; sponsored route after guest refusal; contact forms; social attribution; actual form input setters; no automatic submission or consent; organic result extraction; pagination; verification detection.

The dashboard preview uses synthetic data and mocked Chrome messaging. It was checked for campaign selection, separate report counts and requirements, filters, preferences, sender form layout, output Sheet card, and the Moz fallback dialog. A horizontal-overflow defect in the sender form was fixed. The output card and campaign report were visually inspected at desktop width.

## Limits of validation

No live research campaign was run with the user's Google session or installed MozBar. Gemini requests were tested with mocked responses, not the user's API key. Apps Script behavior was tested with simulated Sheet services; a real deployment and permissions must be checked in the user's account. Email extraction does not validate delivery. No emails or forms were submitted.

To reproduce: `npm ci` then `npm test`. For UI and browser fixtures: `npm run preview:fixtures` then `npm run dev`, open the local preview and run browser checks. Production extension installation needs no Node dependencies.
