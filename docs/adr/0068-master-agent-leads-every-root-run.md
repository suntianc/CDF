# Master Agent leads every root run

Every Project owns one persistent, protected Master Agent that leads all Conversation and Workflow Runs; user-created Agents are configurable delegation targets, and the protected General-purpose Agent remains the fallback subagent. Root execution resolves the reserved Master identity directly rather than selecting an `is_default` Agent or a Workflow-specific master, keeping one orchestration model across ordinary and Workflow Conversations while allowing only the complete Master prompt to be edited or reset in Agent management.
