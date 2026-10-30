"""Exception hierarchy of the package.

Context: Every failure this package raises inherits from AgenticMarketingError, so a
caller can catch the whole package without catching unrelated errors. | Input: none. |
Output: exception classes.
"""

from __future__ import annotations


class AgenticMarketingError(Exception):
    """Base class for every error this package raises."""


class WorkspaceError(AgenticMarketingError):
    """The workspace is missing, incomplete or not laid out as expected."""


class RunError(AgenticMarketingError):
    """A research run folder cannot be read or does not hold the expected files."""


class SourceError(AgenticMarketingError):
    """A source cannot be fetched or its content cannot be extracted."""


class DecisionError(AgenticMarketingError):
    """A decision file is missing, malformed or does not match the run it belongs to."""


class BudgetExceededError(AgenticMarketingError):
    """A context pack is larger than the configured budget."""


class JudgeError(AgenticMarketingError):
    """The second verification pass cannot run or returned nothing usable."""


class CampaignError(AgenticMarketingError):
    """A campaign folder or post file is missing, malformed or inconsistent."""


class CockpitError(AgenticMarketingError):
    """The cockpit database refused a request or is not configured."""
