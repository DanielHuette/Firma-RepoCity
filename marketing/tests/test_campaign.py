"""Tests for campaign loading, the figure guard and the push to the cockpit."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pytest

from agentic_marketing.campaign import (
    CampaignSpec,
    CheckedFinding,
    PostSpec,
    load_campaign,
    new_post_file,
    push_campaign,
    unbacked_figures,
)
from agentic_marketing.cockpit import CockpitClient
from agentic_marketing.errors import CampaignError
from agentic_marketing.models import Verdict
from tests.conftest import make_finding, make_verification
from tests.fake_cockpit import FakeCockpit

SPEC = """slug: probe
title: Probekampagne
product: Beispielprodukt
goal: Mehr Anfragen aus der Region
audience: Inhaber kleiner Betriebe
runs: [strategie/run]
kpi: {views: 100, clicks: 10, leads: 2}
"""


def _post(**overrides: Any) -> PostSpec:
    values: dict[str, Any] = {
        "channel": "blog",
        "slug": "kleine-betriebe",
        "title": "Kleine Betriebe entscheiden selbst",
        "findings": ["macro-step/betriebsgroessen"],
        "body": "Von 12.480 Betrieben sind 61,4 Prozent klein. Das hat Folgen im Jahr 2026.",
    }
    values.update(overrides)
    return PostSpec(**values)


def _write_campaign(folder: Path, posts: dict[str, str]) -> None:
    (folder / "beitraege").mkdir(parents=True)
    (folder / "kampagne.yaml").write_text(SPEC, encoding="utf-8")
    for name, text in posts.items():
        (folder / "beitraege" / name).write_text(text, encoding="utf-8")


def test_load_campaign_orders_posts_by_day(tmp_path: Path) -> None:
    body = "Ein Text, der lang genug ist, um als Beitrag zu gelten, ganz ohne Zahlen darin."
    _write_campaign(
        tmp_path,
        {
            "a.md": f"---\nchannel: blog\nslug: spaeter\ntitle: Der spaetere\nday_offset: 7\n"
            f"findings: [x]\n---\n{body}\n",
            "b.md": f"---\nchannel: linkedin\nslug: frueher\ntitle: Der fruehere\n"
            f"findings: [x]\n---\n{body}\n",
        },
    )
    spec, posts = load_campaign(tmp_path)
    assert spec.slug == "probe"
    assert [post.slug for post in posts] == ["frueher", "spaeter"]


REPOSITORY = Path(__file__).resolve().parent.parent
SHIPPED_CAMPAIGNS = sorted(
    folder.parent
    for root in (REPOSITORY / "workspaces", REPOSITORY / "tests" / "fixtures")
    for folder in root.glob("*/kampagnen/*/kampagne.yaml")
)


@pytest.mark.parametrize("folder", SHIPPED_CAMPAIGNS, ids=lambda folder: folder.name)
def test_every_shipped_campaign_loads(folder: Path) -> None:
    spec, posts = load_campaign(folder)
    assert spec.slug
    assert posts


def test_shipped_campaigns_are_found() -> None:
    assert len(SHIPPED_CAMPAIGNS) >= 2


def test_load_campaign_rejects_missing_front_matter(tmp_path: Path) -> None:
    _write_campaign(tmp_path, {"a.md": "kein Kopf\n"})
    with pytest.raises(CampaignError, match="front matter"):
        load_campaign(tmp_path)


def test_load_campaign_rejects_duplicate_slugs(tmp_path: Path) -> None:
    text = (
        "---\nchannel: blog\nslug: gleich\ntitle: Gleicher Titel\nfindings: [x]\n---\n" + "x" * 50
    )
    _write_campaign(tmp_path, {"a.md": text, "b.md": text})
    with pytest.raises(CampaignError, match="share"):
        load_campaign(tmp_path)


def test_guard_accepts_backed_figures_and_years() -> None:
    assert unbacked_figures(_post(), [make_finding()]) == []


def test_guard_accepts_other_spellings_of_a_backed_figure() -> None:
    post = _post(body="Von 12480 Betrieben sind 61.4 Prozent klein, so steht es im Bericht.")
    assert unbacked_figures(post, [make_finding()]) == []


def test_guard_reports_a_number_no_finding_backs() -> None:
    post = _post(body="Von 12.480 Betrieben sind 61,4 Prozent klein, und 73 Prozent wachsen.")
    assert unbacked_figures(post, [make_finding()]) == ["73"]


def test_guard_takes_a_date_figure_out_whole() -> None:
    post = _post(body="Seit dem 1. Januar 2026 gilt die Pflicht, ab dem 3. Mai nicht mehr.")
    assert unbacked_figures(post, [make_finding(figures=["1. Januar 2026"])]) == ["3"]


def test_guard_allows_declared_free_figures() -> None:
    post = _post(
        body="Drei Schritte, Schritt 2 zuerst: 12.480 Betriebe zählen.", free_figures=["2"]
    )
    assert unbacked_figures(post, [make_finding()]) == []


def test_guard_ignores_numbers_inside_link_targets() -> None:
    post = _post(body="Siehe [Bericht](https://example.org/2024/77/bericht) zu 12.480 Betrieben.")
    assert unbacked_figures(post, [make_finding()]) == []


def _checked(keep: bool = True, verdict: Verdict = Verdict.SUPPORTED) -> CheckedFinding:
    finding = make_finding()
    return CheckedFinding(finding, make_verification(finding.id, verdict), keep)


def _spec() -> CampaignSpec:
    return CampaignSpec(
        slug="probe",
        title="Probekampagne",
        product="Produkt",
        goal="Mehr Anfragen aus der Region",
        audience="Inhaber kleiner Betriebe",
        runs=["strategie/run"],
    )


def test_push_writes_campaign_findings_and_posts_for_review() -> None:
    fake = FakeCockpit()
    report = push_campaign(cast(CockpitClient, fake), _spec(), [_post()], [_checked()])
    assert (report.created, report.updated, report.blocked) == (1, 0, ())
    campaign = fake.rows("campaigns")[0]
    assert campaign["status"] == "ready"
    post = fake.rows("posts")[0]
    assert post["status"] == "review"
    assert post["unbacked_figures"] == []
    assert len(fake.rows("post_findings")) == 1
    assert fake.events[-1]["kind"] == "pushed"


def test_push_gives_links_to_own_sites_the_markers_of_channel_campaign_and_post() -> None:
    fake = FakeCockpit()
    post = _post(
        channel="linkedin",
        body="Von 12.480 Betrieben sind 61,4 Prozent klein: https://speedofthespirit.dev/de/.",
    )
    push_campaign(cast(CockpitClient, fake), _spec(), [post], [_checked()])
    assert fake.rows("posts")[0]["body_md"] == (
        "Von 12.480 Betrieben sind 61,4 Prozent klein: https://speedofthespirit.dev/de/"
        "?utm_source=linkedin&utm_medium=social&utm_campaign=probe&utm_content=kleine-betriebe."
    )


def test_push_leaves_links_in_blog_posts_alone() -> None:
    fake = FakeCockpit()
    body = "Von 12.480 Betrieben sind 61,4 Prozent klein: https://speedofthespirit.dev/de/."
    push_campaign(cast(CockpitClient, fake), _spec(), [_post(body=body)], [_checked()])
    assert fake.rows("posts")[0]["body_md"] == body


def test_push_marks_posts_with_unbacked_figures() -> None:
    fake = FakeCockpit()
    post = _post(body="Von 12.480 Betrieben sind 61,4 Prozent klein und 88 Prozent zufrieden.")
    report = push_campaign(cast(CockpitClient, fake), _spec(), [post], [_checked()])
    assert report.blocked == ("kleine-betriebe",)
    assert fake.rows("posts")[0]["unbacked_figures"] == ["88"]


def test_push_leaves_decided_posts_alone() -> None:
    fake = FakeCockpit()
    client = cast(CockpitClient, fake)
    push_campaign(client, _spec(), [_post()], [_checked()])
    fake.rows("posts")[0]["status"] = "approved"
    fake.rows("campaigns")[0]["status"] = "running"
    report = push_campaign(client, _spec(), [_post(title="Ein ganz neuer Titel")], [_checked()])
    assert report.kept_as_is == ("kleine-betriebe",)
    assert fake.rows("posts")[0]["title"] == "Kleine Betriebe entscheiden selbst"
    assert fake.rows("campaigns")[0]["status"] == "running"


@pytest.mark.parametrize(
    ("keep", "verdict"), [(False, Verdict.SUPPORTED), (True, Verdict.UNSUPPORTED)]
)
def test_push_refuses_posts_citing_uncitable_findings(keep: bool, verdict: Verdict) -> None:
    with pytest.raises(CampaignError, match="dropped or is not backed"):
        push_campaign(
            cast(CockpitClient, FakeCockpit()), _spec(), [_post()], [_checked(keep, verdict)]
        )


def test_push_refuses_unknown_findings() -> None:
    with pytest.raises(CampaignError, match="no run"):
        push_campaign(
            cast(CockpitClient, FakeCockpit()), _spec(), [_post(findings=["x/y"])], [_checked()]
        )


def test_new_post_file_writes_a_skeleton(tmp_path: Path) -> None:
    path = new_post_file(tmp_path, "linkedin", "Wer sucht, findet uns?", ["a/b"])
    assert path.name == "linkedin-wer-sucht-findet-uns.md"
    assert path.read_text(encoding="utf-8").startswith("---\nchannel: linkedin\n")
