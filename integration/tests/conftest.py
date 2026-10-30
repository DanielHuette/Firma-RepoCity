"""Shared fixtures: one cluster per run, the project built once, a fresh copy for every test.

Context: Building the project takes seconds, copying a template database milliseconds. Skipped when
no PostgreSQL binaries are found (set REPOCITY_PG_BIN to their directory) or when run as root. |
Input: the migrations of this repository. | Output: the fixtures cluster, template and db.
"""

from collections.abc import Iterator
from uuid import uuid4

import psycopg
import pytest

from repocity_integration.cluster import (
    BIN_DIR_VARIABLE,
    PostgresCluster,
    find_bin_dir,
    runs_as_root,
)
from repocity_integration.database import Database
from repocity_integration.project import build_project

BIN_DIR = find_bin_dir()
TEMPLATE = "project_template"


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    if BIN_DIR is None:
        reason = f"No PostgreSQL binaries; set {BIN_DIR_VARIABLE} to their directory"
    elif runs_as_root():
        reason = "PostgreSQL refuses to run as root"
    else:
        return
    for item in items:
        item.add_marker(pytest.mark.skip(reason=reason))


@pytest.fixture(scope="session")
def cluster(tmp_path_factory: pytest.TempPathFactory) -> Iterator[PostgresCluster]:
    assert BIN_DIR is not None
    with PostgresCluster(BIN_DIR, tmp_path_factory.mktemp("postgres")) as running:
        yield running


def _admin_command(cluster: PostgresCluster, statement: str) -> None:
    with psycopg.connect(cluster.conninfo("postgres"), autocommit=True) as connection:
        connection.execute(statement.encode())


@pytest.fixture(scope="session")
def template(cluster: PostgresCluster) -> str:
    _admin_command(cluster, f'create database "{TEMPLATE}"')
    build_project(cluster.conninfo(TEMPLATE))
    return TEMPLATE


@pytest.fixture
def db(cluster: PostgresCluster, template: str) -> Iterator[Database]:
    """A fresh copy of the whole project."""
    name = f"test_{uuid4().hex}"
    _admin_command(cluster, f'create database "{name}" template "{template}"')
    try:
        with Database(cluster.conninfo(name)) as database:
            yield database
    finally:
        _admin_command(cluster, f'drop database if exists "{name}" with (force)')
