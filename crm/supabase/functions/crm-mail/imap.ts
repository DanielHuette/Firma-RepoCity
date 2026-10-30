// IMAP client (RFC 3501), only what the mail worker needs: login, folder list, read-only select,
// UID search and fetch, with literal handling across partial reads.
import { WorkerError } from "./errors.ts";

interface ImapResponse { text: string; literals: Uint8Array[] }

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface Conn {
  read(buffer: Uint8Array): Promise<number | null>;
  write(data: Uint8Array): Promise<number>;
  close(): void;
}

export class Imap {
  private buffer = new Uint8Array(0);
  private counter = 0;
  constructor(private readonly conn: Conn) {}

  static async open(host: string, user: string, password: string, connect?: () => Promise<Conn>): Promise<Imap> {
    const conn = connect === undefined ? await Deno.connectTls({ hostname: host, port: 993 }) : await connect();
    const imap = new Imap(conn);
    await imap.readResponse();
    await imap.command(`LOGIN ${quote(user)} ${quote(password)}`);
    return imap;
  }

  private async fill(): Promise<void> {
    const chunk = new Uint8Array(64 * 1024);
    const read = await this.conn.read(chunk);
    if (read === null) throw new WorkerError("Der Mailserver hat die Verbindung beendet.");
    this.buffer = concat(this.buffer, chunk.subarray(0, read));
  }

  private async readLine(): Promise<string> {
    for (;;) {
      for (let i = 0; i + 1 < this.buffer.length; i++) {
        if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
          const line = decoder.decode(this.buffer.subarray(0, i));
          this.buffer = this.buffer.slice(i + 2);
          return line;
        }
      }
      await this.fill();
    }
  }

  private async readBytes(count: number): Promise<Uint8Array> {
    while (this.buffer.length < count) await this.fill();
    const bytes = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return bytes;
  }

  async readResponse(): Promise<ImapResponse> {
    let text = await this.readLine();
    const literals: Uint8Array[] = [];
    for (let match = /\{(\d+)\}$/.exec(text); match !== null; match = /\{(\d+)\}$/.exec(text)) {
      literals.push(await this.readBytes(Number(match[1])));
      text = `${text.slice(0, match.index)}\u0000${String(literals.length - 1)}\u0000${await this.readLine()}`;
    }
    return { text, literals };
  }

  private async write(data: Uint8Array): Promise<void> {
    let written = 0;
    while (written < data.length) written += await this.conn.write(data.subarray(written));
  }

  async command(command: string): Promise<ImapResponse[]> {
    const tag = `C${String(++this.counter)}`;
    await this.write(encoder.encode(`${tag} ${command}\r\n`));
    const untagged: ImapResponse[] = [];
    for (;;) {
      const response = await this.readResponse();
      if (response.text.startsWith(`${tag} `)) {
        const status = response.text.slice(tag.length + 1);
        if (!status.startsWith("OK")) throw new WorkerError(`Mailserver: ${status.replace(/^(NO|BAD)\s*/, "").slice(0, 200)}`);
        return untagged;
      }
      untagged.push(response);
    }
  }

  async folders(): Promise<{ inbox: string; sent: string | null }> {
    const lines = await this.command('LIST "" "*"');
    let sent: string | null = null;
    for (const { text } of lines) {
      const match = /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/.exec(text);
      if (match === null) continue;
      const name = match[2].startsWith('"') ? match[2].slice(1, -1).replace(/\\(.)/g, "$1") : match[2];
      if (/\\Sent/i.test(match[1]) || (sent === null && /^(sent|gesendet)/i.test(name))) sent = name;
    }
    return { inbox: "INBOX", sent };
  }

  async select(folder: string): Promise<number> {
    const lines = await this.command(`EXAMINE ${quote(folder)}`);
    for (const { text } of lines) {
      const match = /\[UIDVALIDITY (\d+)\]/.exec(text);
      if (match !== null) return Number(match[1]);
    }
    return 0;
  }

  async search(criteria: string): Promise<number[]> {
    const lines = await this.command(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const { text } of lines) {
      if (text.startsWith("* SEARCH")) for (const part of text.slice(8).trim().split(/\s+/)) if (part !== "") uids.push(Number(part));
    }
    return uids.sort((a, b) => a - b);
  }

  async size(uid: number): Promise<number> {
    const lines = await this.command(`UID FETCH ${String(uid)} (RFC822.SIZE)`);
    for (const { text } of lines) {
      const match = /RFC822\.SIZE (\d+)/.exec(text);
      if (match !== null) return Number(match[1]);
    }
    return 0;
  }

  async fetch(uid: number, part = "BODY.PEEK[]"): Promise<Uint8Array | null> {
    const lines = await this.command(`UID FETCH ${String(uid)} (${part})`);
    for (const response of lines) if (response.literals.length > 0) return response.literals[0];
    return null;
  }

  async close(): Promise<void> {
    try { await this.command("LOGOUT"); } catch { /* the connection is closed either way */ }
    try { this.conn.close(); } catch { /* already closed */ }
  }
}
