"""Set up the inbound phone line in LiveKit SIP from the settings in `.env`.

Context: run once after `docker compose up -d` and again whenever the number or the provider
access changes; a second run updates the existing trunk and rule instead of adding new ones. |
Input: SipSettings (business number, provider host, user and password). | Output: one inbound
trunk and one dispatch rule that sends every call into its own room with the agent.

Usage:
    telefon-sip-setup
"""

import asyncio
import ipaddress
import logging
import socket
from collections.abc import Callable
from typing import Protocol

from google.protobuf.duration_pb2 import Duration
from livekit import api

from .errors import ConfigurationError
from .settings import SipSettings, load

TRUNK_NAME = "RepoCity Geschäftsnummer"
RULE_NAME = "RepoCity Anrufe"
ROOM_PREFIX = "anruf-"
# The line itself ends a call a little after the agent's own limit, in case the agent hangs.
_LINE_LIMIT_GRACE_MINUTES = 2
Resolver = Callable[[str], list[str]]


class SipAdmin(Protocol):
    """The part of LiveKit's SIP service this setup uses."""

    async def list_inbound_trunk(
        self, list: api.ListSIPInboundTrunkRequest
    ) -> api.ListSIPInboundTrunkResponse:
        """List inbound trunks."""

    async def create_inbound_trunk(
        self, create: api.CreateSIPInboundTrunkRequest
    ) -> api.SIPInboundTrunkInfo:
        """Create an inbound trunk."""

    async def update_inbound_trunk(
        self, trunk_id: str, trunk: api.SIPInboundTrunkInfo
    ) -> api.SIPInboundTrunkInfo:
        """Replace an inbound trunk."""

    async def list_dispatch_rule(
        self, list: api.ListSIPDispatchRuleRequest
    ) -> api.ListSIPDispatchRuleResponse:
        """List dispatch rules."""

    async def create_dispatch_rule(
        self, create: api.CreateSIPDispatchRuleRequest
    ) -> api.SIPDispatchRuleInfo:
        """Create a dispatch rule."""

    async def update_dispatch_rule(
        self, rule_id: str, rule: api.SIPDispatchRuleInfo
    ) -> api.SIPDispatchRuleInfo:
        """Replace a dispatch rule."""


def _system_resolve(host: str) -> list[str]:
    return [str(info[4][0]) for info in socket.getaddrinfo(host, None)]


def provider_addresses(host: str, resolve: Resolver = _system_resolve) -> list[str]:
    """Return the provider's addresses, from which alone calls are accepted.

    Args:
        host: Host name or address of the provider's SIP server.
        resolve: Name lookup, replaced in tests.

    Returns:
        Single-address networks in the order found, without duplicates.

    Raises:
        ConfigurationError: If the host cannot be resolved.
    """
    try:
        found = resolve(host)
    except OSError as error:
        raise ConfigurationError(f"SIP_TRUNK_HOST {host} cannot be resolved") from error
    networks = (ipaddress.ip_network(address) for address in found)
    return list(dict.fromkeys(str(network) for network in networks))


def inbound_trunk(settings: SipSettings, addresses: list[str]) -> api.SIPInboundTrunkInfo:
    """Describe the trunk that accepts calls to the business number from the provider only."""
    limit_minutes = settings.max_call_minutes + _LINE_LIMIT_GRACE_MINUTES
    return api.SIPInboundTrunkInfo(
        name=TRUNK_NAME,
        numbers=[settings.sip_number],
        allowed_addresses=addresses,
        auth_username=settings.sip_trunk_user,
        auth_password=settings.sip_trunk_password.get_secret_value(),
        max_call_duration=Duration(seconds=limit_minutes * 60),
        krisp_enabled=False,
    )


def dispatch_rule(settings: SipSettings, trunk_id: str) -> api.SIPDispatchRuleInfo:
    """Describe the rule that puts every call into its own room together with the agent."""
    individual = api.SIPDispatchRuleIndividual(room_prefix=ROOM_PREFIX)
    return api.SIPDispatchRuleInfo(
        name=RULE_NAME,
        trunk_ids=[trunk_id],
        rule=api.SIPDispatchRule(dispatch_rule_individual=individual),
        room_config=api.RoomConfiguration(
            agents=[api.RoomAgentDispatch(agent_name=settings.agent_name)]
        ),
    )


async def _ensure_trunk(sip: SipAdmin, trunk: api.SIPInboundTrunkInfo) -> str:
    existing = await sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())
    for item in existing.items:
        if item.name == trunk.name:
            await sip.update_inbound_trunk(item.sip_trunk_id, trunk)
            return item.sip_trunk_id
    created = await sip.create_inbound_trunk(api.CreateSIPInboundTrunkRequest(trunk=trunk))
    return created.sip_trunk_id


async def _ensure_rule(sip: SipAdmin, rule: api.SIPDispatchRuleInfo) -> str:
    existing = await sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())
    for item in existing.items:
        if item.name == rule.name:
            await sip.update_dispatch_rule(item.sip_dispatch_rule_id, rule)
            return item.sip_dispatch_rule_id
    request = api.CreateSIPDispatchRuleRequest(dispatch_rule=rule)
    return (await sip.create_dispatch_rule(request)).sip_dispatch_rule_id


async def ensure_phone_line(
    sip: SipAdmin, settings: SipSettings, addresses: list[str]
) -> tuple[str, str]:
    """Create or update the inbound trunk and its dispatch rule.

    Args:
        sip: LiveKit SIP service.
        settings: Number, provider access, agent name and call limit.
        addresses: Provider addresses from provider_addresses.

    Returns:
        Ids of the trunk and the dispatch rule.
    """
    trunk_id = await _ensure_trunk(sip, inbound_trunk(settings, addresses))
    rule_id = await _ensure_rule(sip, dispatch_rule(settings, trunk_id))
    return trunk_id, rule_id


async def _run(settings: SipSettings) -> None:
    addresses = provider_addresses(settings.sip_trunk_host)
    http_url = settings.livekit_url.replace("ws", "http", 1)
    secret = settings.livekit_api_secret.get_secret_value()
    async with api.LiveKitAPI(http_url, settings.livekit_api_key, secret) as livekit:
        trunk_id, rule_id = await ensure_phone_line(livekit.sip, settings, addresses)
    print(f"Inbound trunk {trunk_id} and dispatch rule {rule_id} set up for {settings.sip_number}.")


def main() -> None:
    """Read `.env` settings and set up the phone line."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(_run(load(SipSettings)))
    except ConfigurationError as error:
        raise SystemExit(f"telefon-sip-setup: {error}") from error


if __name__ == "__main__":
    main()
