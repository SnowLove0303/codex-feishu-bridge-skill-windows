# Architecture

## Data flow

```text
Feishu Bot
  -> lark-cli event subscription
  -> bridge.js
  -> codex exec / codex exec resume
  -> lark-cli message reply
```

## Runtime state

- `state.json`
  Stores chat bindings, active thread markers, thread lists, and recent mirrored history.

- `mirrors/*.md`
  Human-readable mirrored chat history per Feishu conversation.

- `mirrors/*.jsonl`
  Structured mirrored chat history per Feishu conversation.

## Busy-thread protection

When the bridge is actively running a task against a bound thread, the bridge marks that thread as busy in `state.json`. Subsequent inbound messages for the same thread are rejected with a wait message instead of being executed concurrently.

## Mirror viewer

The mirror viewer is intentionally separate from the Codex App UI:

- lower risk than mutating Codex session files
- stable on machines where Codex internals change
- sufficient for operators who need a local read view of Feishu-side conversations

## Operational limits

- Best for private Feishu chats
- Not designed as a real-time dual-UI sync client
- Thread context is shared, but message presentation is not automatically mirrored inside the Codex App UI
