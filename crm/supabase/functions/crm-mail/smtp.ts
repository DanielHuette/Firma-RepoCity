// SMTP client (implicit TLS on port 465, AUTH LOGIN) and the MIME message the worker sends.
import { SMTP_HOST } from "./config.ts";
import { WorkerError } from "./errors.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

export interface Attachment { name: string; bytes: Uint8Array; type: string }

export class Smtp {
  private buffer = "";
  private constructor(private readonly conn: Deno.TlsConn) {}

  static async send(user: string, password: string, from: string, to: string, message: Uint8Array): Promise<void> {
    const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: 465 });
    const smtp = new Smtp(conn);
    try {
      await smtp.expect(220);
      await smtp.say("EHLO crm.speedofthespirit.dev", 250);
      await smtp.say("AUTH LOGIN", 334);
      await smtp.say(btoa(user), 334);
      await smtp.say(btoa(password), 235);
      await smtp.say(`MAIL FROM:<${from}>`, 250);
      await smtp.say(`RCPT TO:<${to}>`, 250);
      await smtp.say("DATA", 354);
      const text = decoder.decode(message).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      await smtp.writeAll(encoder.encode(`${text}\r\n.\r\n`));
      await smtp.expect(250);
      await smtp.say("QUIT", 221).catch(() => undefined);
    } finally {
      try { conn.close(); } catch { /* closed */ }
    }
  }

  private async writeAll(data: Uint8Array): Promise<void> {
    let written = 0;
    while (written < data.length) written += await this.conn.write(data.subarray(written));
  }

  private async say(line: string, code: number): Promise<void> {
    await this.writeAll(encoder.encode(`${line}\r\n`));
    await this.expect(code);
  }

  private async expect(code: number): Promise<void> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        if (line[3] === "-") continue;
        if (!line.startsWith(String(code))) throw new WorkerError(`Versand: ${line.slice(0, 200)}`);
        return;
      }
      const chunk = new Uint8Array(4096);
      const read = await this.conn.read(chunk);
      if (read === null) throw new WorkerError("Der Mailserver hat die Verbindung beendet.");
      this.buffer += decoder.decode(chunk.subarray(0, read));
    }
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/.{76}/g, "$&\r\n");
}

function encodeWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${btoa(String.fromCharCode(...encoder.encode(text)))}?=`;
}

// RFC 8058: one HTTPS address in List-Unsubscribe and the fixed pair in List-Unsubscribe-Post let
// mail programs offer their own unsubscribe button, which sends a POST to that address.
function unsubscribeHeaders(address: string): string[] {
  if (address === "") return [];
  if (!/^https:\/\/[^\s<>"]+$/.test(address)) throw new WorkerError("Ungültige Abmeldeadresse der Mail.");
  return [`List-Unsubscribe: <${address}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"];
}

export function buildMime(input: { fromName: string; from: string; to: string; subject: string; body: string; messageId: string;
  attachment?: Attachment; listUnsubscribe?: string }): Uint8Array {
  const boundary = `crm-${crypto.randomUUID()}`;
  const headers = [
    `From: ${encodeWord(input.fromName)} <${input.from}>`, `To: <${input.to}>`, `Subject: ${encodeWord(input.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, `Message-ID: ${input.messageId}`, ...unsubscribeHeaders(input.listUnsubscribe ?? ""),
    "MIME-Version: 1.0",
  ];
  const textPart = `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(encoder.encode(input.body))}`;
  if (input.attachment === undefined) return encoder.encode(`${headers.join("\r\n")}\r\n${textPart}\r\n`);
  const file = input.attachment;
  return encoder.encode([
    ...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, textPart, `--${boundary}`,
    `Content-Type: ${file.type}; name="${file.name}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${file.name}"`, "",
    base64(file.bytes), `--${boundary}--`, "",
  ].join("\r\n"));
}
