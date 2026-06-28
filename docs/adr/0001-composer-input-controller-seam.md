# Composer Input controller seam

We will deepen Composer Input through a `useComposerInputController` React adapter seam before extracting any shared JSX surface. The controller owns input side effects such as React state coordination, popup state, IME timers, Path Mention candidate loading, Composer Attachment paste handling, and validation notifications, but it does not own final Conversation or command side effects such as sending messages, creating sessions, or dispatching commands.

This keeps `ChatArea` responsible for session and command business flow while removing Composer Input orchestration from it. We are deliberately not extracting a `<ComposerInputSurface />` yet: the next step is to make the hook/controller the test surface and keep JSX/layout changes out of the same move. `useAtMentionStore` remains as an internal adapter for now rather than an external seam that `ChatArea` coordinates directly.
