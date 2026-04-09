---
name: "codex-feishu-bridge-windows"
description: "Use when the user wants to install, deploy, operate, troubleshoot, or package a Windows desktop Feishu-to-Codex bridge that routes Feishu bot messages into local Codex threads, supports thread binding and resume, and mirrors chat history locally."
---

# Codex Feishu Bridge For Windows

This skill packages and operates a Windows desktop Feishu-to-Codex bridge built around:

- `@larksuite/cli` for Feishu auth, event subscription, and message send/reply
- local `codex` CLI for thread execution and resume
- a local Node bridge process for chat binding, thread state, and mirrored history

## Use this skill when

- the user wants to connect Feishu Bot to local Codex on Windows
- the user wants deployment instructions for another Windows machine
- the user wants a reusable Windows Codex skill/bundle for the bridge
- the user wants usage guidance for Feishu commands, mirrored history, or local mirror viewing
- the user wants to troubleshoot `lark-cli`, PowerShell scripts, mirror files, or thread binding

## Workflow

1. Read [deployment.md](./references/deployment.md) for Windows machine setup, prerequisites, and the recommended deployment path.
2. Read [user-guide.md](./references/user-guide.md) for operator-facing commands and normal usage flows.
3. Read [architecture.md](./references/architecture.md) if you need the bridge internals, file layout, or limits.
4. Use the bundled installer in [install_bridge_template.ps1](./scripts/install_bridge_template.ps1) when deploying the template to another machine.
5. Use the bundled template under `assets/template/` as the source of truth for deployed bridge files.

## Deployment rules

- Default install target: `%USERPROFILE%\.codex-feishu-bridge`
- Prefer user-scoped PowerShell scripts and PID-file process management
- Do not claim the deployed bridge is read-only unless a real permission or sandbox failure occurred
- Preserve user secrets locally; never store `App Secret` in shared docs or logs
- Keep Feishu usage to private bot chats unless the user explicitly wants group routing

## Template structure

- `assets/template/src/bridge.js`
- `assets/template/scripts/*.ps1`
- `assets/template/scripts/*.cmd`
- `assets/template/package.json`

The installer rewrites `__INSTALL_DIR__` placeholders during deployment.
