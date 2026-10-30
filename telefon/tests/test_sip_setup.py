"""Tests of the setup of the inbound phone line in LiveKit SIP."""

from dataclasses import dataclass, field

import pytest
from livekit import api

from repocity_telefon.errors import ConfigurationError
from repocity_telefon.settings import SipSettings
from repocity_telefon.sip_setup import (
    RULE_NAME,
    TRUNK_NAME,
    dispatch_rule,
    ensure_phone_line,
    inbound_trunk,
    provider_addresses,
)

SETTINGS = SipSettings(
    livekit_url="ws://127.0.0.1:7880",
    livekit_api_key="key",
    livekit_api_secret="a-secret-of-at-least-thirty-two-chars",  # type: ignore[arg-type]
    sip_number="+492511234567",
    sip_trunk_host="sip.provider.example",
    sip_trunk_user="repocity",
    sip_trunk_password="password-1234",  # type: ignore[arg-type]
    max_call_minutes=15,
)


@dataclass
class FakeSip:
    """Inbound trunks and dispatch rules of a LiveKit server in memory."""

    trunks: list[api.SIPInboundTrunkInfo] = field(default_factory=list)
    rules: list[api.SIPDispatchRuleInfo] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)

    async def list_inbound_trunk(
        self, request: api.ListSIPInboundTrunkRequest
    ) -> api.ListSIPInboundTrunkResponse:
        return api.ListSIPInboundTrunkResponse(items=self.trunks)

    async def create_inbound_trunk(
        self, request: api.CreateSIPInboundTrunkRequest
    ) -> api.SIPInboundTrunkInfo:
        self.calls.append("create trunk")
        trunk = api.SIPInboundTrunkInfo()
        trunk.CopyFrom(request.trunk)
        trunk.sip_trunk_id = f"ST_{len(self.trunks)}"
        self.trunks.append(trunk)
        return trunk

    async def update_inbound_trunk(
        self, trunk_id: str, trunk: api.SIPInboundTrunkInfo
    ) -> api.SIPInboundTrunkInfo:
        self.calls.append(f"update trunk {trunk_id}")
        return trunk

    async def list_dispatch_rule(
        self, request: api.ListSIPDispatchRuleRequest
    ) -> api.ListSIPDispatchRuleResponse:
        return api.ListSIPDispatchRuleResponse(items=self.rules)

    async def create_dispatch_rule(
        self, request: api.CreateSIPDispatchRuleRequest
    ) -> api.SIPDispatchRuleInfo:
        self.calls.append("create rule")
        rule = api.SIPDispatchRuleInfo()
        rule.CopyFrom(request.dispatch_rule)
        rule.sip_dispatch_rule_id = f"SDR_{len(self.rules)}"
        self.rules.append(rule)
        return rule

    async def update_dispatch_rule(
        self, rule_id: str, rule: api.SIPDispatchRuleInfo
    ) -> api.SIPDispatchRuleInfo:
        self.calls.append(f"update rule {rule_id}")
        return rule


def test_trunk_accepts_only_the_business_number_from_the_provider() -> None:
    trunk = inbound_trunk(SETTINGS, ["192.0.2.10/32"])
    assert trunk.name == TRUNK_NAME
    assert list(trunk.numbers) == ["+492511234567"]
    assert list(trunk.allowed_addresses) == ["192.0.2.10/32"]
    assert (trunk.auth_username, trunk.auth_password) == ("repocity", "password-1234")
    assert trunk.max_call_duration.seconds == 17 * 60
    assert not trunk.krisp_enabled


def test_rule_puts_every_call_in_its_own_room_with_the_agent() -> None:
    rule = dispatch_rule(SETTINGS, "ST_1")
    assert rule.name == RULE_NAME
    assert list(rule.trunk_ids) == ["ST_1"]
    assert rule.rule.dispatch_rule_individual.room_prefix == "anruf-"
    assert [agent.agent_name for agent in rule.room_config.agents] == ["repocity-telefon"]


def test_provider_host_is_resolved_to_single_addresses() -> None:
    def resolve(host: str) -> list[str]:
        assert host == "sip.provider.example"
        return ["192.0.2.10", "2001:db8::1", "192.0.2.10"]

    assert provider_addresses("sip.provider.example", resolve) == [
        "192.0.2.10/32",
        "2001:db8::1/128",
    ]


def test_unresolvable_provider_host_is_a_configuration_error() -> None:
    def resolve(_host: str) -> list[str]:
        raise OSError("Name or service not known")

    with pytest.raises(ConfigurationError, match="SIP_TRUNK_HOST"):
        provider_addresses("sip.provider.example", resolve)


async def test_first_run_creates_trunk_and_rule() -> None:
    sip = FakeSip()
    trunk_id, rule_id = await ensure_phone_line(sip, SETTINGS, ["192.0.2.10/32"])
    assert (trunk_id, rule_id) == ("ST_0", "SDR_0")
    assert sip.calls == ["create trunk", "create rule"]
    assert list(sip.rules[0].trunk_ids) == ["ST_0"]


async def test_second_run_updates_in_place() -> None:
    sip = FakeSip()
    await ensure_phone_line(sip, SETTINGS, ["192.0.2.10/32"])
    sip.calls.clear()
    assert await ensure_phone_line(sip, SETTINGS, ["192.0.2.11/32"]) == ("ST_0", "SDR_0")
    assert sip.calls == ["update trunk ST_0", "update rule SDR_0"]
