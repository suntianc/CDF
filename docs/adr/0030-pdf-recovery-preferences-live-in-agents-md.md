# PDF recovery preferences live in AGENTS.md

Issue #61 will remember the Project's PDF Recovery Preference in `AGENTS.md` as Agent-facing guidance rather than adding a dedicated database table, application setting, or first-class UI for the first recovery slice. This matches the preference's purpose: future Agents need to know how the user wants PDF recovery routed in this Project.

The stored preference should be concise and machine-detectable, in a CDF-managed block that Agents can update without rewriting unrelated project instructions. The block should use explicit markers:

```md
<!-- CDF:pdf-recovery:start -->
PDF recovery preference:
- route: vision-capability
- askAgainWhen: new-cost-or-privacy-risk
<!-- CDF:pdf-recovery:end -->
```

It should record the selected PDF Recovery Route or capability category, not a concrete provider id, model id, MCP server id, or CLI path. Users can change or clear the preference through conversation by asking the Agent to update the Project's PDF recovery preference.
