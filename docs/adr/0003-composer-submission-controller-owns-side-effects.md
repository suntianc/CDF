# Composer Submission controller owns final side effects

We will extract Composer Submission into a controller that directly performs final Conversation and Command Entry side effects, including creating Welcome Conversations, selecting/fetching sessions, sending messages, dispatching commands, and carrying model overrides forward. This is preferred over returning a submission plan to `ChatArea` because leaving final execution in `ChatArea` would preserve the same Welcome/Session/Command branching that the extraction is meant to deepen.
