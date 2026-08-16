const state = {
  bootstrap: null, agent: null, messages: [], liveMessage: null,
  selectedAdapter: null, adapterData: null, mediaData: null, mediaLoading: false, selectedMemory: null,
  eventSource: null, refreshTimer: null, dialogQueue: [], activeDialog: null,
  extensionStatuses: new Map(), widgets: new Map(), liveRenderPending: false,
  commandMatches: [], activeCommandIndex: 0,
};

const views = {
  chat: ["SESSION / TOBE", "长期会话"],
  adapters: ["AWARENESS", "Adapter 配置"],
  media: ["MEDIA", "Media 配置"],
  memory: ["PERSISTENT COGNITION", "记忆审查"],
  settings: ["TOBE WEB", "设置"],
};

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#agent-toggle").addEventListener("click", toggleAgent);
document.querySelector("#agent-abort").addEventListener("click", () => api("/api/agent/abort", { method: "POST" }).catch(showError));
document.querySelector("#composer").addEventListener("submit", sendPrompt);
document.querySelector("#settings-form").addEventListener("submit", saveSettings);
document.querySelector("#password-enabled").addEventListener("change", updateSettingsAvailability);
document.querySelector("#provider-enabled").addEventListener("change", updateSettingsAvailability);
document.querySelector("#rpc-dialog-form").addEventListener("submit", submitRpcDialog);
document.querySelector("#rpc-dialog-cancel").addEventListener("click", () => answerRpcDialog({ cancelled: true }));
document.querySelector("#rpc-dialog").addEventListener("cancel", (event) => { event.preventDefault(); answerRpcDialog({ cancelled: true }); });
const promptField = document.querySelector("#prompt");
promptField.addEventListener("input", renderCommandMenu);
promptField.addEventListener("focus", renderCommandMenu);
promptField.addEventListener("blur", () => setTimeout(hideCommandMenu, 120));
promptField.addEventListener("keydown", (event) => {
  if (handleCommandMenuKeydown(event)) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    document.querySelector("#composer").requestSubmit();
  }
});

void initialize();

async function initialize() {
  try {
    const session = await api("/api/auth/session");
    if (session.passwordRequired && !session.authenticated) { showLogin(); return; }
    await enterApp(session.passwordRequired);
  } catch (error) { showError(error); }
}

async function login(event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  const error = document.querySelector("#login-error");
  error.textContent = "";
  try { await api("/api/auth/login", { method: "POST", body: { password } }); await enterApp(true); }
  catch (value) { error.textContent = value.message; }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  state.eventSource?.close();
  showLogin();
}

function showLogin() {
  document.querySelector("#app").hidden = true;
  document.querySelector("#login").hidden = false;
  document.querySelector("#login-password").focus();
}

async function enterApp(passwordRequired) {
  document.querySelector("#login").hidden = true;
  document.querySelector("#app").hidden = false;
  document.querySelector("#logout").hidden = !passwordRequired;
  state.bootstrap = await api("/api/bootstrap");
  state.agent = state.bootstrap.agent;
  renderAgent();
  renderAdapters();
  renderMemoryList();
  renderSettings();
  connectEvents();
  if (state.agent.processState !== "stopped") await refreshMessages();
}

function showView(name) {
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === name));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${name}`));
  document.querySelector("#view-kicker").textContent = views[name][0];
  document.querySelector("#view-title").textContent = views[name][1];
  document.querySelector("#agent-controls").hidden = name !== "chat";
  if (name === "media") void loadMediaConfig();
}

function connectEvents() {
  state.eventSource?.close();
  const source = new EventSource("/api/events");
  state.eventSource = source;
  source.onmessage = (event) => {
    const envelope = JSON.parse(event.data);
    if (envelope.type === "agent.state") {
      state.agent = envelope.data;
      renderAgent();
      return;
    }
    if (envelope.type !== "agent.event") return;
    const data = envelope.data || {};
    if (data.type === "message_start" || data.type === "message_update") {
      if (data.message?.role === "assistant") {
        state.liveMessage = data.message;
        scheduleLiveRender();
      }
    }
    if (data.type === "message_end" || data.type === "agent_end") {
      state.liveMessage = null;
      scheduleMessageRefresh();
    }
    if (data.type === "extension_ui_request") handleExtensionUi(data);
    if (data.type === "extension_error") showToast(data.error || "Extension 执行失败", true);
  };
  source.onerror = () => setStatus("recovering", "Web 连接恢复中");
}

function renderAgent() {
  const agent = state.agent || { processState: "stopped", state: null, stats: null };
  const streaming = Boolean(agent.state?.isStreaming);
  const labels = {
    stopped: "Agent 已停止",
    starting: "Agent 启动中",
    running: streaming ? "Agent 正在回应" : "Agent 已连接",
    recovering: "Agent 恢复中",
  };
  setStatus(agent.error && agent.processState === "recovering" ? "error" : streaming ? "busy" : agent.processState, labels[agent.processState] || "状态未知");
  const toggle = document.querySelector("#agent-toggle");
  const running = agent.desiredRunning || agent.processState !== "stopped";
  toggle.textContent = running ? "停止 Agent" : "运行 Agent";
  toggle.classList.toggle("start", !running);
  toggle.classList.toggle("stop", running);
  toggle.disabled = ["starting", "recovering"].includes(agent.processState);
  document.querySelector("#agent-abort").hidden = !streaming;
  document.querySelector("#prompt").disabled = agent.processState !== "running";
  document.querySelector("#composer button").disabled = agent.processState !== "running";
  renderMetrics();
  renderCommandMenu();
}

function setStatus(kind, label) {
  const dot = document.querySelector("#status-dot");
  dot.className = `status-dot ${kind === "running" ? "running" : kind === "busy" ? "busy" : kind === "error" ? "error" : ""}`;
  document.querySelector("#status-label").textContent = label;
}

function renderMetrics() {
  const agent = state.agent || {};
  const session = agent.state || {};
  const stats = agent.stats || {};
  const model = session.model || {};
  const rawModelLabel = typeof model === "string" ? model : [model.provider, model.id].filter(Boolean).join("/") || session.modelId || "";
  const modelLabel = !rawModelLabel || rawModelLabel === "unknown/unknown" || rawModelLabel === "unknown" ? "未选择模型" : rawModelLabel;
  const streaming = Boolean(session.isStreaming);
  const extraStatus = [...state.extensionStatuses.values()].filter(Boolean)[0];
  document.querySelector("#metric-model").textContent = modelLabel;
  document.querySelector("#metric-state").textContent = extraStatus || (agent.processState === "stopped" ? "已停止" : streaming ? "生成中" : "窗口空闲");
  document.querySelector("#metric-tokens").textContent = `${formatTokens(stats.tokens?.total || 0)} tokens`;
  const context = stats.contextUsage;
  document.querySelector("#metric-context").textContent = context?.contextWindow
    ? `窗口 ${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} · ${numberOrDash(context.percent)}%`
    : "窗口 -";
  document.querySelector("#metric-cost").textContent = Number.isFinite(stats.cost) ? `$${stats.cost.toFixed(4)}` : "$0.00";
}

async function toggleAgent() {
  try {
    const stop = state.agent?.desiredRunning || state.agent?.processState !== "stopped";
    state.agent = await api(stop ? "/api/agent/stop" : "/api/agent/start", { method: "POST" });
    renderAgent();
    if (!stop) await refreshMessages();
  } catch (error) { showError(error); }
}

async function sendPrompt(event) {
  event.preventDefault();
  const field = document.querySelector("#prompt");
  const message = field.value.trim();
  if (!message) return;
  hideCommandMenu();
  field.value = "";
  try {
    await api("/api/agent/prompt", { method: "POST", body: { message } });
    scheduleMessageRefresh();
  } catch (error) {
    field.value = message;
    showError(error);
  }
}

function renderCommandMenu() {
  const field = document.querySelector("#prompt");
  const menu = document.querySelector("#command-menu");
  const query = slashCommandQuery(field.value);
  const commands = Array.isArray(state.agent?.commands) ? state.agent.commands : [];
  if (query === null || !commands.length || field.disabled) {
    hideCommandMenu();
    return;
  }
  const normalizedQuery = query.toLocaleLowerCase();
  state.commandMatches = commands.filter((command) =>
    typeof command?.name === "string" && command.name.toLocaleLowerCase().includes(normalizedQuery)
  );
  if (!state.commandMatches.length) {
    hideCommandMenu();
    return;
  }
  state.activeCommandIndex = Math.min(state.activeCommandIndex, state.commandMatches.length - 1);
  menu.replaceChildren(...state.commandMatches.map((command, index) => renderCommandOption(command, index)));
  menu.hidden = false;
  field.setAttribute("aria-expanded", "true");
  updateActiveCommand();
}

function renderCommandOption(command, index) {
  const option = element("button", "command-option");
  option.type = "button";
  option.id = `command-option-${index}`;
  option.setAttribute("role", "option");
  option.append(
    element("span", "command-name", `/${command.name}`),
    element("span", "command-description", command.description || "Pi 命令"),
    element("span", "command-source", commandSourceLabel(command.source)),
  );
  option.addEventListener("mousedown", (event) => event.preventDefault());
  option.addEventListener("click", () => applyCommand(index));
  option.addEventListener("mousemove", () => {
    if (state.activeCommandIndex === index) return;
    state.activeCommandIndex = index;
    updateActiveCommand();
  });
  return option;
}

function slashCommandQuery(value) {
  if (!value.startsWith("/") || value.includes("\n")) return null;
  const query = value.slice(1);
  return /\s/.test(query) ? null : query;
}

function handleCommandMenuKeydown(event) {
  const menu = document.querySelector("#command-menu");
  if (menu.hidden || !state.commandMatches.length) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.activeCommandIndex = (state.activeCommandIndex + direction + state.commandMatches.length) % state.commandMatches.length;
    updateActiveCommand();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideCommandMenu();
    return true;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    applyCommand(state.activeCommandIndex);
    return true;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    const selected = state.commandMatches[state.activeCommandIndex];
    if (document.querySelector("#prompt").value !== `/${selected.name}`) {
      event.preventDefault();
      applyCommand(state.activeCommandIndex);
      return true;
    }
  }
  return false;
}

function applyCommand(index) {
  const command = state.commandMatches[index];
  if (!command) return;
  const field = document.querySelector("#prompt");
  field.value = `/${command.name} `;
  hideCommandMenu();
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

function updateActiveCommand() {
  const menu = document.querySelector("#command-menu");
  [...menu.children].forEach((option, index) => {
    const active = index === state.activeCommandIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
    if (active) {
      document.querySelector("#prompt").setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
}

function hideCommandMenu() {
  const menu = document.querySelector("#command-menu");
  menu.hidden = true;
  menu.replaceChildren();
  state.commandMatches = [];
  state.activeCommandIndex = 0;
  const field = document.querySelector("#prompt");
  field.setAttribute("aria-expanded", "false");
  field.removeAttribute("aria-activedescendant");
}

function commandSourceLabel(source) {
  return source === "skill" ? "SKILL" : source === "prompt" ? "PROMPT" : "EXTENSION";
}

function scheduleMessageRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => refreshMessages().catch(showError), 140);
}

function scheduleLiveRender() {
  if (state.liveRenderPending) return;
  state.liveRenderPending = true;
  requestAnimationFrame(() => {
    state.liveRenderPending = false;
    renderMessages();
  });
}

async function refreshMessages() {
  const result = await api("/api/agent/messages");
  state.messages = result.messages || [];
  renderMessages();
}

function renderMessages() {
  const container = document.querySelector("#messages");
  const visible = state.messages.filter(isVisibleMessage);
  if (state.liveMessage && !visible.some((message) => sameMessage(message, state.liveMessage))) visible.push(state.liveMessage);
  if (!visible.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-glyph">◌</span><h2>会话已就绪</h2><p>运行 Agent 后发送第一条消息。斜杠命令会原样交给 Pi。</p></div>';
    return;
  }
  container.replaceChildren(...visible.map((message) => renderMessage(message, message === state.liveMessage)));
  container.scrollTop = container.scrollHeight;
}

function isVisibleMessage(message) {
  if (!message || message.display === false) return false;
  return ["user", "assistant", "toolResult", "custom"].includes(message.role);
}

function sameMessage(left, right) {
  return left === right || (left?.role === right?.role && left?.timestamp && left.timestamp === right.timestamp);
}

function renderMessage(message, live) {
  const role = message.role === "toolResult" ? "tool" : message.role;
  const item = element("article", `message ${role}`);
  const label = message.role === "user" ? "YOU" : message.role === "assistant" ? "TOBE" : message.toolName ? `TOOL / ${message.toolName}` : "SYSTEM";
  item.append(element("div", "message-label", label));
  const body = element("div", "message-body");
  const parts = Array.isArray(message.content) ? message.content : typeof message.content === "string" ? [{ type: "text", text: message.content }] : [];
  if (message.role === "toolResult") {
    body.append(renderToolResult(message));
  } else {
    for (const part of parts) body.append(renderContentPart(part, live));
  }
  if (!body.childNodes.length) body.append(element("div", "working-line", live ? "思考中…" : "此消息没有可展示的文本内容"));
  item.append(body);
  if (message.role === "assistant" && message.usage) {
    const usage = message.usage;
    item.append(element("div", "message-meta", `${formatTokens((usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0))} tokens`));
  }
  return item;
}

function renderContentPart(part, live) {
  if (part?.type === "thinking") {
    const details = element("details", "thinking-block");
    details.open = Boolean(live);
    details.append(element("summary", "", live ? "正在思考" : "思考过程"));
    details.append(element("div", "thinking-content", part.thinking || ""));
    return details;
  }
  if (part?.type === "toolCall") {
    const details = element("details", "tool-call");
    details.open = Boolean(live);
    details.append(element("summary", "", `调用 ${part.name || "tool"}`));
    details.append(element("pre", "", safeJson(part.arguments)));
    return details;
  }
  if (part?.type === "text") return element("div", "text-content", part.text || "");
  if (part?.type === "image") return element("div", "media-note", "图片内容");
  return element("pre", "unknown-content", safeJson(part));
}

function renderToolResult(message) {
  const details = element("details", `tool-result ${message.isError ? "failed" : ""}`);
  details.append(element("summary", "", message.isError ? "工具执行失败" : "工具执行结果"));
  const text = (Array.isArray(message.content) ? message.content : [])
    .map((part) => part?.text || part?.data || "")
    .filter(Boolean)
    .join("\n");
  details.append(element("pre", "", text || safeJson(message.content)));
  return details;
}

function handleExtensionUi(request) {
  if (request.method === "notify") {
    showToast(request.message || "Agent 通知", request.notifyType === "error");
    return;
  }
  if (request.method === "setStatus") {
    if (request.statusText) state.extensionStatuses.set(request.statusKey || request.id, request.statusText);
    else state.extensionStatuses.delete(request.statusKey || request.id);
    renderMetrics();
    return;
  }
  if (request.method === "setWidget") {
    if (Array.isArray(request.widgetLines)) state.widgets.set(request.widgetKey || request.id, request.widgetLines);
    else state.widgets.delete(request.widgetKey || request.id);
    renderWidgets();
    return;
  }
  if (request.method === "setTitle" && request.title) {
    document.title = `${request.title} · ToBe`;
    return;
  }
  if (request.method === "set_editor_text") {
    document.querySelector("#prompt").value = request.text || "";
    document.querySelector("#prompt").focus();
    return;
  }
  if (["select", "confirm", "input", "editor"].includes(request.method)) {
    state.dialogQueue.push(request);
    showNextRpcDialog();
  }
}

function renderWidgets() {
  const widget = document.querySelector("#extension-widget");
  const lines = [...state.widgets.values()].flat();
  widget.hidden = !lines.length;
  widget.textContent = lines.join("\n");
}

function showNextRpcDialog() {
  if (state.activeDialog || !state.dialogQueue.length) return;
  const request = state.dialogQueue.shift();
  state.activeDialog = request;
  const dialog = document.querySelector("#rpc-dialog");
  document.querySelector("#rpc-dialog-title").textContent = request.title || "Agent 需要你的输入";
  const message = document.querySelector("#rpc-dialog-message");
  message.textContent = request.message || "";
  message.hidden = !request.message;
  const control = document.querySelector("#rpc-dialog-control");
  control.replaceChildren();
  if (request.method === "select") {
    const select = document.createElement("select");
    select.id = "rpc-dialog-value";
    (request.options || []).forEach((value) => { const option = document.createElement("option"); option.value = value; option.textContent = value; select.append(option); });
    control.append(select);
  } else if (request.method === "input") {
    const input = document.createElement("input"); input.id = "rpc-dialog-value"; input.type = /api key|密钥/i.test(request.title || "") ? "password" : "text"; input.autocomplete = "off"; input.placeholder = request.placeholder || ""; control.append(input);
  } else if (request.method === "editor") {
    const textarea = document.createElement("textarea"); textarea.id = "rpc-dialog-value"; textarea.rows = 10; textarea.value = request.prefill || ""; control.append(textarea);
  }
  dialog.showModal();
  control.querySelector("input, textarea, select")?.focus();
}

function submitRpcDialog(event) {
  event.preventDefault();
  const request = state.activeDialog;
  if (!request) return;
  if (request.method === "confirm") answerRpcDialog({ confirmed: true });
  else answerRpcDialog({ value: document.querySelector("#rpc-dialog-value")?.value || "" });
}

async function answerRpcDialog(answer) {
  const request = state.activeDialog;
  if (!request) return;
  state.activeDialog = null;
  document.querySelector("#rpc-dialog").close();
  try { await api("/api/agent/ui-response", { method: "POST", body: { id: request.id, ...answer } }); }
  catch (error) { showError(error); }
  showNextRpcDialog();
}

function renderAdapters() {
  const list = document.querySelector("#adapter-list");
  list.replaceChildren(...state.bootstrap.adapters.map((adapter) => {
    const button = element("button", "item-button");
    button.type = "button";
    button.dataset.id = adapter.id;
    button.append(element("strong", "", adapter.id.replace(/-adapter$/, "")));
    button.append(element("span", "", adapter.hasSchema ? `${adapter.enabled ? "已启用" : "未启用"}${adapter.autoStart ? " · 自动启动" : ""}` : "缺少 schema · 只读"));
    button.addEventListener("click", () => selectAdapter(adapter.id));
    return button;
  }));
}

async function selectAdapter(id) {
  document.querySelectorAll("#adapter-list .item-button").forEach((button) => button.classList.toggle("active", button.dataset.id === id));
  const editor = document.querySelector("#adapter-editor");
  editor.innerHTML = '<div class="empty-state"><h2>正在读取配置</h2><p>敏感值仅返回是否已设置。</p></div>';
  try {
    state.selectedAdapter = id;
    state.adapterData = await api(`/api/adapters/${encodeURIComponent(id)}`);
    renderAdapterEditor();
  } catch (error) {
    editor.innerHTML = `<div class="empty-state"><h2>无法编辑</h2><p>${escapeText(error.message)}</p></div>`;
  }
}

function renderAdapterEditor() {
  const data = state.adapterData;
  const editor = document.querySelector("#adapter-editor");
  editor.replaceChildren();
  const heading = element("div", "editor-heading");
  const headingText = element("div");
  headingText.append(element("p", "eyebrow", "ADAPTER CONFIG"), element("h2", "", data.schema.title || data.id), element("p", "", "保存立即写入文件，运行实例保持当前配置。"));
  heading.append(headingText);
  editor.append(heading);
  const form = element("form", "config-form");
  const grid = element("div", "field-grid");
  renderSchemaProperties(grid, data.schema.properties || {}, data.config, "", data.sensitive);
  form.append(grid);
  const actions = element("div", "editor-actions");
  const reset = element("button", "secondary", "恢复默认");
  reset.type = "button";
  reset.addEventListener("click", () => { state.adapterData.config = structuredClone(data.defaults); renderAdapterEditor(); });
  const save = element("button", "primary", "保存配置");
  save.type = "submit";
  actions.append(reset, save);
  form.append(actions);
  form.addEventListener("submit", saveAdapterConfig);
  editor.append(form);
}

function renderSchemaProperties(parent, properties, current, prefix, sensitive = {}) {
  for (const [key, schema] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = current?.[key];
    if (schema.type === "object" && Object.keys(schema.properties || {}).length) {
      const group = element("fieldset", "field-group full");
      group.append(element("legend", "", schema.title || key));
      const grid = element("div", "field-grid");
      renderSchemaProperties(grid, schema.properties, value || {}, path, sensitive);
      group.append(grid);
      parent.append(group);
      continue;
    }
    const field = element("div", `field ${schema.type === "array" || schema.type === "object" ? "full" : ""}`);
    const inputId = `config-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    if (schema.type === "boolean") {
      field.classList.add("boolean-field");
      const input = document.createElement("input");
      input.id = inputId; input.type = "checkbox"; input.checked = Boolean(value); input.dataset.path = path; input.dataset.kind = "boolean";
      const label = element("label", "", schema.title || key); label.htmlFor = inputId;
      field.append(label, input);
    } else {
      const label = element("label", "", schema.title || key); label.htmlFor = inputId; field.append(label);
      let input;
      if (schema.type === "array" || schema.type === "object") {
        input = document.createElement("textarea"); input.rows = 3; input.value = JSON.stringify(value ?? (schema.type === "array" ? [] : {}), null, 2); input.dataset.kind = "json";
      } else if (Array.isArray(schema.enum)) {
        input = document.createElement("select"); schema.enum.forEach((choice) => { const option = document.createElement("option"); option.value = choice; option.textContent = choice; option.selected = choice === value; input.append(option); }); input.dataset.kind = "string";
      } else {
        input = document.createElement("input"); input.type = schema["x-sensitive"] ? "password" : schema.type === "integer" || schema.type === "number" ? "number" : "text"; input.value = schema["x-sensitive"] ? "" : value ?? ""; input.dataset.kind = schema.type || "string";
      }
      input.id = inputId;
      input.dataset.path = path;
      if (schema["x-sensitive"]) {
        input.dataset.sensitive = "true";
        input.placeholder = sensitive[path] ? "已设置，留空则保持不变" : "未设置";
        const clearLabel = element("label", "check-row sensitive-clear");
        const clear = document.createElement("input"); clear.type = "checkbox"; clear.dataset.clearSensitive = path;
        clearLabel.append(clear, document.createTextNode("清除已保存的值"));
        field.append(input, clearLabel);
      } else field.append(input);
    }
    if (schema.description) field.append(element("p", "field-help", schema.description));
    parent.append(field);
  }
}

async function saveAdapterConfig(event) {
  event.preventDefault();
  try {
    const { config, sensitiveUpdates, clearSensitive } = readSchemaForm(event.currentTarget, state.adapterData.config);
    const result = await api(`/api/adapters/${encodeURIComponent(state.selectedAdapter)}`, { method: "PUT", body: { config, sensitiveUpdates, clearSensitive } });
    showToast(result.message);
    state.adapterData = await api(`/api/adapters/${encodeURIComponent(state.selectedAdapter)}`);
    renderAdapterEditor();
  } catch (error) { showError(error); }
}

async function loadMediaConfig() {
  if (state.mediaLoading) return;
  const editor = document.querySelector("#media-editor");
  state.mediaLoading = true;
  editor.innerHTML = '<div class="empty-state"><h2>正在读取配置</h2><p>读取 media/config.json 与模块 schema。</p></div>';
  try {
    state.mediaData = await api("/api/media");
    renderMediaEditor();
  } catch (error) {
    editor.innerHTML = `<div class="empty-state"><h2>无法编辑</h2><p>${escapeText(error.message)}</p></div>`;
  } finally { state.mediaLoading = false; }
}

function renderMediaEditor() {
  const data = state.mediaData;
  const editor = document.querySelector("#media-editor");
  editor.replaceChildren();
  const heading = element("div", "editor-heading");
  const headingText = element("div");
  headingText.append(element("p", "eyebrow", "MEDIA CONFIG"), element("h2", "", data.schema.title || "Media"), element("p", "", "保存立即写入文件，并在下一次运行 Agent 时生效。"));
  heading.append(headingText);
  editor.append(heading);
  const form = element("form", "config-form");
  const grid = element("div", "field-grid");
  renderSchemaProperties(grid, data.schema.properties || {}, data.config, "", data.sensitive);
  form.append(grid);
  const actions = element("div", "editor-actions");
  const reset = element("button", "secondary", "恢复默认");
  reset.type = "button";
  reset.addEventListener("click", () => { state.mediaData.config = structuredClone(data.defaults); renderMediaEditor(); });
  const save = element("button", "primary", "保存配置");
  save.type = "submit";
  actions.append(reset, save);
  form.append(actions);
  form.addEventListener("submit", saveMediaConfig);
  editor.append(form);
}

async function saveMediaConfig(event) {
  event.preventDefault();
  try {
    const { config, sensitiveUpdates, clearSensitive } = readSchemaForm(event.currentTarget, state.mediaData.config);
    const result = await api("/api/media", { method: "PUT", body: { config, sensitiveUpdates, clearSensitive } });
    showToast(result.message);
    state.mediaData = await api("/api/media");
    renderMediaEditor();
  } catch (error) { showError(error); }
}

function readSchemaForm(form, currentConfig) {
  const config = structuredClone(currentConfig);
  const sensitiveUpdates = {};
  const clearSensitive = [];
  form.querySelectorAll("[data-path]").forEach((input) => {
    const path = input.dataset.path;
    if (input.dataset.sensitive === "true") { if (input.value) sensitiveUpdates[path] = input.value; return; }
    let value = input.value;
    if (input.dataset.kind === "boolean") value = input.checked;
    else if (input.dataset.kind === "integer") value = Number.parseInt(value, 10);
    else if (input.dataset.kind === "number") value = Number(value);
    else if (input.dataset.kind === "json") value = JSON.parse(value);
    setPath(config, path, value);
  });
  form.querySelectorAll("[data-clear-sensitive]:checked").forEach((input) => clearSensitive.push(input.dataset.clearSensitive));
  return { config, sensitiveUpdates, clearSensitive };
}

function renderMemoryList() {
  const list = document.querySelector("#memory-list");
  list.replaceChildren(...state.bootstrap.memory.map((entry) => {
    const button = element("button", "item-button");
    button.type = "button"; button.dataset.id = entry.id;
    button.append(element("strong", "", entry.label), element("span", "", `${entry.kind} · ${entry.editable ? "可编辑" : "只读"}${entry.exists ? "" : " · 未创建"}`));
    button.addEventListener("click", () => selectMemory(entry.id));
    return button;
  }));
}

async function selectMemory(id) {
  document.querySelectorAll("#memory-list .item-button").forEach((button) => button.classList.toggle("active", button.dataset.id === id));
  state.selectedMemory = await api(`/api/memory/${encodeURIComponent(id)}`);
  renderMemoryEditor();
}

function renderMemoryEditor() {
  const data = state.selectedMemory;
  const editor = document.querySelector("#memory-editor");
  editor.replaceChildren();
  const heading = element("div", "editor-heading");
  const text = element("div");
  text.append(element("p", "eyebrow", "MEMORY FILE"), element("h2", "", data.label), element("p", "", data.editable ? "修改会在下一次 Agent turn 读取。" : "项目基础认知，仅供审查。"));
  heading.append(text);
  editor.append(heading);
  const form = element("form", "memory-form");
  const textarea = element("textarea", "memory-text");
  textarea.value = data.content; textarea.readOnly = !data.editable; textarea.setAttribute("aria-label", data.label);
  form.append(textarea);
  if (data.editable) {
    const actions = element("div", "editor-actions");
    const save = element("button", "primary", "保存文本"); save.type = "submit";
    actions.append(save); form.append(actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await api(`/api/memory/${encodeURIComponent(data.id)}`, { method: "PUT", body: { content: textarea.value } }); showToast("记忆文件已保存"); }
      catch (error) { showError(error); }
    });
  }
  editor.append(form);
}

function renderSettings() {
  const settings = state.bootstrap.settings;
  const provider = settings.customProvider || {};
  document.querySelector("#password-enabled").checked = settings.passwordEnabled;
  document.querySelector("#access-password").value = "";
  document.querySelector("#allowed-ips").value = (settings.allowedIps || []).join("\n");
  document.querySelector("#current-ip").textContent = settings.currentIp || "未知";
  document.querySelector("#provider-enabled").checked = provider.enabled;
  document.querySelector("#provider-base-url").value = provider.baseUrl || "";
  document.querySelector("#provider-key").value = "";
  document.querySelector("#provider-key").placeholder = provider.hasKey ? "已设置，留空则保持不变" : "未设置";
  document.querySelector("#provider-model").value = provider.model || "";
  updateSettingsAvailability();
}

function updateSettingsAvailability() {
  const passwordEnabled = document.querySelector("#password-enabled").checked;
  document.querySelector("#access-password").disabled = !passwordEnabled;
  document.querySelector("#password-field").classList.toggle("disabled-field", !passwordEnabled);
  const providerEnabled = document.querySelector("#provider-enabled").checked;
  document.querySelectorAll("#provider-fields input").forEach((input) => { input.disabled = !providerEnabled; });
  document.querySelector("#provider-fields").classList.toggle("disabled-field", !providerEnabled);
}

async function saveSettings(event) {
  event.preventDefault();
  const passwordEnabled = document.querySelector("#password-enabled").checked;
  const password = document.querySelector("#access-password").value;
  const allowedIps = document.querySelector("#allowed-ips").value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
  const customProvider = {
    enabled: document.querySelector("#provider-enabled").checked,
    baseUrl: document.querySelector("#provider-base-url").value,
    apiKey: document.querySelector("#provider-key").value,
    model: document.querySelector("#provider-model").value,
  };
  try {
    const settings = await api("/api/settings", { method: "PUT", body: { passwordEnabled, password, allowedIps, customProvider } });
    state.bootstrap.settings = settings;
    document.querySelector("#logout").hidden = !settings.passwordEnabled;
    renderSettings();
    showToast(settings.requiresAgentRestart ? "设置已保存；请停止并重新运行 Agent 以应用 Provider" : "设置已保存");
  } catch (error) { showError(error); }
}

async function api(path, options = {}) {
  const init = { method: options.method || "GET", headers: {} };
  if (options.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/auth/login") { showLogin(); throw new Error("登录已失效"); }
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function setPath(root, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let current = root;
  parts.forEach((part) => { if (!current[part] || typeof current[part] !== "object") current[part] = {}; current = current[part]; });
  current[last] = value;
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(value);
}

function numberOrDash(value) { return Number.isFinite(value) ? Math.round(value) : "-"; }
function safeJson(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); } }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text !== "") node.textContent = text; return node; }
function escapeText(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function showError(error) { showToast(error instanceof Error ? error.message : String(error), true); }
function showToast(message, error = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5200);
}
