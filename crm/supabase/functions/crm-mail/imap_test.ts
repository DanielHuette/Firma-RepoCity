import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { Imap } from "./imap.ts";

// A scripted IMAP server: answers each command with canned lines, delivered in small chunks so
// line and literal assembly across reads is exercised.
class FakeServer {
  private outgoing = new TextEncoder().encode("* OK ready\r\n");
  readonly received: string[] = [];
  constructor(private readonly replies: (tag: string, command: string) => string) {}
  read(buffer: Uint8Array): Promise<number | null> {
    if (this.outgoing.length === 0) return Promise.resolve(null);
    const count = Math.min(7, buffer.length, this.outgoing.length);
    buffer.set(this.outgoing.subarray(0, count));
    this.outgoing = this.outgoing.slice(count);
    return Promise.resolve(count);
  }
  write(data: Uint8Array): Promise<number> {
    const line = new TextDecoder().decode(data).trimEnd();
    this.received.push(line);
    const [tag, ...rest] = line.split(" ");
    const reply = new TextEncoder().encode(this.replies(tag, rest.join(" ")));
    const merged = new Uint8Array(this.outgoing.length + reply.length);
    merged.set(this.outgoing);
    merged.set(reply, this.outgoing.length);
    this.outgoing = merged;
    return Promise.resolve(data.length);
  }
  close(): void {}
}

Deno.test("IMAP client logs in, lists folders, searches and fetches literals", async () => {
  const message = "From: Erika <erika@firma.de>\r\nSubject: Anfrage\r\n\r\nHallo {5}\r\nzweite Zeile";
  const bytes = new TextEncoder().encode(message).length;
  const server = new FakeServer((tag, command) => {
    if (command.startsWith("LOGIN")) return `${tag} OK LOGIN completed\r\n`;
    if (command.startsWith("LIST")) return `* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Gesendet"\r\n${tag} OK\r\n`;
    if (command.startsWith("EXAMINE")) return `* 3 EXISTS\r\n* OK [UIDVALIDITY 4711] UIDs valid\r\n${tag} OK [READ-ONLY]\r\n`;
    if (command.startsWith("UID SEARCH")) return `* SEARCH 12 5 9\r\n${tag} OK\r\n`;
    if (command.includes("RFC822.SIZE")) return `* 1 FETCH (UID 5 RFC822.SIZE ${String(bytes)})\r\n${tag} OK\r\n`;
    if (command.includes("BODY.PEEK")) return `* 1 FETCH (UID 5 BODY[] {${String(bytes)}}\r\n${message})\r\n${tag} OK\r\n`;
    if (command.startsWith("LOGOUT")) return `* BYE\r\n${tag} OK\r\n`;
    return `${tag} BAD unknown\r\n`;
  });
  const imap = await Imap.open("x", "user@x.de", 'pa"ss', () => Promise.resolve(server));
  assertEquals(server.received[0], 'C1 LOGIN "user@x.de" "pa\\"ss"');
  assertEquals(await imap.folders(), { inbox: "INBOX", sent: "Gesendet" });
  assertEquals(await imap.select("INBOX"), 4711);
  assertEquals(await imap.search("UID 1:*"), [5, 9, 12]);
  assertEquals(await imap.size(5), bytes);
  const raw = await imap.fetch(5);
  assertEquals(new TextDecoder().decode(raw ?? new Uint8Array()), message);
  await imap.close();
});

Deno.test("IMAP client reports a refused login in plain words", async () => {
  const server = new FakeServer((tag) => `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials(Failure)\r\n`);
  let message = "";
  try { await Imap.open("x", "u", "p", () => Promise.resolve(server)); } catch (error) { message = (error as Error).message; }
  assertStringIncludes(message, "AUTHENTICATIONFAILED");
});
