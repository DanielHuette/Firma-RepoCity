// Turns database and network failures into sentences Daniel can act on.
export class QueryError extends Error {
  readonly code: string | null;
  readonly detail: string;

  constructor(action: string, message: string, code: string | null) {
    super(`${action}: ${message}`);
    this.name = "QueryError";
    this.code = code;
    this.detail = message;
  }
}

/** A recording that did not reach the storage bucket. */
export class UploadError extends Error {
  constructor(readonly detail: string) {
    super(`Aufnahme hochladen: ${detail}`);
    this.name = "UploadError";
  }
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const RAISED_EXCEPTION = "P0001";
const EXPIRED_TOKEN = "PGRST301";
const ROW_SECURITY = "42501";

const READ_ONLY = "Nur Lesen: Diese Aktion darf nur der Administrator ausführen.";

// The database raises its refusals in plain German, so they are shown as they are.
function explainRaised(detail: string): string {
  if (detail.startsWith("Nur der Administrator")) return READ_ONLY;
  return detail;
}

export function describeError(error: unknown): string {
  if (error instanceof UploadError) {
    return `Die Aufnahme ließ sich nicht hochladen. Prüfe dein Netz und tipp auf „Noch mal senden“. (${error.detail})`;
  }
  if (error instanceof QueryError) {
    switch (error.code) {
      case UNIQUE_VIOLATION:
        return "Diesen Eintrag gibt es schon.";
      case FOREIGN_KEY_VIOLATION:
        return "Der Eintrag hängt an Daten, die es nicht mehr gibt. Lade die Seite neu.";
      case RAISED_EXCEPTION:
        return explainRaised(error.detail);
      case ROW_SECURITY:
        return READ_ONLY;
      case EXPIRED_TOKEN:
        return "Deine Anmeldung ist abgelaufen. Melde dich neu an.";
      default:
        return `Das hat nicht geklappt. (${error.message})`;
    }
  }
  if (error instanceof TypeError) return "Keine Verbindung zum Server. Prüfe dein Netz und versuch es noch mal.";
  if (error instanceof Error) return `Das hat nicht geklappt. (${error.message})`;
  return "Das hat nicht geklappt.";
}
