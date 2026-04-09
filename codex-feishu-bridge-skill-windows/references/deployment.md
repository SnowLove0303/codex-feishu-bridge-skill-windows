# Deployment Guide

## Scope

This guide deploys the Feishu-to-Codex bridge onto a target Windows machine as a user-scoped background process.

## Prerequisites

- Windows user account
- Codex Desktop installed and `codex` CLI already logged in
- Node.js available on `PATH`
- A Feishu self-built app with bot capability enabled
- Feishu bot event subscription configured for `im.message.receive_v1`
- Feishu `App ID` and `App Secret`

## Recommended install path

```text
%USERPROFILE%\.codex-feishu-bridge
```

This keeps the bridge isolated from user workspaces and avoids path issues from folders containing spaces.

## Deployment steps

1. Copy the skill directory to the target machine.
2. Run the installer:

```powershell
powershell -ExecutionPolicy Bypass -File <skill-dir>\scripts\install_bridge_template.ps1 "$HOME\.codex-feishu-bridge"
```

3. Change into the deployed directory:

```powershell
cd "$HOME\.codex-feishu-bridge"
```

4. Install dependencies:

```powershell
npm install
```

5. Configure Feishu CLI app credentials:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js config init --app-id <APP_ID> --app-secret-stdin --brand feishu
```

Pipe the `App Secret` through stdin instead of placing it on the command line.

6. Authenticate Feishu CLI:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js auth login --domain im,event --recommend
```

7. Verify auth:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js auth status
```

8. Confirm the push target chat for publish-success notifications:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_notify_target.ps1 <CHAT_ID>
```

Or, once the bot is reachable in the desired Feishu chat, send:

```text
/setnotifyhere
```

9. Start the bridge process:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bridge-start.ps1
```

10. Verify process state:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bridge-status.ps1
```

## Background process behavior

- Start script: `scripts\bridge-start.ps1`
- Stop script: `scripts\bridge-stop.ps1`
- Status script: `scripts\bridge-status.ps1`
- PID file: `.run\bridge.pid`

## Files created at runtime

- `.codex-feishu-bridge\state.json`
- `.codex-feishu-bridge\mirrors\*.md`
- `.codex-feishu-bridge\mirrors\*.jsonl`
- `bridge.log`
- `bridge.stdout.log`
- `bridge.stderr.log`

## Optional publish-monitor tuning

The bridge can watch one or more local Codex threads and auto-push a completion summary to Feishu when a publish run finishes successfully.

Useful environment variables:

- `CODEX_BRIDGE_PUBLISH_NOTIFY_CHAT_ID`
  Target Feishu chat id for completion pushes. Re-confirm this on each new installation.
- `CODEX_BRIDGE_MONITOR_THREAD_NAMES`
  Comma-separated thread-name patterns to monitor.
- `CODEX_BRIDGE_PUBLISH_SUCCESS_KEYWORDS`
  Comma-separated success phrases. Auto-push only happens when the latest result text contains one of them.

Default success phrases include:

```text
发布成功,已发布,完成发布,发布完成
```

## Post-install smoke test

1. Send a bot message to a known Feishu private chat:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js im +messages-send --as bot --chat-id <CHAT_ID> --text "bridge online"
```

2. In Feishu, run:

```text
/status
/threads
```

3. Confirm a mirror file is created after the first inbound message.

## Restart-sensitive step

If the operator needs to restart Codex or do any action that disrupts the current bridge workflow, pause and get explicit confirmation first.
