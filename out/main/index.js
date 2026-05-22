"use strict";
const electron = require("electron");
const Store = require("electron-store");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const openai = require("@langchain/openai");
const anthropic = require("@langchain/anthropic");
const ollama = require("@langchain/ollama");
const log = require("electron-log");
const store = new Store({
  defaults: {
    theme: "system",
    currentProjectId: null,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    windowBounds: { width: 1200, height: 800 }
  },
  schema: {
    theme: { type: "string", enum: ["light", "dark", "system"] },
    currentProjectId: { type: ["string", "null"] },
    sidebarWidth: { type: "number", minimum: 200, maximum: 500 }
  },
  clearInvalidConfig: true
});
const dbPath = path.join(electron.app.getPath("userData"), "agent-workstation.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    api_key TEXT,
    api_url TEXT,
    default_model TEXT NOT NULL,
    context_limit INTEGER NOT NULL DEFAULT 8192,
    is_active INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    tokens INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;`);
} catch (error) {
  if (!error.message.includes("duplicate column name")) {
    console.error("Failed to migrate sessions table (parent_session_id):", error);
  }
}
try {
  db.exec(`ALTER TABLE llm_providers ADD COLUMN models TEXT;`);
} catch (error) {
  if (!error.message.includes("duplicate column name")) {
    console.error("Failed to migrate llm_providers table (models):", error);
  }
}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN summary TEXT;`);
} catch (error) {
  if (!error.message.includes("duplicate column name")) {
    console.error("Failed to migrate sessions table (summary):", error);
  }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    provider_id TEXT,
    system_prompt TEXT,
    config TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    script_content TEXT NOT NULL,
    script_type TEXT NOT NULL DEFAULT 'bash',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_versions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    script_content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_type TEXT NOT NULL,
    config TEXT,
    is_connected INTEGER DEFAULT 0,
    last_health_check INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_mcp_servers (
    agent_id TEXT NOT NULL,
    mcp_server_id TEXT NOT NULL,
    PRIMARY KEY (agent_id, mcp_server_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    PRIMARY KEY (agent_id, skill_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );
`);
try {
  const projectCount = db.prepare("SELECT COUNT(*) as count FROM projects").get();
  if (projectCount && projectCount.count === 0) {
    const defaultProjectId = "default-project";
    const defaultProjectName = "默认项目";
    const defaultProjectPath = path.join(electron.app.getPath("userData"), "default-project");
    const now = Date.now();
    if (!fs.existsSync(defaultProjectPath)) {
      fs.mkdirSync(defaultProjectPath, { recursive: true });
    }
    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(defaultProjectId, defaultProjectName, defaultProjectPath, now, now);
    console.log("Successfully initialized default project:", defaultProjectId);
  }
} catch (error) {
  console.error("Failed to initialize default project:", error);
}
function encryptApiKey(apiKey) {
  if (!apiKey) return "";
  if (!electron.safeStorage.isEncryptionAvailable()) {
    throw new Error("OS safeStorage is not available on this platform.");
  }
  const encryptedBuffer = electron.safeStorage.encryptString(apiKey);
  return encryptedBuffer.toString("base64");
}
function decryptApiKey(encryptedBase64) {
  if (!encryptedBase64) return "";
  if (!electron.safeStorage.isEncryptionAvailable()) {
    throw new Error("OS safeStorage is not available on this platform.");
  }
  const buffer = Buffer.from(encryptedBase64, "base64");
  return electron.safeStorage.decryptString(buffer);
}
function createLangChainModel(payload) {
  const { apiKey, apiUrl, model, providerType } = payload;
  switch (providerType) {
    case "openai":
    case "custom": {
      const config = {
        model,
        temperature: 0,
        streaming: true
      };
      if (apiKey) config.apiKey = apiKey;
      if (apiUrl) config.configuration = { baseURL: apiUrl };
      return new openai.ChatOpenAI(config);
    }
    case "anthropic": {
      const config = {
        model,
        temperature: 0,
        streaming: true,
        maxTokens: 4096
      };
      if (apiKey) config.apiKey = apiKey;
      if (apiUrl) config.clientOptions = { baseURL: apiUrl };
      return new anthropic.ChatAnthropic(config);
    }
    case "ollama": {
      const baseUrl = apiUrl || "http://localhost:11434";
      return new ollama.ChatOllama({
        model,
        baseUrl,
        temperature: 0
      });
    }
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}
async function runLLMChat(sender, requestId, payload) {
  const { messages } = payload;
  const model = createLangChainModel(payload);
  const channel = `llm:chunk-${requestId}`;
  try {
    const stream = await model.stream(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );
    for await (const chunk of stream) {
      const content = chunk.content;
      if (content && typeof content === "string") {
        sender.send(channel, { type: "chunk", text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && "text" in block) {
            sender.send(channel, { type: "chunk", text: block.text });
          }
        }
      }
    }
    sender.send(channel, { type: "done" });
  } catch (err) {
    sender.send(channel, { type: "error", error: err.message });
    throw err;
  }
}
async function fetchOllamaModels(apiUrl) {
  const baseUrl = apiUrl || "http://localhost:11434";
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.models?.map((m) => m.name) || [];
}
function registerIpcHandlers() {
  electron.ipcMain.handle("store:get", (_, key) => store.get(key));
  electron.ipcMain.handle("store:set", (_, key, value) => store.set(key, value));
  electron.ipcMain.handle("db:getProjects", () => {
    const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    return projects.map((p) => {
      const isGit = p.path ? fs.existsSync(path.join(p.path, ".git")) : false;
      return { ...p, isGit };
    });
  });
  electron.ipcMain.handle("db:createProject", (_, name, projectPath) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, name, projectPath, now, now);
    const isGit = projectPath ? fs.existsSync(path.join(projectPath, ".git")) : false;
    return { id, name, path: projectPath, created_at: now, updated_at: now, isGit };
  });
  electron.ipcMain.handle("db:deleteProject", (_, id) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  electron.ipcMain.handle("db:getSessions", (_, projectId) => {
    return db.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId);
  });
  electron.ipcMain.handle("db:createSession", (_, projectId, name, parentSessionId, summary) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, parent_session_id, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, parentSessionId || null, summary || null, now, now);
    return { id, project_id: projectId, name, parent_session_id: parentSessionId || null, summary: summary || null, created_at: now, updated_at: now };
  });
  electron.ipcMain.handle("db:deleteSession", (_, sessionId) => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
  electron.ipcMain.handle("db:getMessages", (_, sessionId) => {
    return db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
  });
  electron.ipcMain.handle("db:saveMessage", (_, message) => {
    const { id, session_id, role, content, tokens } = message;
    const now = Date.now();
    const existing = db.prepare("SELECT id FROM messages WHERE id = ?").get(id);
    if (existing) {
      db.prepare(`
        UPDATE messages SET content = ?, tokens = ? WHERE id = ?
      `).run(content, tokens || null, id);
    } else {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at, tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, session_id, role, content, now, tokens || null);
    }
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, session_id);
    return { id, session_id, role, content, created_at: now, tokens };
  });
  electron.ipcMain.handle("db:getProviders", () => {
    const providers = db.prepare("SELECT * FROM llm_providers ORDER BY created_at DESC").all();
    return providers.map((p) => {
      let modelsList = [];
      try {
        modelsList = p.models ? JSON.parse(p.models) : [];
      } catch (err) {
        console.error("Failed to parse models for provider:", p.id, err);
      }
      return {
        ...p,
        hasKey: !!p.api_key,
        api_key: p.api_key ? "••••••••" : "",
        models: modelsList
      };
    });
  });
  electron.ipcMain.handle("db:saveProvider", (_, provider) => {
    const { id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models } = provider;
    const now = Date.now();
    const existing = db.prepare("SELECT api_key FROM llm_providers WHERE id = ?").get(id);
    let finalApiKey = null;
    if (api_key && api_key !== "••••••••") {
      finalApiKey = encryptApiKey(api_key);
    } else if (api_key === "••••••••" && existing) {
      finalApiKey = existing.api_key;
    }
    const modelsStr = models ? JSON.stringify(models) : null;
    if (is_active) {
      db.prepare("UPDATE llm_providers SET is_active = 0").run();
    }
    if (existing) {
      db.prepare(`
        UPDATE llm_providers 
        SET name = ?, provider_type = ?, api_key = ?, api_url = ?, default_model = ?, context_limit = ?, is_active = ?, models = ?, updated_at = ?
        WHERE id = ?
      `).run(name, provider_type, finalApiKey, api_url, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, id);
    } else {
      db.prepare(`
        INSERT INTO llm_providers (id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, provider_type, finalApiKey, api_url, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, now);
    }
    return { id, name, provider_type, api_url, default_model, context_limit, is_active, models, hasKey: !!finalApiKey };
  });
  electron.ipcMain.handle("db:deleteProvider", (_, id) => {
    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(id);
  });
  electron.ipcMain.handle("db:setActiveProvider", (_, id) => {
    db.prepare("UPDATE llm_providers SET is_active = 0").run();
    db.prepare("UPDATE llm_providers SET is_active = 1 WHERE id = ?").run(id);
  });
  electron.ipcMain.handle("llm:chat", async (event, requestId, payload) => {
    const { providerId, model, messages } = payload;
    const provider = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(providerId);
    if (!provider) {
      throw new Error(`LLM Provider with ID ${providerId} not found.`);
    }
    let decryptedKey = void 0;
    if (provider.api_key) {
      decryptedKey = decryptApiKey(provider.api_key);
    }
    await runLLMChat(event.sender, requestId, {
      messages,
      apiKey: decryptedKey,
      apiUrl: provider.api_url,
      model: model || provider.default_model,
      providerType: provider.provider_type
    });
  });
  electron.ipcMain.handle("llm:fetchOllamaModels", async (_, apiUrl) => {
    return await fetchOllamaModels(apiUrl);
  });
  electron.ipcMain.handle("db:selectDirectory", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
log.transports.file.level = "info";
log.transports.console.level = "debug";
log.transports.file.maxSize = 5 * 1024 * 1024;
let mainWindow = null;
function createWindow() {
  const bounds = store.get("windowBounds");
  mainWindow = new electron.BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools();
    }
    log.info("Main window ready and shown");
  });
  mainWindow.on("close", () => {
    if (mainWindow) {
      const bounds2 = mainWindow.getBounds();
      store.set("windowBounds", bounds2);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile("./dist-renderer/index.html");
  }
  log.info("Application starting...");
}
electron.app.whenReady().then(() => {
  log.info("App is ready");
  registerIpcHandlers();
  createWindow();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
