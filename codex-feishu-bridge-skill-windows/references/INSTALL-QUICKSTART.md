# INSTALL QUICKSTART

Use this file when another Codex instance is asked to install the bridge on a fresh Windows machine.

## Goal

Install the `codex-feishu-bridge-windows` skill and deploy the runnable Feishu bridge process on the current machine.

## Assumptions

- Codex Desktop is already installed on Windows.
- `codex` CLI is already logged in or available on `PATH`.
- The operator can provide Feishu `App ID` and `App Secret`.
- PowerShell is available.

## Minimal execution path

1. Place the skill directory at:

```text
%USERPROFILE%\.codex\skills\codex-feishu-bridge-windows
```

2. Deploy the runnable bridge template:

```powershell
powershell -ExecutionPolicy Bypass -File "$HOME/.codex/skills/codex-feishu-bridge-windows/scripts/install_bridge_template.ps1" "$HOME/.codex-feishu-bridge"
```

3. Install dependencies:

```powershell
cd "$HOME/.codex-feishu-bridge"
npm install
```

4. Ask the operator for Feishu `App ID` and `App Secret`, then configure `lark-cli`:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js config init --app-id <APP_ID> --app-secret-stdin --brand feishu
```

5. Run Feishu login:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js auth login --domain im,event --recommend
```

6. Verify auth:

```powershell
node .\node_modules\@larksuite\cli\scripts\run.js auth status
```

7. Re-confirm the publish push target:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_notify_target.ps1 <CHAT_ID>
```

Or set it later from Feishu with:

```text
/setnotifyhere
```

8. Start the bridge:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bridge-start.ps1
```

9. Verify:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bridge-status.ps1
```

## Smoke test

In Feishu:

```text
/status
/threads
```

Then send one normal text message and confirm:

- the bot replies
- `.codex-feishu-bridge\mirrors\` contains mirror files

## Operator-facing note

If any step would restart Codex or disrupt the bridge workflow, stop and ask for explicit confirmation first.
