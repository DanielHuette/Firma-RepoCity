-- Numbers a post declares as no claim, such as a step count. Context: the app re-checks a post
-- after an edit and needs the same allowance the campaign file gave it.
-- Input: none. Output: column marketing.posts.free_figures.
alter table marketing.posts add column if not exists free_figures text[] not null default '{}';
