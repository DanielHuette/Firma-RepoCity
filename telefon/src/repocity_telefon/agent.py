"""The phone assistant as a LiveKit agent: greeting, instructions and tools.

Context: one instance per call; the voice pipeline around it is built in worker.py. | Input:
business facts from the CRM and the tool actions of this call. | Output: the spoken greeting,
model instructions and the tools the model may use.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Literal

from livekit.agents import Agent, RunContext, function_tool
from livekit.agents.beta.tools import EndCallTool
from livekit.agents.voice.events import ConversationItemAddedEvent

from .call_log import CallLog
from .call_tools import CallTools
from .facts import BusinessFacts, build_instructions, opening_line

SIP_CALLER_ATTRIBUTE = "sip.phoneNumber"
MAX_CALLER_NUMBER_CHARS = 60
GOODBYE_INSTRUCTIONS = "Verabschiede dich in einem kurzen, freundlichen Satz."


def caller_number(attributes: Mapping[str, str]) -> str:
    """Return the caller's number as LiveKit SIP reports it, empty when suppressed.

    LiveKit copies the user part of the SIP From header, which is a word such as `anonymous`
    for a hidden number; without a single digit there is no number. crm.record_call refuses a
    caller number longer than 60 characters, so a longer user part is cut.
    """
    reported = attributes.get(SIP_CALLER_ATTRIBUTE, "").strip()
    if not any(character.isdigit() for character in reported):
        return ""
    return reported[:MAX_CALLER_NUMBER_CHARS]


def record_turn(log: CallLog, event: ConversationItemAddedEvent) -> None:
    """Copy a spoken turn of the conversation into the call log."""
    item = event.item
    if item.type != "message" or item.role not in ("user", "assistant"):
        return
    log.add("caller" if item.role == "user" else "assistant", item.text_content or "")


class TelefonAgent(Agent):
    """Answers a call for RepoCity with the facts from the CRM."""

    def __init__(
        self, facts: BusinessFacts, tools: CallTools, *, now: datetime | None = None
    ) -> None:
        """Create the agent of one call.

        Args:
            facts: Greeting, business facts and products from the CRM.
            tools: Tool actions bound to this call.
            now: Start of the call; the current time when not given.
        """
        super().__init__(
            instructions=build_instructions(facts, now=now or datetime.now(UTC)),
            tools=[EndCallTool(end_instructions=GOODBYE_INSTRUCTIONS, ignore_on_enter=True)],
        )
        self._greeting = opening_line(facts)
        self._call_tools = tools

    async def on_enter(self) -> None:
        """Greet the caller; the AI disclosure cannot be talked over."""
        self.session.say(self._greeting, allow_interruptions=False)

    @function_tool
    async def look_up_caller(self) -> str:
        """Check whether the caller's phone number belongs to a known customer."""
        return await self._call_tools.look_up_caller()

    @function_tool
    async def take_request(
        self,
        name: str,
        company: str,
        subject: str,
        message: str,
        email: str = "",
        channel: str = "",
    ) -> str:
        """File what the caller wants from Daniel; use once per call when everything is known.

        Args:
            name: Caller's name.
            company: Caller's company, empty for private persons.
            subject: A few words on what the request is about.
            message: The request in the caller's words, with every detail they gave.
            email: E-mail address, only if the caller wanted to give one.
            channel: How the caller found RepoCity, one value of the list in the instructions;
                empty when the caller gave no answer.
        """
        return await self._call_tools.take_request(name, company, email, subject, message, channel)

    @function_tool
    async def decide_quote(
        self,
        context: RunContext[None],
        quote_number: str,
        intent: Literal["accept", "decline"],
        summary: str,
    ) -> None:
        """Accept or decline a quote after the caller confirmed it; the result is read out.

        Args:
            context: Running call, used to speak the result word for word.
            quote_number: Quote number as the caller said it, for example AN-2026-0004.
            intent: accept or decline.
            summary: One sentence on what the caller said.
        """
        sentence = await self._call_tools.decide_quote(quote_number, intent, summary)
        context.session.say(sentence)

    @function_tool
    async def request_callback(self, reason: str, wished_time: str = "") -> str:
        """Book a callback by Daniel after the caller confirmed the understood time.

        Args:
            reason: What the callback is about.
            wished_time: Wished date and time in ISO 8601 with offset, for example
                2026-11-02T10:00:00+01:00; empty when the caller named no time.
        """
        return await self._call_tools.request_callback(reason, wished_time)
