# Delegated permissions use Claude-style sticky parent modes

## Status

Superseded by ADR-0063

CDF retains its three Conversation Approval Modes and follows the corresponding Claude Code parent/child precedence: strict behaves like the overridable default mode, Agent-decides behaves like sticky auto mode, and bypass behaves like sticky bypassPermissions. A user-configured Agent Approval Override may replace strict—even with a more permissive mode—but Agent-decides and bypass always propagate unchanged to every Delegated Agent Run. We chose behavioral familiarity with Claude Code over a monotonic permission ceiling; overrides are user-authored configuration, never an Agent-controlled elevation.

## Consequences

Agent-decides must become a real risk-based policy rather than remaining behaviorally identical to strict; that classifier/policy work is intentionally separate from the delegated approval routing tracked by #139. #139 routes the existing central tool-approval policy unchanged to every Delegated Agent Run rather than redefining which tools are risky. The UI must make the effective delegated mode visible, especially when an Agent Approval Override changes a strict Conversation to bypass, and tests must cover the asymmetric precedence matrix.
