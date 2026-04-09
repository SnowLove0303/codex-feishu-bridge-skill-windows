const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, ".codex-feishu-bridge");
const MIRROR_DIR = path.join(DATA_DIR, "mirrors");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const LOG_PATH = path.join(ROOT_DIR, "bridge.log");
const LARK_BIN_NAME = process.platform === "win32" ? "lark-cli.exe" : "lark-cli";
const ENV_PATH = path.join(ROOT_DIR, ".bridge.env");
const LARK_CLI =
  process.env.LARK_CLI_BIN ||
  path.join(ROOT_DIR, "node_modules", "@larksuite", "cli", "bin", LARK_BIN_NAME);
const CODEX_BIN =
  process.env.CODEX_BIN ||
  (process.platform === "win32" ? "codex" : "/Applications/Codex.app/Contents/Resources/codex");
const WORKDIR = process.env.CODEX_WORKDIR || ROOT_DIR;
const SESSION_INDEX =
  process.env.CODEX_SESSION_INDEX || path.join(os.homedir(), ".codex", "session_index.jsonl");
const MAX_THREADS = Number(process.env.CODEX_BRIDGE_MAX_THREADS || "8");
const AUTO_BIND_ON_FIRST_TEXT = process.env.CODEX_BRIDGE_AUTO_BIND_ON_FIRST_TEXT !== "false";
const BYPASS_APPROVALS = process.env.CODEX_BRIDGE_BYPASS_APPROVALS !== "false";
const MAX_HISTORY_ITEMS = Number(process.env.CODEX_BRIDGE_MAX_HISTORY_ITEMS || "120");
const HISTORY_VIEW_ITEMS = Number(process.env.CODEX_BRIDGE_HISTORY_VIEW_ITEMS || "12");
const HISTORY_VIEW_MAX = Number(process.env.CODEX_BRIDGE_HISTORY_VIEW_MAX || "60");
let publishNotifyChatId = process.env.CODEX_BRIDGE_PUBLISH_NOTIFY_CHAT_ID || "";
const PUBLISH_NOTIFY_KEYWORDS = String(
  process.env.CODEX_BRIDGE_PUBLISH_NOTIFY_KEYWORDS ||
    "自动发布内容,发布,微博,微信视频号,视频号,头条,今日头条,百家号,抖音,小红书,快手,知乎,weibo,wechat channels,douyin,xiaohongshu,kuaishou,zhihu,publish"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const MONITOR_THREAD_NAMES = String(
  process.env.CODEX_BRIDGE_MONITOR_THREAD_NAMES || "自动发布内容- skill"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const PUBLISH_SUCCESS_KEYWORDS = String(
  process.env.CODEX_BRIDGE_PUBLISH_SUCCESS_KEYWORDS ||
    "发布成功,已发布,完成发布,发布已完成,发布完成,推送成功,发送成功,发布出去,已发送,已推送,published successfully,successfully published"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const MONITOR_POLL_MS = Math.max(5000, Number(process.env.CODEX_BRIDGE_MONITOR_POLL_MS || "15000"));
const SESSION_ROOT =
  process.env.CODEX_SESSION_ROOT || path.join(os.homedir(), ".codex", "sessions");
const BRIDGE_EXECUTION_CONTEXT = [
  "Bridge execution context:",
  `- You are running through a Feishu bridge on the user's local machine.`,
  `- Working directory: ${WORKDIR}`,
  "- You may inspect and modify local files in the workspace when the task requires it.",
  "- Do not claim the environment is read-only unless a command actually fails because of permissions or sandboxing.",
  "- If a step would restart Codex or otherwise disrupt the current workflow, pause and ask for explicit confirmation first.",
  "",
].join("\n");

let state = {
  conversations: {},
  activeThreads: {},
  monitor: {
    lastNotifiedByThread: {},
  },
};

const inFlight = new Set();

function appendLog(line) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${stamp}] ${line}\n`);
}

async function upsertEnvVar(key, value) {
  let lines = [];
  try {
    lines = (await fsp.readFile(ENV_PATH, "utf8")).split("\n");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const quoted = JSON.stringify(String(value ?? ""));
  const nextLine = `${key}=${quoted}`;
  let found = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return nextLine;
    }
    return line;
  });
  if (!found) {
    nextLines.push(nextLine);
  }
  const cleaned = nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line === ""));
  await fsp.writeFile(ENV_PATH, `${cleaned.join("\n")}\n`, "utf8");
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(MIRROR_DIR, { recursive: true });
}

async function loadState() {
  ensureDataDir();
  try {
    const raw = await fsp.readFile(STATE_PATH, "utf8");
    state = JSON.parse(raw);
    state.conversations ||= {};
    state.activeThreads ||= {};
    state.monitor ||= {};
    state.monitor.lastNotifiedByThread ||= {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await saveState();
  }
}

async function saveState() {
  ensureDataDir();
  await fsp.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getMonitorState() {
  state.monitor ||= {};
  state.monitor.lastNotifiedByThread ||= {};
  return state.monitor;
}

function getConversationKey(event) {
  return `${event.chatId || "unknown-chat"}:${event.senderOpenId || "unknown-user"}`;
}

function getBinding(event) {
  return state.conversations[getConversationKey(event)] || null;
}

function findConversationByChatId(chatId) {
  if (!chatId) {
    return null;
  }
  for (const [key, value] of Object.entries(state.conversations || {})) {
    if (value?.chatId === chatId) {
      return { key, binding: value };
    }
  }
  return null;
}

async function setBinding(event, patch) {
  const key = getConversationKey(event);
  state.conversations[key] = {
    ...(state.conversations[key] || {}),
    chatId: event.chatId,
    senderOpenId: event.senderOpenId,
    senderName: event.senderName,
    lastMessageId: event.messageId,
    updatedAt: new Date().toISOString(),
    ...patch,
  };
  await saveState();
  return state.conversations[key];
}

async function clearBinding(event) {
  const key = getConversationKey(event);
  delete state.conversations[key];
  await saveState();
}

async function markThreadActive(event, threadId, promptPreview) {
  if (!threadId) {
    return;
  }
  state.activeThreads[threadId] = {
    threadId,
    conversationKey: getConversationKey(event),
    chatId: event.chatId,
    senderOpenId: event.senderOpenId,
    startedAt: new Date().toISOString(),
    promptPreview: truncateInline(promptPreview, 120),
  };
  await saveState();
}

async function clearThreadActive(threadId) {
  if (!threadId) {
    return;
  }
  if (state.activeThreads[threadId]) {
    delete state.activeThreads[threadId];
    await saveState();
  }
}

function getActiveThread(threadId) {
  if (!threadId) {
    return null;
  }
  return state.activeThreads[threadId] || null;
}

async function appendHistory(event, entry) {
  const key = getConversationKey(event);
  const current = state.conversations[key] || {
    chatId: event.chatId,
    senderOpenId: event.senderOpenId,
    senderName: event.senderName,
  };
  const history = Array.isArray(current.history) ? current.history : [];
  history.push({
    at: new Date().toISOString(),
    ...entry,
  });
  current.history = history.slice(-MAX_HISTORY_ITEMS);
  current.chatId = event.chatId;
  current.senderOpenId = event.senderOpenId;
  current.senderName = event.senderName;
  current.lastMessageId = event.messageId || current.lastMessageId || "";
  current.updatedAt = new Date().toISOString();
  current.mirror = getMirrorPaths(event);
  state.conversations[key] = current;
  await saveState();
  await appendMirrorFiles(event, {
    at: history[history.length - 1].at,
    role: entry.role,
    text: entry.text,
    source: entry.source || "bridge",
    threadId: current.threadId || "",
  });
}

function safeFilePart(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function getMirrorBaseName(event) {
  return `${safeFilePart(event.chatId)}__${safeFilePart(event.senderOpenId)}`;
}

function getMirrorPaths(event) {
  const base = path.join(MIRROR_DIR, getMirrorBaseName(event));
  return {
    markdown: `${base}.md`,
    jsonl: `${base}.jsonl`,
  };
}

async function appendMirrorFiles(event, entry) {
  ensureDataDir();
  const { markdown, jsonl } = getMirrorPaths(event);
  const role =
    entry.role === "user"
      ? "User"
      : entry.role === "assistant"
        ? "Assistant"
        : "System";
  const heading = `## ${role} · ${formatUpdatedAt(entry.at)}\n`;
  const meta = [
    `- source: ${entry.source || "bridge"}`,
    entry.threadId ? `- threadId: ${entry.threadId}` : null,
    event.chatId ? `- chatId: ${event.chatId}` : null,
    event.senderOpenId ? `- senderOpenId: ${event.senderOpenId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const body = `${heading}${meta}\n\n${String(entry.text || "").trim()}\n\n`;
  const jsonLine = JSON.stringify({
    at: entry.at,
    role: entry.role,
    source: entry.source || "bridge",
    threadId: entry.threadId || "",
    chatId: event.chatId || "",
    senderOpenId: event.senderOpenId || "",
    text: String(entry.text || ""),
  });
  await fsp.appendFile(markdown, body, "utf8");
  await fsp.appendFile(jsonl, `${jsonLine}\n`, "utf8");
}

function formatUpdatedAt(value) {
  if (!value) {
    return "unknown time";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function readRecentThreads() {
  const raw = await fsp.readFile(SESSION_INDEX, "utf8");
  const seen = new Map();
  const lines = raw.trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    seen.set(item.id, item);
    if (seen.size >= MAX_THREADS) {
      break;
    }
  }
  return Array.from(seen.values()).map((thread, index) => ({
    index: index + 1,
    id: thread.id,
    name: thread.thread_name || "(untitled)",
    updatedAt: thread.updated_at || "",
  }));
}

async function readThreadName(threadId) {
  if (!threadId) {
    return "";
  }
  const raw = await fsp.readFile(SESSION_INDEX, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (item.id === threadId) {
      return item.thread_name || "";
    }
  }
  return "";
}

async function readIndexedThreads() {
  const raw = await fsp.readFile(SESSION_INDEX, "utf8");
  const latestById = new Map();
  const lines = raw.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!item.id) {
      continue;
    }
    latestById.set(item.id, item);
  }
  return Array.from(latestById.values()).map((item) => ({
    id: item.id,
    name: item.thread_name || "",
    updatedAt: item.updated_at || "",
  }));
}

function matchesMonitorThreadName(name) {
  const normalized = String(name || "").toLowerCase();
  return MONITOR_THREAD_NAMES.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

async function listMonitoredThreads() {
  if (MONITOR_THREAD_NAMES.length === 0) {
    return [];
  }
  const threads = await readIndexedThreads();
  return threads.filter((thread) => matchesMonitorThreadName(thread.name));
}

async function findSessionFilesForThread(threadId) {
  const matches = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
        matches.push(fullPath);
      }
    }
  }
  await walk(SESSION_ROOT);
  return matches.sort();
}

async function readLatestTaskCompleteForThread(threadId) {
  const files = await findSessionFilesForThread(threadId);
  if (files.length === 0) {
    return null;
  }
  const filePath = files[files.length - 1];
  const raw = await fsp.readFile(filePath, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = item?.payload || {};
    if (item?.type === "event_msg" && payload?.type === "task_complete") {
      return {
        filePath,
        threadId,
        turnId: payload.turn_id || "",
        text: payload.last_agent_message || "",
        timestamp: item.timestamp || "",
      };
    }
  }
  return null;
}

async function rememberRecentThreads(event, threads) {
  await setBinding(event, {
    recentThreads: threads.map((thread) => ({
      index: thread.index,
      id: thread.id,
      name: thread.name,
      updatedAt: thread.updatedAt,
    })),
  });
}

function resolveResumeTarget(event, arg) {
  const value = arg.trim();
  if (!/^\d+$/.test(value)) {
    return { threadId: value };
  }
  const binding = getBinding(event);
  const threads = binding?.recentThreads || [];
  const match = threads.find((thread) => thread.index === Number(value));
  if (!match) {
    return {
      error: `No thread is stored for index ${value}. Run /threads first, then use /resume ${value}.`,
    };
  }
  return { threadId: match.id, threadName: match.name };
}

function readJsonMaybe(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractText(content) {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    const parsed = readJsonMaybe(content);
    if (parsed && typeof parsed.text === "string") {
      return parsed.text.trim();
    }
    return content.trim();
  }
  if (typeof content.text === "string") {
    return content.text.trim();
  }
  return "";
}

function normalizeEvent(payload) {
  const eventType = payload?.header?.event_type || payload?.event_type || "";
  const event = payload?.event || payload?.data?.event || {};
  const message = event?.message || {};
  const sender = event?.sender || {};
  const senderId = sender?.sender_id || sender?.senderId || {};
  const rawText = extractText(message?.content);
  return {
    eventType,
    messageId: message?.message_id || message?.messageId || "",
    chatId: message?.chat_id || message?.chatId || "",
    chatType: message?.chat_type || message?.chatType || "",
    messageType: message?.message_type || message?.messageType || "",
    text: rawText,
    senderOpenId: senderId?.open_id || senderId?.openId || sender?.open_id || "",
    senderUnionId: senderId?.union_id || senderId?.unionId || "",
    senderName: sender?.sender_name || sender?.name || "",
    isFromBot: Boolean(sender?.sender_type === "app" || sender?.senderType === "app"),
    payload,
  };
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function spawnCommand(command, args, options = {}) {
  appendLog(`spawn ${command} ${args.join(" ")}`);
  return spawn(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function truncate(text, max = 1800) {
  if (!text) {
    return "";
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function truncateInline(text, max = 180) {
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), max);
}

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.stderr) {
    return String(error.stderr).trim();
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

function buildCodexArgs(prompt, threadId) {
  const commonOptions = ["-C", WORKDIR, "--json", "--skip-git-repo-check"];
  const args = ["exec", ...commonOptions];
  if (BYPASS_APPROVALS) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  if (threadId) {
    args.push("resume", threadId, prompt);
  } else {
    args.push(prompt);
  }
  return args;
}

function buildBridgedPrompt(prompt) {
  return `${BRIDGE_EXECUTION_CONTEXT}${prompt}`;
}

async function runCodex(prompt, threadId) {
  return await new Promise((resolve, reject) => {
    const child = spawnCommand(CODEX_BIN, buildCodexArgs(buildBridgedPrompt(prompt), threadId), {
      cwd: WORKDIR,
    });
    const rl = readline.createInterface({ input: child.stdout });
    let currentThreadId = threadId || null;
    let lastAgentText = "";
    let stderr = "";

    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      appendLog(`codex stdout ${line}`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "thread.started" && event.thread_id) {
        currentThreadId = event.thread_id;
      }
      if (
        event.type === "item.completed" &&
        event.item &&
        event.item.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        lastAgentText = event.item.text.trim();
      }
      if (
        event.type === "turn.completed" &&
        Array.isArray(event.last_agent_message) &&
        event.last_agent_message.length > 0
      ) {
        const combined = event.last_agent_message
          .map((part) => (part && typeof part.text === "string" ? part.text : ""))
          .join("\n")
          .trim();
        if (combined) {
          lastAgentText = combined;
        }
      }
      if (event.type === "error") {
        stderr = event.message || stderr;
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendLog(`codex stderr ${text.trim()}`);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      rl.close();
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Codex exited with code ${code}`));
        return;
      }
      resolve({
        threadId: currentThreadId,
        text: lastAgentText || "Codex completed, but did not return a text message.",
      });
    });
  });
}

async function runLark(args) {
  return await new Promise((resolve, reject) => {
    const child = spawnCommand(LARK_CLI, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `lark-cli exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function replyMessage(event, text) {
  const body = truncate(text);
  if (event.messageId) {
    await runLark([
      "im",
      "+messages-reply",
      "--as",
      "bot",
      "--message-id",
      event.messageId,
      "--text",
      body,
    ]);
    await appendHistory(event, { role: "assistant", text: body, source: "bridge" });
    return;
  }
  if (!event.chatId) {
    throw new Error("Missing chat id and message id, cannot send reply.");
  }
  await runLark([
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--chat-id",
    event.chatId,
    "--text",
    body,
  ]);
  await appendHistory(event, { role: "assistant", text: body, source: "bridge" });
}

async function sendMessageToChat(chatId, text, source = "bridge") {
  const body = truncate(text);
  await runLark([
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--chat-id",
    chatId,
    "--text",
    body,
  ]);

  const target = findConversationByChatId(chatId);
  if (!target) {
    return;
  }
  await appendHistory(
    {
      chatId,
      messageId: "",
      senderOpenId: target.binding.senderOpenId || "",
      senderName: target.binding.senderName || "",
    },
    { role: "assistant", text: body, source }
  );
}

function isPublishTaskText(text) {
  const normalized = String(text || "").toLowerCase();
  return PUBLISH_NOTIFY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function hasPublishSuccessSignal(text) {
  const normalized = String(text || "").toLowerCase();
  return PUBLISH_SUCCESS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

async function notifyPublishCompletion(event, binding, prompt, resultText) {
  if (!publishNotifyChatId || publishNotifyChatId === event.chatId) {
    return;
  }

  const threadName = await readThreadName(binding?.threadId || "");
  const publishSignal = [threadName, prompt, resultText].some((item) => isPublishTaskText(item));
  if (!publishSignal) {
    return;
  }

  const summary = [
    "发布任务完成",
    threadName ? `线程: ${threadName}` : null,
    binding?.threadId ? `[threadId] ${binding.threadId}` : null,
    `完成时间: ${formatUpdatedAt(new Date().toISOString())}`,
    `来源会话: ${event.chatId || "unknown-chat"}`,
    `任务摘要: ${truncateInline(prompt, 160)}`,
    "",
    "结果摘要:",
    truncate(resultText, 1200),
  ]
    .filter(Boolean)
    .join("\n");

  await sendMessageToChat(publishNotifyChatId, summary, "bridge-publish-notify");
}

async function notifyMonitoredThreadCompletion(thread, completion) {
  if (!publishNotifyChatId || !completion?.text || !hasPublishSuccessSignal(completion.text)) {
    return;
  }
  const summary = [
    "自动发布线程完成",
    thread?.name ? `线程: ${thread.name}` : null,
    completion.threadId ? `[threadId] ${completion.threadId}` : null,
    completion.timestamp ? `完成时间: ${formatUpdatedAt(completion.timestamp)}` : null,
    "",
    "结果摘要:",
    truncate(completion.text, 1200),
  ]
    .filter(Boolean)
    .join("\n");
  await sendMessageToChat(publishNotifyChatId, summary, "bridge-thread-monitor");
}

async function pollMonitoredThreads() {
  if (!publishNotifyChatId || MONITOR_THREAD_NAMES.length === 0) {
    return;
  }
  const monitorState = getMonitorState();
  const threads = await listMonitoredThreads();
  for (const thread of threads) {
    const completion = await readLatestTaskCompleteForThread(thread.id);
    if (!completion?.turnId || !completion?.text) {
      continue;
    }
    const lastTurnId = monitorState.lastNotifiedByThread[thread.id] || "";
    if (lastTurnId === completion.turnId) {
      continue;
    }
    monitorState.lastNotifiedByThread[thread.id] = completion.turnId;
    await saveState();
    await notifyMonitoredThreadCompletion(thread, completion);
  }
}

function startMonitorLoop() {
  if (!publishNotifyChatId || MONITOR_THREAD_NAMES.length === 0) {
    appendLog("thread monitor disabled");
    return;
  }
  appendLog(
    `thread monitor enabled chat=${publishNotifyChatId} patterns=${MONITOR_THREAD_NAMES.join(",")}`
  );
  const run = async () => {
    try {
      await pollMonitoredThreads();
    } catch (error) {
      appendLog(`thread monitor failed: ${formatError(error)}`);
    } finally {
      setTimeout(run, MONITOR_POLL_MS);
    }
  };
  setTimeout(run, 3000);
}

function renderHelp() {
  return [
    "Codex Feishu Bridge commands:",
    "/help - show this help",
    "/new <prompt> - create a new Codex thread and bind this chat",
    "/resume <threadId|index> - bind this chat to an existing Codex thread",
    "/status - show the current binding",
    "/threads - list recent local Codex threads",
    "/history [N] - show recent Feishu-side conversation history for this chat, up to 60 items",
    "/mirror - show the local mirror file paths for this chat",
    "/chatid - show the current Feishu chat id",
    "/setnotifyhere - set the current chat as the publish completion push target",
    "/unbind - clear the current binding",
    "",
    "If this chat already has a binding, plain text will continue that Codex thread.",
    "If no binding exists, the first plain-text message will start a new bound thread automatically.",
  ].join("\n");
}

function renderHistory(event, requestedCount) {
  const binding = getBinding(event);
  const count = Math.min(
    HISTORY_VIEW_MAX,
    Math.max(1, Number.isFinite(requestedCount) ? requestedCount : HISTORY_VIEW_ITEMS)
  );
  const history = Array.isArray(binding?.history) ? binding.history.slice(-count) : [];
  if (history.length === 0) {
    return "No Feishu-side history has been recorded for this chat yet.";
  }
  return [
    `Recent Feishu-side history (${history.length} items):`,
    ...history.map((item, index) => {
      const role =
        item.role === "user"
          ? "User"
          : item.role === "assistant"
            ? "Assistant"
            : "System";
      return `${index + 1}. [${role}] ${truncateInline(item.text, 220)}\n   at: ${formatUpdatedAt(item.at)}`;
    }),
  ].join("\n");
}

function renderMirror(event) {
  const binding = getBinding(event);
  const mirror = binding?.mirror || getMirrorPaths(event);
  return [
    "Local mirror files for this chat:",
    `Markdown: ${mirror.markdown}`,
    `JSONL: ${mirror.jsonl}`,
    "",
    "These files are updated whenever Feishu messages or bridge replies are processed.",
  ].join("\n");
}

function renderChatId(event) {
  return [
    `Current chat id: ${event.chatId || ""}`,
    `Current sender open_id: ${event.senderOpenId || ""}`,
    publishNotifyChatId ? `Current publish notify chat: ${publishNotifyChatId}` : "Current publish notify chat: off",
  ].join("\n");
}

async function listRecentThreads() {
  try {
    const threads = await readRecentThreads();
    if (threads.length === 0) {
      return {
        text: "No local Codex threads were found.",
        threads: [],
      };
    }
    return {
      threads,
      text: [
      "Recent local Codex threads:",
      ...threads.map((thread, index) => {
        return `${index + 1}. ${thread.name}\nthreadId: ${thread.id}\nupdated: ${formatUpdatedAt(thread.updatedAt)}`;
      }),
      "",
      "Use /resume 1 or /resume <threadId> to bind one of them to this chat.",
    ].join("\n"),
    };
  } catch (error) {
    return {
      text: `Could not read local Codex threads: ${formatError(error)}`,
      threads: [],
    };
  }
}

async function sendStatus(event) {
  const binding = getBinding(event);
  if (!binding || !binding.threadId) {
    return await replyMessage(
      event,
      [
        "Binding: none",
        `Workdir: ${WORKDIR}`,
        `Codex: ${CODEX_BIN}`,
      ].join("\n")
    );
  }
  return await replyMessage(
    event,
    [
      `Binding: ${binding.threadId}`,
      getActiveThread(binding.threadId)
        ? `Thread busy: yes (started ${formatUpdatedAt(getActiveThread(binding.threadId).startedAt)})`
        : "Thread busy: no",
      `Updated: ${binding.updatedAt}`,
      binding.mirror?.markdown ? `Mirror: ${binding.mirror.markdown}` : null,
      `Current chat: ${event.chatId}`,
      `Workdir: ${WORKDIR}`,
      `Codex: ${CODEX_BIN}`,
      publishNotifyChatId ? `Publish notify chat: ${publishNotifyChatId}` : "Publish notify chat: off",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function processPrompt(event, prompt, existingBinding) {
  const key = getConversationKey(event);
  if (inFlight.has(key)) {
    await replyMessage(event, "This chat already has a Codex task running. Please wait for it to finish.");
    return;
  }

  const threadId = existingBinding?.threadId || null;
  const activeThread = getActiveThread(threadId);
  if (threadId && activeThread) {
    await replyMessage(
      event,
      [
        `This thread is busy right now: ${threadId}`,
        `Started: ${formatUpdatedAt(activeThread.startedAt)}`,
        activeThread.promptPreview ? `Current task: ${activeThread.promptPreview}` : null,
        "Wait for the current run to finish before sending the next instruction.",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  inFlight.add(key);
  try {
    if (threadId) {
      await markThreadActive(event, threadId, prompt);
    }
    const result = await runCodex(prompt, existingBinding?.threadId || null);
    await markThreadActive(event, result.threadId, prompt);
    const binding = await setBinding(event, { threadId: result.threadId });
    await replyMessage(
      event,
      `${result.text}\n\n[threadId] ${binding.threadId}`
    );
    await notifyPublishCompletion(event, binding, prompt, result.text);
  } catch (error) {
    await replyMessage(event, `Codex failed: ${truncate(formatError(error), 1500)}`);
  } finally {
    await clearThreadActive(existingBinding?.threadId || null);
    inFlight.delete(key);
  }
}

async function handleCommand(event, commandLine) {
  const [command, ...rest] = commandLine.split(/\s+/);
  const arg = rest.join(" ").trim();

  if (command === "/help" || command === "/start") {
    await replyMessage(event, renderHelp());
    return;
  }

  if (command === "/status") {
    await sendStatus(event);
    return;
  }

  if (command === "/history") {
    const count = arg ? Number(arg) : HISTORY_VIEW_ITEMS;
    if (arg && (!Number.isInteger(count) || count <= 0)) {
      await replyMessage(event, "Usage: /history [N]\nN must be a positive integer up to 60.");
      return;
    }
    await replyMessage(event, renderHistory(event, count));
    return;
  }

  if (command === "/mirror") {
    await replyMessage(event, renderMirror(event));
    return;
  }

  if (command === "/chatid") {
    await replyMessage(event, renderChatId(event));
    return;
  }

  if (command === "/setnotifyhere") {
    if (!event.chatId) {
      await replyMessage(event, "This message has no chat id, so the notify target cannot be updated.");
      return;
    }
    publishNotifyChatId = event.chatId;
    await upsertEnvVar("CODEX_BRIDGE_PUBLISH_NOTIFY_CHAT_ID", event.chatId);
    await replyMessage(
      event,
      [
        `Publish notify chat updated to: ${event.chatId}`,
        "Future publish-success auto-push notifications will be sent to this chat.",
      ].join("\n")
    );
    return;
  }

  if (command === "/threads") {
    const result = await listRecentThreads();
    if (result.threads.length > 0) {
      await rememberRecentThreads(event, result.threads);
    }
    await replyMessage(event, result.text);
    return;
  }

  if (command === "/unbind") {
    await clearBinding(event);
    await replyMessage(event, "This chat is no longer bound to a Codex thread.");
    return;
  }

  if (command === "/resume") {
    if (!arg) {
      await replyMessage(event, "Usage: /resume <threadId|index>");
      return;
    }
    const target = resolveResumeTarget(event, arg);
    if (target.error) {
      await replyMessage(event, target.error);
      return;
    }
    await setBinding(event, { threadId: target.threadId });
    await replyMessage(
      event,
      [
        `Bound this chat to Codex thread ${target.threadId}.`,
        target.threadName ? `Thread: ${target.threadName}` : null,
        "Send plain text to continue that thread.",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  if (command === "/new") {
    if (!arg) {
      await replyMessage(event, "Usage: /new <prompt>");
      return;
    }
    await processPrompt(event, arg, null);
    return;
  }

  await replyMessage(event, `Unknown command: ${command}\n\n${renderHelp()}`);
}

async function handleEvent(event) {
  if (event.eventType !== "im.message.receive_v1") {
    return;
  }
  if (event.isFromBot || event.messageType !== "text" || !event.text) {
    return;
  }

  appendLog(`incoming ${JSON.stringify({ text: event.text, chatId: event.chatId, senderOpenId: event.senderOpenId })}`);
  await appendHistory(event, {
    role: "user",
    text: event.text,
    source: event.text.startsWith("/") ? "command" : "feishu",
  });

  if (event.text.startsWith("/")) {
    await handleCommand(event, event.text);
    return;
  }

  const binding = getBinding(event);
  if (!binding?.threadId && !AUTO_BIND_ON_FIRST_TEXT) {
    await replyMessage(event, "This chat is not bound yet. Use /new <prompt> or /resume <threadId> first.");
    return;
  }

  await processPrompt(event, event.text, binding);
}

async function subscribeLoop() {
  appendLog("starting event subscription loop");
  const child = spawnCommand(LARK_CLI, [
    "event",
    "+subscribe",
    "--as",
    "bot",
    "--event-types",
    "im.message.receive_v1",
    "--quiet",
  ]);

  child.stderr.on("data", (chunk) => {
    appendLog(`lark stderr ${chunk.toString().trim()}`);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }
    appendLog(`lark stdout ${line}`);
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      appendLog(`failed to parse event line: ${line}`);
      return;
    }
    try {
      await handleEvent(normalizeEvent(payload));
    } catch (error) {
      appendLog(`event handling failed: ${formatError(error)}`);
      try {
        const event = normalizeEvent(payload);
        if (event.messageId || event.chatId) {
          await replyMessage(event, `Bridge error: ${truncate(formatError(error), 1200)}`);
        }
      } catch {
      }
    }
  });

  child.on("close", (code) => {
    appendLog(`event subscription exited with code ${code}`);
    rl.close();
    setTimeout(() => {
      subscribeLoop().catch((error) => {
        appendLog(`subscribe loop restart failed: ${formatError(error)}`);
      });
    }, 3000);
  });
}

async function verifyBinaries() {
  await fsp.access(LARK_CLI, fs.constants.X_OK);
  await fsp.access(CODEX_BIN, fs.constants.X_OK);
}

function printLocalHelp() {
  console.log(
    [
      "Codex Feishu bridge",
      `workdir: ${WORKDIR}`,
      `lark-cli: ${LARK_CLI}`,
      `codex: ${CODEX_BIN}`,
      "",
      "Before running, complete:",
      `1. ${shellQuote(LARK_CLI)} config init --new`,
      `2. ${shellQuote(LARK_CLI)} auth login --recommend`,
      `3. ${shellQuote(LARK_CLI)} auth status`,
      "",
      "Then start the bridge:",
      `   ${shellQuote(process.execPath)} ${shellQuote(path.join(ROOT_DIR, "src", "bridge.js"))}`,
    ].join("\n")
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    printLocalHelp();
    return;
  }

  ensureDataDir();
  await verifyBinaries();
  await loadState();
  appendLog("bridge booted");
  startMonitorLoop();
  await subscribeLoop();
}

main().catch((error) => {
  appendLog(`fatal ${formatError(error)}`);
  console.error(formatError(error));
  process.exitCode = 1;
});
