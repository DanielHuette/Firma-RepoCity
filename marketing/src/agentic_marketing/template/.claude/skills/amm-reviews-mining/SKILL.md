---
name: amm-reviews-mining
description: Pull the wording out of real reviews - the company's own and its competitors' - so copy uses the customer's words instead of the company's. Use before writing anything a customer will read.
---

# Review mining

The cheapest source of true sentences about a market is the people already complaining
about it in public.

Write into a run folder as `.claude/run-format.md` describes, lens `reviews`.

## What to collect

Read reviews of the company and of at least two competitors. For each, record:

- **The words** The phrase a customer used, quoted exactly, including the clumsy ones.
  The clumsy ones are the ones that sound human in an advertisement.
- **The trigger** What made them look for a solution in the first place.
- **The obstacle** What almost stopped them buying.
- **The relief** What they say changed after.

## Counting, not impressions

A finding here is only worth keeping if it is counted. "Several customers mention
onboarding" is not a finding. "Onboarding is named in 23 of 140 reviews, in 19 of them
as a reason for a low rating" is.

So record the figures: how many reviews were read, how many carry the phrase, over what
period, on which portal. Those are the `figures` the check will look for in the export.

Save the export into `daten/quellen/` and cite it as a local source. Review portals
rewrite their pages constantly.

## What not to do

Do not mine reviews of named individuals, and do not reproduce a reviewer's name,
handle or anything that identifies them. The wording is the material; the person is not.

## Finishing

The curated file is written by `agentic-marketing apply`. Report to `inbox/`.
