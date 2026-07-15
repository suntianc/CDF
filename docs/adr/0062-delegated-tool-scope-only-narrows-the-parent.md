# Delegated tool scope only narrows the parent

## Status

Accepted

A Delegated Agent Run starts from the parent Agent Run's complete available tool scope. A target Agent with no explicit selection inherits that scope unchanged; a target Agent with a selection receives only the intersection of the parent scope and its selection. Built-in tools are selected individually, while MCP capabilities are selected by server because individual MCP tool inventories are connection-dependent and unstable. A child can never introduce a capability unavailable to its parent. This deliberately keeps CDF simpler than Claude Code's optional subagent-specific MCP additions while preserving the existing global-visibility and exclusion rules as inputs to the parent's scope.
