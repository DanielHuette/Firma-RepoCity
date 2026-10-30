"""Integration tests of the shared database of RadarAuditor, CRM and Cockpit.

Context: The three apps share one Supabase project and call each other's functions and triggers. |
Input: their migrations. | Output: a real PostgreSQL built like the live project, and test helpers.
"""
