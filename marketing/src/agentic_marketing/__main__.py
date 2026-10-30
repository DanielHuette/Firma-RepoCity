"""Entry point for `python -m agentic_marketing`.

Context: Thin wrapper so the package runs without the installed script. | Input: argv. |
Output: process exit code.
"""

from agentic_marketing.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
