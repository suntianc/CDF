# Conversation Timeline Projection is pure

We will extract Conversation Timeline Projection as a pure module that turns Conversation messages, streaming state, and pending approvals into timeline items. The projection owns ordering rules such as tool grouping, turn splitting, think folding, folded duration calculation, streaming no-fold behavior, and pending approval item insertion, but it does not render React components, read stores, handle scrolling, open task panels, or execute approval actions.

This keeps process-shaping rules testable at the timeline boundary instead of spreading them across `ChatArea`, `MessageItem`, `ToolGroupCard`, and approval UI. We choose this over component-local interpretation because these rules reorder and split multiple Conversation events, so they are timeline semantics rather than isolated card rendering details.
