# Conversation Workspace Shell uses a read model hook

`ChatArea` will be treated as the `Conversation Workspace Shell`: the page-level composition boundary that wires Project, Conversation, Composer, model, command, runtime, and viewport dependencies into the Conversation surfaces.

The shell will use a `useConversationWorkspaceModel` hook for read-only selection and pure derivation, including the active Conversation, active/default Agent, master provider, current Project labels, detail-view targets, timeline items, Composer mode, and whether the Conversation has an active goal. The hook must not write Zustand state, perform IPC, run lifecycle effects, or return complete surface props. Controllers, bootstrap effects, transient disclosure state, and final surface prop assembly stay in the shell or in their own narrower hooks.

We choose this over keeping all derived state inside `ChatArea` because the shell currently mixes page assembly with repeated store selection and cross-surface derivation. We choose it over a full `ConversationWorkspaceController` because that would recreate the large-file problem under a new name by absorbing Composer submission, model selection, command registry, todos disclosure, and bootstrap side effects. A read model hook gives the shell a stable, testable input model while preserving explicit page-level composition.
