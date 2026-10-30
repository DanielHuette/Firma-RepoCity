-- Results counted by the cookie-free page counter. Context: the counter replaces the planned
-- Cloudflare analytics source, whose token lacks read access to zone analytics.
-- Input: none. Output: a new value of marketing.metric_source.
alter type marketing.metric_source add value if not exists 'counter';
