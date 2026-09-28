# Outreach Desk 0.6.0

- Redesigned workspace, campaign reports, filters, dialogs, detail drawer, sender settings and full-width output Sheet setup.
- Per-campaign result identity and requirements. One domain can have independent outcomes in different campaigns. Combined overview retains campaign identity.
- Moz fallback choice and resumable stop, including preserved current search results and pending research pages.
- Evidence-based quality scores and usable-contact readiness instead of a large manual-review queue. Firm exclusions still apply.
- Filters for email status/type, niche, score, DA range, TLDs, recent research, language, opportunity and search text.
- Campaign language requirements with conservative unknown handling.
- Selectable sender profiles for form drafts. No authenticated inbox integration or email sending.
- Optional database and contacted-history checks, including Sheet email indexes and explicit outreach statuses.
- Gemini replaces Mistral for optional related-topic ideas and bounded page assessment; failures fall back to local research.
- Structured CSV with publisher and contact-audit layouts, campaign attribution, dates, email type and formula protection.
- Apps Script output keys include campaign identity; valid v0.5 sheets gain columns without dropping manual notes/statuses.
- Established email extraction and relevant-page crawling retained. Contact forms still require an explicit prepare action and are never automatically submitted.

## Upgrade notes

Back up local research and the output workbook before upgrading. Reload the extension in its existing directory to retain its storage. If installed with a new identity, import your backup. Restored campaigns are completed reports, not live jobs; in-place updates preserve resumable local jobs. Historical records that were previously merged cannot be reliably reconstructed into separate campaigns after the fact. Re-enter Gemini/output credentials after a backup import. The prior Mistral key is not used.
