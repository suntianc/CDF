# Composer Submission controller uses explicit dependencies

The Composer Submission controller will receive session, command, model override, and messaging capabilities as explicit dependencies instead of importing Zustand stores or command dispatchers internally. This keeps the controller responsible for final side-effect orchestration while preserving a testable boundary and preventing it from becoming a second `ChatArea` with hidden global dependencies.
