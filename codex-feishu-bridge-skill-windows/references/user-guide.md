# User Guide

## Mental model

- One Feishu private chat maps to one current Codex thread binding.
- Plain text continues the currently bound thread.
- `/new` creates and binds a new thread.
- `/resume` switches the binding to another thread.

## Core commands

- `/status`
  Show the currently bound thread and whether that thread is busy.

- `/threads`
  List recent local Codex threads with index, name, and `threadId`.

- `/resume 3`
  Bind the chat to the third thread from the most recent `/threads` output.

- `/resume <threadId>`
  Bind the chat to an explicit thread id.

- `/new <prompt>`
  Create and bind a new Codex thread.

- `/history`
  Show the recent mirrored Feishu-side history.

- `/history 60`
  Show the last 60 mirrored items for this chat.

- `/mirror`
  Show the local mirror file paths for the current chat.

- `/chatid`
  Show the current Feishu chat id and current push target.

- `/setnotifyhere`
  Set the current Feishu chat as the publish-success push target.

- `/unbind`
  Remove the current thread binding from the chat.

## Recommended usage patterns

### Start a new task

```text
/new 帮我规划这个项目的下一步改造
```

### Continue an old task

```text
/threads
/resume 2
继续刚才的任务
```

### Check whether a thread is busy

```text
/status
```

If `Thread busy: yes` is returned, wait for the current run to finish before sending another instruction.

### Review the mirrored history

```text
/history 60
```

### Open the local mirror on the machine

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File <install-dir>\scripts\mirror-view.ps1 latest 60
```

Double-click:

```text
<install-dir>\scripts\mirror-view.cmd
```

## Important limitations

- The Codex thread context is shared across Feishu and local resume calls.
- The Codex Desktop UI does not automatically render Feishu chat messages as native thread bubbles.
- The mirror files and `/history` provide the view layer for Feishu-side chat records.
- Avoid sending concurrent instructions into the same bound thread from multiple places.

## Publish-completion push behavior

- The bridge can monitor a dedicated publishing thread such as `自动发布内容- skill`.
- It only sends an automatic Feishu completion push when the latest result text contains a publish-success signal.
- Default success signals include phrases such as `发布成功`、`已发布`、`完成发布`、`发布完成`.
- This avoids noisy pushes for ordinary planning, review, or non-publishing steps inside the same thread.
- The push target chat should be re-confirmed on each fresh installation.
- The fastest way is to open the desired Feishu chat and send `/setnotifyhere`.
