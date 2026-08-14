const state = { bootstrap: null, agent: null, selectedAdapter: null, adapterData: null, selectedMemory: null, eventSource: null, refreshTimer: null };
const views = {
  chat: ["SESSION TOBE", "长期会话"], adapters: ["AWARENESS", "Adapter 配置"],
  memory: ["PERSISTENT COGNITION", "记忆审查"], system: ["WEB ACCESS", "访问说明"],
};

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#agent-toggle").addEventListener("click", toggleAgent);
document.querySelector("#agent-abort").addEventListener("click", () => api("/api/agent/abort", { method: "POST" }).catch(showError));
document.querySelector("#composer").addEventListener("submit", sendPrompt);
document.querySelector("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); document.querySelector("#composer").requestSubmit(); }
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
  renderAgent(); renderAdapters(); renderMemoryList(); connectEvents();
  if (state.agent.processState !== "stopped") await refreshMessages();
}

function showView(name) {
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === name));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${name}`));
  document.querySelector("#view-kicker").textContent = views[name][0];
  document.querySelector("#view-title").textContent = views[name][1];
  document.querySelector("#agent-controls").hidden = name !== "chat";
}

function connectEvents() {
  state.eventSource?.close();
  const source = new EventSource("/api/events");
  state.eventSource = source;
  source.onmessage = (event) => {
    const envelope = JSON.parse(event.data);
    if (envelope.type === "agent.state") { state.agent = envelope.data; renderAgent(); }
    if (envelope.type === "agent.event") {
      const type = envelope.data?.type;
      if (["message_update", "message_end", "agent_end"].includes(type)) scheduleMessageRefresh();
    }
  };
  source.onerror = () => setStatus("recovering", "Web 连接恢复中");
}

function renderAgent() {
  const agent = state.agent || { processState: "stopped", state: null };
  const streaming = Boolean(agent.state?.isStreaming);
  const labels = { stopped: "Agent 已停止", starting: "Agent 启动中", running: streaming ? "Agent 正在回应" : "Agent 已连接", recovering: "Agent 恢复中" };
  setStatus(agent.error && agent.processState === "recovering" ? "error" : streaming ? "busy" : agent.processState, labels[agent.processState] || "状态未知");
  const toggle = document.querySelector("#agent-toggle");
  toggle.textContent = agent.desiredRunning || agent.processState !== "stopped" ? "停止 Agent" : "启动 Agent";
  toggle.disabled = ["starting", "recovering"].includes(agent.processState);
  document.querySelector("#agent-abort").hidden = !streaming;
  document.querySelector("#prompt").disabled = agent.processState !== "running";
  document.querySelector("#composer button").disabled = agent.processState !== "running";
}

function setStatus(kind, label) {
  const dot = document.querySelector("#status-dot");
  dot.className = `status-dot ${kind === "running" ? "running" : kind === "busy" ? "busy" : kind === "error" ? "error" : ""}`;
  document.querySelector("#status-label").textContent = label;
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
  field.value = "";
  try { await api("/api/agent/prompt", { method: "POST", body: { message } }); scheduleMessageRefresh(); }
  catch (error) { field.value = message; showError(error); }
}

function scheduleMessageRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => refreshMessages().catch(showError), 180);
}

async function refreshMessages() {
  const result = await api("/api/agent/messages");
  renderMessages(result.messages || []);
}

function renderMessages(messages) {
  const container = document.querySelector("#messages");
  const visible = messages.filter((message) => ["user", "assistant"].includes(message?.role));
  if (!visible.length) { container.innerHTML = '<div class="empty-state"><h2>会话已就绪</h2><p>这是固定的 tobe Session。发送第一条消息即可开始。</p></div>'; return; }
  container.replaceChildren(...visible.map((message) => {
    const item = element("article", `message ${message.role}`);
    item.append(element("div", "message-label", message.role === "user" ? "你" : "ToBe"));
    item.append(element("div", "message-body", messageText(message.content)));
    return item;
  }));
  container.scrollTop = container.scrollHeight;
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function renderAdapters() {
  const list = document.querySelector("#adapter-list");
  list.replaceChildren(...state.bootstrap.adapters.map((adapter) => {
    const button = element("button", "item-button");
    button.type = "button";
    button.dataset.id = adapter.id;
    button.append(element("strong", "", adapter.id.replace(/-adapter$/, "")));
    button.append(element("span", "", adapter.hasSchema ? `${adapter.enabled ? "已启用" : "未启用"}${adapter.autoStart ? "，自动启动" : ""}` : "缺少 schema，只读"));
    button.addEventListener("click", () => selectAdapter(adapter.id));
    return button;
  }));
}

async function selectAdapter(id) {
  document.querySelectorAll("#adapter-list .item-button").forEach((button) => button.classList.toggle("active", button.dataset.id === id));
  const editor = document.querySelector("#adapter-editor");
  editor.innerHTML = '<div class="empty-state"><h2>正在读取配置</h2><p>敏感值仅返回是否已设置。</p></div>';
  try { state.selectedAdapter = id; state.adapterData = await api(`/api/adapters/${encodeURIComponent(id)}`); renderAdapterEditor(); }
  catch (error) { editor.innerHTML = `<div class="empty-state"><h2>无法编辑</h2><p>${escapeText(error.message)}</p></div>`; }
}

function renderAdapterEditor() {
  const data = state.adapterData;
  const editor = document.querySelector("#adapter-editor");
  editor.replaceChildren();
  const heading = element("div", "editor-heading");
  const headingText = element("div"); headingText.append(element("h2", "", data.schema.title || data.id), element("p", "", "保存立即写入文件，运行实例保持当前配置。"));
  heading.append(headingText); editor.append(heading);
  const form = element("form", "config-form"); form.id = "adapter-form";
  const grid = element("div", "field-grid");
  renderSchemaProperties(grid, data.schema.properties || {}, data.config, "");
  form.append(grid);
  const actions = element("div", "editor-actions");
  const reset = element("button", "secondary", "恢复默认"); reset.type = "button"; reset.addEventListener("click", () => { state.adapterData.config = structuredClone(data.defaults); renderAdapterEditor(); });
  const save = element("button", "primary", "保存配置"); save.type = "submit";
  actions.append(reset, save); form.append(actions);
  form.addEventListener("submit", saveAdapterConfig); editor.append(form);
}

function renderSchemaProperties(parent, properties, current, prefix) {
  for (const [key, schema] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = current?.[key];
    if (schema.type === "object" && Object.keys(schema.properties || {}).length) {
      const group = element("fieldset", "field-group full"); group.append(element("legend", "", schema.title || key));
      const grid = element("div", "field-grid"); renderSchemaProperties(grid, schema.properties, value || {}, path); group.append(grid); parent.append(group); continue;
    }
    const field = element("div", `field ${schema.type === "array" || schema.type === "object" ? "full" : ""}`);
    if (schema.type === "boolean") {
      const row = element("label", "check-row"); const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(value); input.dataset.path = path; input.dataset.kind = "boolean"; row.append(input, document.createTextNode(schema.title || key)); field.append(row);
    } else {
      field.append(element("label", "", schema.title || key));
      let input;
      if (schema.type === "array" || schema.type === "object") { input = document.createElement("textarea"); input.rows = 3; input.value = JSON.stringify(value ?? (schema.type === "array" ? [] : {}), null, 2); input.dataset.kind = "json"; }
      else if (Array.isArray(schema.enum)) { input = document.createElement("select"); schema.enum.forEach((choice) => { const option = document.createElement("option"); option.value = choice; option.textContent = choice; option.selected = choice === value; input.append(option); }); input.dataset.kind = "string"; }
      else { input = document.createElement("input"); input.type = schema["x-sensitive"] ? "password" : schema.type === "integer" || schema.type === "number" ? "number" : "text"; input.value = schema["x-sensitive"] ? "" : value ?? ""; input.dataset.kind = schema.type || "string"; }
      input.dataset.path = path;
      if (schema["x-sensitive"]) {
        input.dataset.sensitive = "true"; input.placeholder = state.adapterData.sensitive[path] ? "已设置，留空则保持不变" : "未设置";
        const clearLabel = element("label", "check-row"); const clear = document.createElement("input"); clear.type = "checkbox"; clear.dataset.clearSensitive = path; clearLabel.append(clear, document.createTextNode("清除已保存的值")); const actions = element("div", "sensitive-actions"); actions.append(clearLabel); field.append(input, actions);
      } else field.append(input);
    }
    parent.append(field);
  }
}

async function saveAdapterConfig(event) {
  event.preventDefault();
  const config = structuredClone(state.adapterData.config);
  const sensitiveUpdates = {}; const clearSensitive = [];
  try {
    event.currentTarget.querySelectorAll("[data-path]").forEach((input) => {
      const path = input.dataset.path;
      if (input.dataset.sensitive === "true") { if (input.value) sensitiveUpdates[path] = input.value; return; }
      let value = input.value;
      if (input.dataset.kind === "boolean") value = input.checked;
      else if (input.dataset.kind === "integer") value = Number.parseInt(value, 10);
      else if (input.dataset.kind === "number") value = Number(value);
      else if (input.dataset.kind === "json") value = JSON.parse(value);
      setPath(config, path, value);
    });
    event.currentTarget.querySelectorAll("[data-clear-sensitive]:checked").forEach((input) => clearSensitive.push(input.dataset.clearSensitive));
    const result = await api(`/api/adapters/${encodeURIComponent(state.selectedAdapter)}`, { method: "PUT", body: { config, sensitiveUpdates, clearSensitive } });
    showToast(result.message); state.adapterData = await api(`/api/adapters/${encodeURIComponent(state.selectedAdapter)}`); renderAdapterEditor();
  } catch (error) { showError(error); }
}

function renderMemoryList() {
  const list = document.querySelector("#memory-list");
  list.replaceChildren(...state.bootstrap.memory.map((entry) => {
    const button = element("button", "item-button"); button.type = "button"; button.dataset.id = entry.id;
    button.append(element("strong", "", entry.label), element("span", "", `${entry.kind}${entry.editable ? "，可编辑" : "，只读"}${entry.exists ? "" : "，未创建"}`));
    button.addEventListener("click", () => selectMemory(entry.id)); return button;
  }));
}

async function selectMemory(id) {
  document.querySelectorAll("#memory-list .item-button").forEach((button) => button.classList.toggle("active", button.dataset.id === id));
  state.selectedMemory = await api(`/api/memory/${encodeURIComponent(id)}`); renderMemoryEditor();
}

function renderMemoryEditor() {
  const data = state.selectedMemory; const editor = document.querySelector("#memory-editor"); editor.replaceChildren();
  const heading = element("div", "editor-heading"); const text = element("div"); text.append(element("h2", "", data.label), element("p", "", data.editable ? "修改会在下一次 Agent turn 读取。" : "项目基础认知，仅供审查。")); heading.append(text); editor.append(heading);
  const form = element("form", "memory-form"); const textarea = element("textarea", "memory-text"); textarea.value = data.content; textarea.readOnly = !data.editable; textarea.setAttribute("aria-label", data.label); form.append(textarea);
  if (data.editable) { const actions = element("div", "editor-actions"); const save = element("button", "primary", "保存文本"); save.type = "submit"; actions.append(save); form.append(actions); form.addEventListener("submit", async (event) => { event.preventDefault(); try { await api(`/api/memory/${encodeURIComponent(data.id)}`, { method: "PUT", body: { content: textarea.value } }); showToast("记忆文件已保存"); } catch (error) { showError(error); } }); }
  editor.append(form);
}

async function api(path, options = {}) {
  const init = { method: options.method || "GET", headers: {} };
  if (options.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
  const response = await fetch(path, init); const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/auth/login") { showLogin(); throw new Error("登录已失效"); }
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`); return body;
}

function setPath(root, path, value) { const parts = path.split("."); const last = parts.pop(); let current = root; parts.forEach((part) => { if (!current[part] || typeof current[part] !== "object") current[part] = {}; current = current[part]; }); current[last] = value; }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text !== "") node.textContent = text; return node; }
function escapeText(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function showError(error) { showToast(error instanceof Error ? error.message : String(error), true); }
function showToast(message, error = false) { const toast = document.querySelector("#toast"); toast.textContent = message; toast.classList.toggle("error", error); toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 4200); }
