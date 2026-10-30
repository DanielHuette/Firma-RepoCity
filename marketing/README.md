# RepoCity Marketing

[Deutsche Fassung](README.de.md)

Research with every figure checked against its source, campaigns and posts handed to the
planner for approval, posted by hand from the company accounts.

| Part | Where | Purpose |
|---|---|---|
| `src/agentic_marketing/` | the operator's PC | `verify`, `review`, `apply`, `pack`, `stale`, `campaign` |
| `app/` | Cloudflare Pages, app.agenticmarketing.speedofthespirit.dev | campaigns, planner, approval |
| `supabase/migrations/` | schema `marketing` in the shared database | posts, plan, reports to the Cockpit |
| `workspaces/radarauditor/` | the operator's PC | research workspace |

## Links carry their channel

The `campaign` command gives every link of a post to an own site (`https://speedofthespirit.dev` and its
subdomains) the markers the CRM reads (`crm.channel_from` in
`crm/supabase/migrations/011_herkunft.sql`), unless the link already carries a `utm_` parameter:

| Parameter | Value |
|---|---|
| `utm_source` | the channel of the post (`linkedin`, `x`, `newsletter`, ...) |
| `utm_medium` | `email` for the newsletter, `social` for every other channel |
| `utm_campaign` | the campaign slug (1 to 100 characters of `a-z`, `0-9`, `-`) |
| `utm_content` | the post slug |

Other parameters and the fragment stay; links to other sites stay as written. Blog posts are pages
of an own site and stay unmarked, so a visitor keeps the markers they arrived with. Posts of the
channel `presse` arrive in the CRM as "Sonstiges", because the CRM has no press channel.
The code is in `src/agentic_marketing/tracking.py`. The button "Text kopieren" in the web app marks the copied text by the same rules (`app/src/lib/tracking.ts`, same test cases); there a campaign slug over 100 characters is left out instead of refused.

Checks: `uv run ruff check src tests`, `uv run mypy src`, `uv run pytest`, `cd app && npm run check && npx vitest run`.
