# Phone assistant

[Deutsche Fassung](README.de.md)

Answers calls on the RepoCity business number in German. Everything runs on the RepoCity server
with its graphics card; no cloud service is involved and nothing is paid for.

```
provider (SIP trunk) -> livekit-sip -> livekit -> agent -> speech (faster-whisper, Piper)
                                                       -> ollama (Qwen 3)
                                                       -> CRM in Supabase (REST, service key)
```

What a call looks like:

1. The assistant greets with the text from `crm.settings.assistant_greeting` and says that it is an
   artificial intelligence and that the call is written down. Without a greeting in the CRM it uses
   a built-in one with the same disclosure. The greeting cannot be talked over.
2. It answers only from `crm.settings.assistant_facts` and the active `crm.products`; it never
   invents prices, dates or promises.
3. Tools: look up the caller by number, take a request (`crm.intake_call`, at most once per call),
   accept or decline a quote (`crm.phone_quote_decision`; the sentence it returns is read out word
   for word), book a callback, end the call.
   - Before taking a request it asks "Wie sind Sie auf uns aufmerksam geworden?" and picks one
     value of the CRM's fixed channel list (`google_search`, `google_maps`, `linkedin`, ...,
     `referral`; anything else is `other`, no answer stays empty), handed on as `p_channel`.
   - A callback (`request_callback`, at most once per call) goes to `crm.callback_from_call`.
     The instructions carry the date and time of the call start in German time, so the model
     turns "Montag um zehn" into ISO 8601 with offset; it repeats the understood day and time and
     lets the caller confirm. The CRM books the wished time when it lies ahead, within 60 days
     and inside business hours, otherwise a callback today without a time with the wish in the
     note, and tells Daniel in the Cockpit. So the caller only hears what is true: Daniel calls
     back, at the wished time if it fits, otherwise as soon as possible.
4. Voice activity detection, turn detection and interruptions while the assistant speaks run
   locally. After `MAX_CALL_MINUTES` the assistant says goodbye and hangs up; the phone line
   itself ends calls two minutes later as a second limit.
5. At the end the call is summarised by the local model and stored with `crm.record_call`
   (transcript, summary, outcome), which also puts a notice into the Cockpit.

## Components

| Part | Version | Licence | Source |
|---|---|---|---|
| LiveKit server | 1.13.10 | Apache 2.0 | hub.docker.com/r/livekit/livekit-server |
| LiveKit SIP | 1.21.0 | Apache 2.0 | github.com/livekit/sip |
| LiveKit Agents (Python) | 1.8.9 | Apache 2.0 | pypi.org/project/livekit-agents |
| Silero voice activity model | plugin 1.8.9 | MIT (model), Apache 2.0 (plugin) | pypi.org/project/livekit-plugins-silero |
| Turn detector `v1-mini` | livekit-local-inference 0.2.7 | LiveKit Model License: free, only together with LiveKit Agents | pypi.org/project/livekit-local-inference |
| Valkey (Redis-compatible store LiveKit needs) | 9.0.6 | BSD 3-Clause | hub.docker.com/r/valkey/valkey |
| faster-whisper | 1.2.1 | MIT | pypi.org/project/faster-whisper |
| Whisper `large-v3-turbo` weights | CTranslate2 conversion | MIT | huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo |
| Ollama | 0.40.11 | MIT | github.com/ollama/ollama |
| Qwen 3 (`qwen3:8b`) | | Apache 2.0 | huggingface.co/Qwen/Qwen3-8B, ollama.com/library/qwen3 |
| Piper (`piper-tts`) | 1.8.0 | GPL 3.0 or later | pypi.org/project/piper-tts |
| Voice `de_DE-ramona-low` (female, 16 kHz) | | trained from scratch on the German M-AILABS data; M-AILABS licence allows "any commercial use"; voice files MIT | huggingface.co/rhasspy/piper-voices (MODEL_CARD), github.com/i-celeste-aurora/m-ailabs-dataset |

Plain notes on what this means:

- Piper 1.8 is GPL 3.0. It runs as its own service on Daniel's server and is not handed to anyone,
  so business use is allowed without further duties.
- The Whisper weights were published by OpenAI under the MIT licence; they run locally and nothing
  is sent to OpenAI. LiveKit Agents installs the `openai` Python package as a fixed dependency;
  this project never imports it and calls no OpenAI service. The Ollama plugin uses LiveKit's
  conversion into the widespread OpenAI message layout only as a data format and then talks to
  Ollama's own interface `/api/chat`.
- Claude and the paid Anthropic interface are not used at any point.
- Other female German Piper voices were checked and not chosen: `kerstin` is fine-tuned from an
  English voice whose data forbids commercial use; `eva_k` is lower quality.

## Setting up the server

Needs: Linux, Docker with the NVIDIA container toolkit, a graphics card with at least 12 GB memory,
a public address, and a SIP provider that sends calls to that address without SIP registration
(LiveKit SIP does not register at the provider) and authenticates with user name and password.
Firewall: only the phone line comes in from outside. The LiveKit server's media ports (7881 TCP,
50000 to 50200 UDP) listen on every address because of host networking and stay closed by the firewall:

```bash
sudo ufw allow 5060/udp
sudo ufw allow 5060/tcp
sudo ufw allow 10000:20000/udp
sudo ufw --force enable
```

```bash
cd telefon
cp .env.example .env
openssl rand -hex 32          # paste as LIVEKIT_API_SECRET into .env
# fill SIP_NUMBER, SIP_TRUNK_HOST, SIP_TRUNK_USER, SIP_TRUNK_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
docker compose up -d
docker compose run --rm sip-setup
```

The first start downloads the Qwen 3 model, the Whisper model and the Piper voice into Docker
volumes; `docker compose ps` shows every service as healthy once they are loaded. `sip-setup`
creates the inbound trunk and the dispatch rule; run it again after changing the number or the
provider access, it updates them in place. In the provider's portal, set the destination of the
number to `sip:<number>@<public address of the server>:5060`.

The CRM migration `crm/supabase/migrations/005_calls.sql` must be live before the first call.
Callbacks and the channel question need `009_kalender.sql` and `011_herkunft.sql` as well.

The RadarAuditor worker on the same server uses the speech service for spoken requests of the
Cockpit assistant. The service listens on 127.0.0.1 only unless `.env` sets
`SPEECH_HOST=0.0.0.0`; then let only the Docker networks through the firewall
(`sudo ufw allow from 172.16.0.0/12 to any port 8090 proto tcp`). The steps on the RadarAuditor
side are in its README, section "Cockpit assistant".

## Development

```bash
cd telefon
uv sync --extra agent --extra speech
uv run ruff check . && uv run ruff format --check .
uv run mypy src tests
uv run pytest
```

The behaviour tests run the real LiveKit agent session with a scripted model in place of Qwen 3
and a scripted CRM. Two checks download models and are off by default:

```bash
TELEFON_SPEECH_SMOKE=1 uv run pytest -k whisper
uv run python scripts/speech_smoke.py --voice de_DE-ramona-low --whisper-model small \
    --model-dir models --out smoke.wav
```

| Command | Purpose |
|---|---|
| `telefon-agent start` | Worker that answers calls |
| `telefon-speech` | Speech service (`/health`, `/transcribe`, `/synthesize`) |
| `telefon-sip-setup` | Inbound trunk and dispatch rule from `.env` |
