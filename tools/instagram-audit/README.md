# Instagram audit collector

The local half of the ERP's Instagram audit. It opens a real browser, **you** log into
Instagram yourself, and it reads your own profile's grid into the ERP — which then computes
the figures and asks the AI to phrase them.

This directory is a **separate npm package on purpose**. Playwright downloads a browser on
install, and it has no business in the deployed app's dependencies — nothing in `app/` or
`lib/` imports anything here. It is an operator tool that runs on a laptop.

---

## Why it works this way

**Why not the Instagram API?** You asked for no API. This is the version of "connect your
Instagram" that needs no developer app, no review, and no API key.

**Why on your laptop and not on the server?** A logged-in browser session cannot live in a
serverless function — no display, no persistent profile, and a lifetime measured in seconds.
That is a fact about the hosting, not a preference. So collection runs where you are, and the
ERP exposes one narrow endpoint for the result.

**Your password.** This tool never asks for it, never stores it, and never sees it. You type
it into Instagram's own login page in a normal browser window. What persists between runs is
Chromium's own profile directory, `.profile/` — the same thing that keeps you logged in when
you use a browser yourself. It is gitignored. Treat it like the password: never commit it,
never copy it to another machine, never share it.

**Two things to know before you run it.** Automating a logged-in Instagram session is against
Instagram's Terms of Use, and accounts doing it can be rate-limited or locked. You decided to
accept that. The tool is deliberately unhurried and reads only your own connected profile,
which is the mildest version of the thing, but the risk is real and it is yours.

---

## Setup, once

```bash
cd solar-pulse-os/tools/instagram-audit
npm install          # also downloads Chromium (~150 MB)
```

## Connect the account, once

In the ERP: **Marketing → AI Insights → Connect Instagram account**, and enter the handle.

The sync endpoint refuses a handle nobody connected, so this step is what authorises
collection for that account. It cannot be skipped, and it is why a stolen sync token cannot
be used to file data for an arbitrary profile.

## Every run

1. In the ERP, **Marketing → AI Insights → Run the collector**. Copy the token — it lasts
   30 minutes and works exactly once.
2. Run:

```bash
node collect.mjs --username solarpulse --erp http://localhost:3000 --token <TOKEN>
```

3. A browser window opens. **Log into Instagram in it.** The tool waits (up to 10 minutes).
   After the first run the session is usually still there and this step is skipped.
4. It opens your profile, pages the grid, and posts what it read.
5. Back in the ERP, **Generate audit**.

To see exactly what would be sent without sending it:

```bash
node collect.mjs --username solarpulse --dry-run
```

### Flags

| Flag | Meaning |
|---|---|
| `--username <handle>` | Required. Must already be connected in the ERP. |
| `--erp <url>` | ERP base URL. Default `http://localhost:3000`, or `IG_AUDIT_ERP_URL`. |
| `--token <token>` | Sync token, or `IG_AUDIT_TOKEN`. |
| `--scrolls <n>` | How many times to page the grid. Default 6, roughly 70–100 posts. |
| `--out <file>` | Also write the payload to a file, so you can read what was sent. |
| `--dry-run` | Collect and write the file, post nothing. |
| `--keep-open` | Leave the browser open at the end, for when something looks wrong. |

---

## What it collects, and what it cannot

**It reads** — from the JSON Instagram's own web app fetches, not from the rendered HTML, so
the numbers are exact rather than the page's rounded "12.4K":

- profile: display name, bio, category, link, professional flag, followers, following, post count
- per post: shortcode, media type (image / carousel / reel / video), carousel size, caption,
  hashtags, likes, comments, video views, timestamp

**It cannot read, and does not estimate:** reach, impressions, saves, shares, profile visits,
follower growth over time, audience demographics, story performance. Those live behind the
Professional dashboard's Insights panes, which are not on the page this reads.

That shapes the audit, honestly and on purpose:

- "Engagement rate" means `(likes + comments) / followers`. It is **not** reach-based, and the
  AI prompt forbids describing it as such.
- Anything unreadable is sent as `null`, and the ERP treats `null` as **"could not be read",
  never as zero**. A hidden like count stays null and the audit says how many were hidden,
  rather than averaging in a zero and inventing a bad month.
- When the tool knows it got less than it tried for, it sets `partial` and says why. That
  becomes `sync_status = 'partial'` in the ERP and is shown next to the account.

---

## When it goes wrong

**"Timed out waiting for login"** — the window was left at the login screen for ten minutes.
Run it again.

**"Nothing usable was collected"** — the grid never loaded. Try `--keep-open` and look at the
window: a checkpoint / "suspicious login" challenge, or a private profile you are not
following, will both produce this. Solve the challenge in the window, then run again.

**Very few posts** — raise `--scrolls`. It stops early when a scroll yields nothing new, so a
larger number costs nothing on a small account.

**`401 Invalid or expired sync token`** — tokens last 30 minutes and work once. Get a new one.

**`404 @handle is not connected in the ERP`** — do the connect step above. The handle must
match exactly.

**Instagram asks for a code every single run** — `.profile/` is being wiped between runs, or
Instagram is not trusting the session. Check the directory still exists after a run, and that
you are not passing a different profile path.
