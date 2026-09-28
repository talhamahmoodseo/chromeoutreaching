# Optional writable Google Sheets output

Outreach Desk uses public, view-only Sheets as duplicate-check inputs. Output write-back uses a separate spreadsheet that you own and can edit. It has no subscription. The included Apps Script is bound to that output spreadsheet and writes only to its `Useful` and `Rejected` tabs.

The output request contains individual publisher records, not campaign snapshots. The destination therefore has two organized record tabs and no `Campaigns` summary tab. All fields outside the fixed record schema are ignored.

## One-time setup

1. Create a Google spreadsheet in the account that should own the output. Keep this workbook separate from public duplicate-check source Sheets. A new blank workbook gets the current fixed schema automatically; a v0.5 Outreach Desk workbook is upgraded by appending the new named columns while retaining its rows, outreach status, and notes.
2. From that workbook choose **Extensions → Apps Script**. Replace the editor's `Code.gs` contents with [`Code.gs`](./Code.gs) and save.
3. In the Apps Script project, open **Project Settings → Script properties** and add:
   - Property: `OUTREACH_DESK_BEARER_SECRET`
   - Value: a locally generated random secret, for example the 64-character hex output of `openssl rand -hex 32`.

   Keep the secret private. Do not put it in source code or share it in a public document. Store it somewhere you can retrieve it for the extension configuration.
4. In the Apps Script editor, select `initializeOutputWorkbook` and click **Run**. Approve the requested spreadsheet access while signed in as the workbook owner. This creates/formats the `Useful` and `Rejected` tabs, freezes and filters the headers, and adds an outreach-status dropdown. It does not clear or rename any existing tab. If the workbook is new, you may delete the now-empty default `Sheet1` tab manually after checking that it contains nothing you want to keep.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your account (the owner) and **Who has access** to **Anyone**, then deploy. Complete any owner authorization prompt. Copy the deployed HTTPS URL ending in `/exec`; do not use a `/dev` URL.
6. In Outreach Desk **Preferences → Automatic output Sheet**, paste the `/exec` URL and the same secret, then choose **Save and test**. The test expects a JSON `pong` acknowledgement with `accepted: 0`; it makes no row changes. Use **Sync pending** to write queued publisher records.

Google's web-app deployment choices can vary with Workspace administrator policy. If `Anyone` is unavailable, this bearer-secret endpoint cannot be used as configured; ask the account administrator about deployment access instead of choosing an authenticated option the extension cannot satisfy.

## What gets written

Each publisher is upserted by a stable key made from its campaign ID and normalized domain, so the same publisher can appear in separate campaigns. Older records without a campaign ID use a legacy domain-and-niche key. `Useful` holds non-rejected publishers, with research statuses such as Ready, Form only, Review, and No useful email. Explicit rejections and do-not-contact publishers go to `Rejected`. A later research update can move the same campaign record between these tabs without creating a duplicate.

The workbook includes campaign ID and name, website and domain, niche, research status, score, language, DA/PA when available, decision reason, email type, marked best email, other collected emails, contact and contribution pages, forms, opportunity types, summary, keywords, and dates. A best email is blank when none was explicitly selected or when the publisher is rejected/do-not-contact. The Rejected tab retains collected email addresses for review.

The **Outreach Status** and **Outreach Notes** columns are editable; **Updated At** is maintained by the script. Apps Script preserves those cells when it refreshes a record or moves it between tabs. The extension does not send email or submit forms.

## Access and reliability

- The web app runs as the spreadsheet owner and is publicly reachable when deployed with `Anyone`. The random secret is a bearer credential: anyone who gets both the endpoint and secret can write to this workbook as the owner. Use it only in a trusted Chrome profile. If it leaks, replace the Script Property value and save/test the new secret in Outreach Desk.
- Public duplicate-check Sheets remain read-only inputs. This script ignores spreadsheet IDs and tab names in requests and cannot select another workbook from request data; it uses only the spreadsheet to which it is bound.
- Requests use `text/plain` JSON so they do not need a browser preflight request. Apps Script Content Service can redirect its response. Chrome may block or fail to expose that final response in some setups; use **Save and test** first. If a write timed out or the acknowledgement was lost, retrying is safe because the server upserts by the stable key. The extension retains failed items in its pending queue.
- Each request is capped at 100 records and 512 KiB on the server; Outreach Desk sends smaller batches. Google Apps Script execution and service quotas apply and can change. A quota or execution error is returned as an explicit JSON failure; pending records can be retried after the limit resets.
- The endpoint writes only fixed columns, validates URLs and values again on the server, stores text-like values safely against formula injection, and never executes formulas from request data. A recognized v0.5 schema is upgraded by adding named columns; an unrelated/incomplete schema fails with a new-workbook instruction rather than rewriting it.
- There is no `Campaigns` tab because this interface does not submit an authoritative campaign snapshot. Adding an append-only campaign log would produce duplicates when a request is retried.

See Google's current [Apps Script web-app deployment guide](https://developers.google.com/apps-script/guides/web) and [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) for access and limit details.
