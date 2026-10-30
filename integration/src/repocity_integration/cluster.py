"""Throwaway PostgreSQL cluster started from local binaries.

Context: The integration tests run against a real PostgreSQL; nothing reaches the Supabase project.
| Input: A directory with initdb and pg_ctl. | Output: PostgresCluster, a running server on a free
local port that is stopped and removed with its temporary directory.
"""

import os
import shutil
import socket
import subprocess
from pathlib import Path
from types import TracebackType
from typing import Self

BIN_DIR_VARIABLE = "REPOCITY_PG_BIN"
SUPERUSER = "postgres"
_DEBIAN_ROOT = Path("/usr/lib/postgresql")
_TIMEOUT_SECONDS = 120


class ClusterError(Exception):
    """A PostgreSQL program failed; the message holds its error output."""


def _has_tools(directory: Path) -> bool:
    return all(shutil.which(tool, path=str(directory)) for tool in ("initdb", "pg_ctl"))


def _debian_bin_dirs() -> list[Path]:
    if not _DEBIAN_ROOT.is_dir():
        return []
    versions = [path for path in _DEBIAN_ROOT.iterdir() if path.name.isdigit()]
    return [path / "bin" for path in sorted(versions, key=lambda p: int(p.name), reverse=True)]


def find_bin_dir() -> Path | None:
    """Locate PostgreSQL binaries.

    Looks at the directory in REPOCITY_PG_BIN, then PATH, then the Debian layout of GitHub runners.

    Returns:
        Directory holding initdb and pg_ctl, or None when there is none.
    """
    configured = os.environ.get(BIN_DIR_VARIABLE)
    on_path = shutil.which("pg_ctl")
    candidates = [
        Path(configured) if configured else None,
        Path(on_path).parent if on_path else None,
        *_debian_bin_dirs(),
    ]
    return next((path for path in candidates if path is not None and _has_tools(path)), None)


def runs_as_root() -> bool:
    """Tell whether this process is root, which PostgreSQL refuses to run as."""
    return hasattr(os, "geteuid") and os.geteuid() == 0


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


class PostgresCluster:
    """A PostgreSQL cluster in a temporary directory, listening on 127.0.0.1."""

    def __init__(self, bin_dir: Path, root: Path) -> None:
        """Prepare a cluster; nothing starts before start() or entering the context.

        Args:
            bin_dir: Directory holding initdb and pg_ctl.
            root: Empty directory for data and log.
        """
        self._bin_dir = bin_dir
        self._data_dir = root / "data"
        self._log = root / "postgres.log"
        self.port = _free_port()

    def conninfo(self, database: str) -> str:
        """Connection string for a database of this cluster, as the superuser."""
        return f"host=127.0.0.1 port={self.port} user={SUPERUSER} dbname={database}"

    def _run(self, program: str, *arguments: str) -> None:
        path = shutil.which(program, path=str(self._bin_dir))
        if path is None:
            raise ClusterError(f"{program} not found in {self._bin_dir}")
        completed = subprocess.run(
            [path, *arguments],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
        if completed.returncode != 0:
            raise ClusterError(f"{program} failed: {completed.stderr.strip()}")

    def start(self) -> None:
        """Create the data directory and start the server."""
        self._run(
            "initdb",
            *("-D", str(self._data_dir), "-U", SUPERUSER, "-A", "trust", "-E", "UTF8"),
            *("--no-locale", "--no-sync"),
        )
        options = (
            f"-p {self.port} -c listen_addresses=127.0.0.1 "
            "-c unix_socket_directories='' -c fsync=off -c timezone=UTC"
        )
        self._run(
            "pg_ctl", "-D", str(self._data_dir), "-l", str(self._log), "-o", options, "-w", "start"
        )

    def stop(self) -> None:
        """Stop the server without waiting for clients."""
        self._run("pg_ctl", "-D", str(self._data_dir), "-m", "immediate", "stop")

    def __enter__(self) -> Self:
        """Start the cluster."""
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Stop the cluster."""
        self.stop()
