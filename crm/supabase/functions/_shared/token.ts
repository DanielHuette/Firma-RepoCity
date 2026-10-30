// The secret part of the CRM's public links (calendar feed, opt-out, appointment page): a UUID in a
// query field, t unless the link names another.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token of the link in lower case, or null when the link has none or a malformed one. */
export function linkToken(url: string, field = "t"): string | null {
  const token = new URL(url).searchParams.get(field) ?? "";
  return UUID.test(token) ? token.toLowerCase() : null;
}
