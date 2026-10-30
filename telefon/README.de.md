# Telefonassistentin

[English version](README.md)

Nimmt Anrufe auf der Geschäftsnummer von RepoCity auf Deutsch an. Alles läuft auf dem
RepoCity-Server mit seiner Grafikkarte; kein Cloud-Dienst ist beteiligt, nichts kostet Geld.

```
Anbieter (SIP-Leitung) -> livekit-sip -> livekit -> agent -> speech (faster-whisper, Piper)
                                                          -> ollama (Qwen 3)
                                                          -> CRM in Supabase (REST, Dienstschlüssel)
```

So läuft ein Anruf:

1. Die Assistentin begrüßt mit dem Text aus `crm.settings.assistant_greeting` und sagt, dass sie
   eine künstliche Intelligenz ist und das Gespräch mitgeschrieben wird. Fehlt der Text im CRM,
   nimmt sie eine eingebaute Begrüßung mit demselben Hinweis. Die Begrüßung lässt sich nicht
   unterbrechen.
2. Sie antwortet nur aus `crm.settings.assistant_facts` und den aktiven `crm.products`; Preise,
   Termine oder Zusagen erfindet sie nie.
3. Werkzeuge: Anrufer anhand der Nummer nachschlagen, Anliegen aufnehmen (`crm.intake_call`,
   höchstens einmal pro Anruf), Angebot annehmen oder ablehnen (`crm.phone_quote_decision`; den
   zurückgegebenen Satz liest sie wörtlich vor), Rückruf eintragen, Gespräch beenden.
   - Bevor sie ein Anliegen aufnimmt, fragt sie „Wie sind Sie auf uns aufmerksam geworden?“ und
     wählt einen Wert aus der festen Liste der Kanäle im CRM (`google_search`, `google_maps`,
     `linkedin`, ..., `referral`; alles andere ist `other`, ohne Antwort bleibt es leer); er geht
     als `p_channel` mit.
   - Ein Rückruf (`request_callback`, höchstens einmal pro Anruf) geht an
     `crm.callback_from_call`. Die Anweisungen enthalten Datum und Uhrzeit des Anrufbeginns nach
     deutscher Zeit, damit das Modell aus „Montag um zehn“ ISO 8601 mit Versatz macht; es
     wiederholt Tag und Uhrzeit, wie es sie verstanden hat, und lässt sie bestätigen. Das CRM
     trägt die gewünschte Zeit ein, wenn sie in der Zukunft, innerhalb von 60 Tagen und in den
     Geschäftszeiten liegt, sonst einen Rückruf heute ohne Uhrzeit mit dem Wunsch in der Notiz,
     und meldet es Daniel im Cockpit. Der Anrufer hört deshalb nur, was stimmt: Daniel ruft
     zurück, zur gewünschten Zeit, wenn sie passt, sonst so bald wie möglich.
4. Spracherkennung der Sprechpausen, Erkennung des Sprecherwechsels und Unterbrechen, während sie
   spricht, laufen auf dem Server. Nach `MAX_CALL_MINUTES` verabschiedet sie sich und legt auf;
   die Telefonleitung selbst beendet Anrufe zwei Minuten später als zweite Grenze.
5. Am Ende fasst das lokale Modell den Anruf zusammen, und `crm.record_call` speichert Abschrift,
   Zusammenfassung und Ergebnis; dabei entsteht auch eine Mitteilung im Cockpit.

## Bausteine

| Teil | Version | Lizenz | Quelle |
|---|---|---|---|
| LiveKit-Server | 1.13.10 | Apache 2.0 | hub.docker.com/r/livekit/livekit-server |
| LiveKit SIP | 1.21.0 | Apache 2.0 | github.com/livekit/sip |
| LiveKit Agents (Python) | 1.8.9 | Apache 2.0 | pypi.org/project/livekit-agents |
| Silero-Modell für Sprechpausen | Plugin 1.8.9 | MIT (Modell), Apache 2.0 (Plugin) | pypi.org/project/livekit-plugins-silero |
| Sprecherwechsel-Erkennung `v1-mini` | livekit-local-inference 0.2.7 | LiveKit Model License: kostenlos, nur zusammen mit LiveKit Agents | pypi.org/project/livekit-local-inference |
| Valkey (Redis-kompatibler Speicher, den LiveKit braucht) | 9.0.6 | BSD 3-Clause | hub.docker.com/r/valkey/valkey |
| faster-whisper | 1.2.1 | MIT | pypi.org/project/faster-whisper |
| Whisper-Modell `large-v3-turbo` | CTranslate2-Fassung | MIT | huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo |
| Ollama | 0.40.11 | MIT | github.com/ollama/ollama |
| Qwen 3 (`qwen3:8b`) | | Apache 2.0 | huggingface.co/Qwen/Qwen3-8B, ollama.com/library/qwen3 |
| Piper (`piper-tts`) | 1.8.0 | GPL 3.0 oder neuer | pypi.org/project/piper-tts |
| Stimme `de_DE-ramona-low` (weiblich, 16 kHz) | | von Grund auf mit den deutschen M-AILABS-Daten trainiert; die M-AILABS-Lizenz erlaubt ausdrücklich „any commercial use“; Stimmdateien MIT | huggingface.co/rhasspy/piper-voices (MODEL_CARD), github.com/i-celeste-aurora/m-ailabs-dataset |

Was das im Klartext heißt:

- Piper 1.8 steht unter GPL 3.0. Es läuft als eigener Dienst auf Daniels Server und wird an
  niemanden weitergegeben; geschäftliche Nutzung ist damit ohne weitere Pflichten erlaubt.
- Die Whisper-Modelldaten hat OpenAI unter der MIT-Lizenz veröffentlicht; sie laufen auf dem
  Server, nichts geht an OpenAI. LiveKit Agents installiert das Python-Paket `openai` als feste
  Abhängigkeit; dieses Projekt benutzt es nicht und ruft keinen OpenAI-Dienst auf. Das
  Ollama-Plugin nutzt LiveKits Umwandlung in den verbreiteten OpenAI-Nachrichtenaufbau nur als
  Datenformat und spricht dann mit Ollamas eigener Schnittstelle `/api/chat`.
- Claude und die kostenpflichtige Anthropic-Schnittstelle werden an keiner Stelle genutzt.
- Andere weibliche deutsche Piper-Stimmen wurden geprüft und nicht gewählt: `kerstin` ist aus
  einer englischen Stimme weitertrainiert, deren Daten keine geschäftliche Nutzung erlauben;
  `eva_k` klingt schlechter.

## Server einrichten

Voraussetzungen: Linux, Docker mit dem NVIDIA Container Toolkit, eine Grafikkarte mit mindestens
12 GB Speicher, eine öffentliche Adresse und ein SIP-Anbieter, der Anrufe ohne Anmeldung per
SIP-Registrierung an diese Adresse schickt (LiveKit SIP meldet sich nicht beim Anbieter an) und
sich mit Benutzername und Passwort ausweist. Firewall: nur die Telefonleitung kommt von außen herein. Die
Medien-Ports des LiveKit-Servers (7881 TCP, 50000 bis 50200 UDP) lauschen wegen des Host-Netzwerks
auf allen Adressen und bleiben durch die Firewall zu:

```bash
sudo ufw allow 5060/udp
sudo ufw allow 5060/tcp
sudo ufw allow 10000:20000/udp
sudo ufw --force enable
```

```bash
cd telefon
cp .env.example .env
openssl rand -hex 32          # als LIVEKIT_API_SECRET in .env eintragen
# SIP_NUMBER, SIP_TRUNK_HOST, SIP_TRUNK_USER, SIP_TRUNK_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY eintragen
docker compose up -d
docker compose run --rm sip-setup
```

Beim ersten Start lädt der Server das Qwen-3-Modell, das Whisper-Modell und die Piper-Stimme in
Docker-Volumes; `docker compose ps` zeigt alle Dienste als gesund, sobald sie geladen sind.
`sip-setup` legt die eingehende SIP-Leitung und die Verteilregel an; nach einer Änderung von
Nummer oder Zugang einfach erneut ausführen, es ändert die vorhandenen Einträge. Im Portal des
Anbieters als Ziel der Nummer `sip:<Nummer>@<öffentliche Adresse des Servers>:5060` eintragen.

Die CRM-Migration `crm/supabase/migrations/005_calls.sql` muss vor dem ersten Anruf eingespielt
sein.
Rückrufe und die Frage nach dem Kanal brauchen zusätzlich `009_kalender.sql` und
`011_herkunft.sql`.

Der Worker des RadarAuditors auf demselben Server nutzt die Spracherkennung für gesprochene
Anfragen des Assistenten im Cockpit. Sie hört nur auf 127.0.0.1, außer `.env` setzt
`SPEECH_HOST=0.0.0.0`; dann nur die Docker-Netze durch die Firewall lassen
(`sudo ufw allow from 172.16.0.0/12 to any port 8090 proto tcp`). Die Schritte auf der Seite
des RadarAuditors stehen in dessen README, Abschnitt „Assistent im Cockpit“.

## Entwicklung

```bash
cd telefon
uv sync --extra agent --extra speech
uv run ruff check . && uv run ruff format --check .
uv run mypy src tests
uv run pytest
```

Die Verhaltenstests lassen die echte LiveKit-Gesprächssitzung mit einem Modell nach Drehbuch
statt Qwen 3 und einem CRM nach Drehbuch laufen. Zwei Prüfungen laden Modelle herunter und sind
deshalb abgeschaltet:

```bash
TELEFON_SPEECH_SMOKE=1 uv run pytest -k whisper
uv run python scripts/speech_smoke.py --voice de_DE-ramona-low --whisper-model small \
    --model-dir models --out smoke.wav
```

| Befehl | Zweck |
|---|---|
| `telefon-agent start` | Dienst, der die Anrufe annimmt |
| `telefon-speech` | Sprachdienst (`/health`, `/transcribe`, `/synthesize`) |
| `telefon-sip-setup` | Eingehende SIP-Leitung und Verteilregel aus `.env` |
