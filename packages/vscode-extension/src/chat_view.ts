/**
 * বাংলা মন্তব্য: SupremeAI VS Code Chat Sidebar — Web, Desktop এবং Mobile অ্যাপের সাথে
 * অভিন্ন ৬টি মডেল + Auto-Routing, ৫টি সিস্টেম রোল (Persona), কাস্টম ইনস্ট্রাকশন, থিংকিং লেভেল,
 * টেম্পারেচার, ওয়েব গ্রাউন্ডিং, ভাষা (EN/বাংলা), থিম এবং চ্যাট সেশন রিয়েল-টাইমে সিঙ্ক রাখে।
 */
import * as vscode from 'vscode';
import {
  AppLanguage,
  MODEL_TIERS,
  SYSTEM_ROLES,
  ThemeMode,
  ThinkingLevel,
  buildEffectiveSystemInstruction,
  thinkingLevelToReasoningEffort,
  tierToModel,
} from './models';
import { UnifiedVsixState, VsCodeSyncEngine } from './sync_client';

const DEFAULT_GATEWAY_URL = 'https://supremeai-api-ulw0.onrender.com';

export class SupremeAIChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'supremeai.chat';
  private view: vscode.WebviewView | undefined;
  private unsubscribeSync: (() => void) | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncEngine: VsCodeSyncEngine
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview, this.syncEngine.getState());

    this.unsubscribeSync?.();
    this.unsubscribeSync = this.syncEngine.onDidChangeState((state) => {
      this.post({ type: 'sync_state', state });
    });
    webviewView.onDidDispose(() => {
      this.unsubscribeSync?.();
      this.unsubscribeSync = null;
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ready') {
        this.post({ type: 'sync_state', state: this.syncEngine.getState() });
      } else if (msg.type === 'update_options' && msg.patch && typeof msg.patch === 'object') {
        const p = msg.patch as Record<string, unknown>;
        await this.syncEngine.updateOptions({
          ...(typeof p.selectedModelId === 'string' ? { selectedModelId: p.selectedModelId } : {}),
          ...(typeof p.autoModelRouting === 'boolean'
            ? { autoModelRouting: p.autoModelRouting }
            : {}),
          ...(typeof p.activeRoleId === 'string' ? { activeRoleId: p.activeRoleId } : {}),
          ...(typeof p.customInstruction === 'string'
            ? { customInstruction: p.customInstruction }
            : {}),
          ...(p.language === 'en' || p.language === 'bn'
            ? { language: p.language as AppLanguage }
            : {}),
          ...(typeof p.thinkingLevel === 'string'
            ? { thinkingLevel: p.thinkingLevel as ThinkingLevel }
            : {}),
          ...(typeof p.temperature === 'number' ? { temperature: p.temperature } : {}),
          ...(typeof p.enableSearchGrounding === 'boolean'
            ? { enableSearchGrounding: p.enableSearchGrounding }
            : {}),
          ...(typeof p.themeMode === 'string' ? { themeMode: p.themeMode as ThemeMode } : {}),
        });
      } else if (msg.type === 'sync_now') {
        await this.syncEngine.pullNow();
        this.post({ type: 'sync_state', state: this.syncEngine.getState() });
      } else if (msg.type === 'new_session') {
        this.syncEngine.createNewSession();
      } else if (msg.type === 'select_session' && typeof msg.sessionId === 'string') {
        this.syncEngine.selectSession(msg.sessionId);
      } else if (msg.type === 'send') {
        const text = String(msg.text || '').trim();
        if (!text) return;
        const currentState = this.syncEngine.getState();
        const requestedModel = currentState.autoModelRouting
          ? 'auto'
          : tierToModel(String(msg.model || currentState.selectedModelId));

        this.post({ type: 'user', text });
        this.post({ type: 'thinking' });
        try {
          const reply = await this.callGateway(text, requestedModel, currentState);
          await this.syncEngine.recordChatTurn(text, reply, requestedModel);
          this.post({ type: 'assistant', text: reply });
        } catch (err) {
          const e = err instanceof Error ? err.message : String(err);
          this.post({ type: 'error', text: e });
        }
      } else if (msg.type === 'clear') {
        this.syncEngine.clearActiveSession();
        this.post({ type: 'cleared' });
      } else if (
        msg.type === 'secure_get' ||
        msg.type === 'secure_set' ||
        msg.type === 'secure_remove'
      ) {
        const secretKey = String(msg.key || '');
        try {
          if (msg.type === 'secure_get') {
            const value = secretKey ? await this.context.secrets.get(secretKey) : null;
            this.post({ type: 'secure_get_result', reqId: msg.reqId, value: value ?? null });
          } else if (msg.type === 'secure_set' && secretKey) {
            await this.context.secrets.store(secretKey, String(msg.value ?? ''));
          } else if (msg.type === 'secure_remove' && secretKey) {
            await this.context.secrets.delete(secretKey);
          }
        } catch {
          if (msg.type === 'secure_get') {
            this.post({ type: 'secure_get_result', reqId: msg.reqId, value: null });
          }
        }
      }
    });
  }

  private async callGateway(
    userText: string,
    model: string,
    state: UnifiedVsixState
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration('supremeai');
    const gatewayUrl = config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL);
    const apiKey = config.get<string>('apiKey', '') || process.env.SUPREMEAI_API_KEY || '';

    const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
    const history = (activeSession?.messages || []).slice(-12).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const systemContent = buildEffectiveSystemInstruction(
      state.activeRoleId,
      state.customInstruction,
      state.language
    );

    const messages = [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user', content: userText },
    ];

    const url = gatewayUrl.replace(/\/$/, '') + '/v1/chat/completions';
    const gatewayModel = tierToModel(model);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SupremeAI-Key': apiKey || 'guest',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: gatewayModel,
        messages,
        stream: false,
        temperature: state.temperature,
        max_tokens: state.maxOutputTokens,
        reasoning_effort: thinkingLevelToReasoningEffort(state.thinkingLevel),
        runConfig: {
          thinking_level: state.thinkingLevel,
          google_search: state.enableSearchGrounding,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gateway HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Invalid gateway response payload');
    }
    return content;
  }

  private post(data: unknown): void {
    this.view?.webview.postMessage(data);
  }

  private getHtml(webview: vscode.Webview, initialState: UnifiedVsixState): string {
    const nonce = getNonce();
    const initialJson = JSON.stringify({
      models: MODEL_TIERS,
      roles: SYSTEM_ROLES,
      state: initialState,
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="${initialState.language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SupremeAI Chat</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; display: flex; flex-direction: column; height: 100vh; }
    #header { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; }
    .sync-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--vscode-panel-border); cursor: pointer; background: transparent; color: var(--vscode-foreground); font-size: 10px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block; }
    .dot.guest { background: #94a3b8; }
    .dot.offline { background: #f59e0b; }
    #toolbar { display: grid; grid-template-columns: 1fr 1fr auto; gap: 5px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    #sessionbar { display: flex; gap: 5px; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    select, input[type="number"], textarea { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 4px; padding: 4px 6px; font-family: inherit; font-size: 11px; min-width: 0; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    #optionsDrawer { display: none; flex-direction: column; gap: 6px; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
    #optionsDrawer.open { display: flex; }
    .opt-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
    #messages { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .msg { padding: 8px 10px; border-radius: 6px; max-width: 100%; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
    .msg.user { background: var(--vscode-inputOption-activeBackground); align-self: flex-end; }
    .msg.assistant { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; }
    .msg.error { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
    .msg.thinking { opacity: 0.65; font-style: italic; }
    #inputbar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
    #input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; resize: none; }
  </style>
</head>
<body>
  <div id="header">
    <button id="syncBtn" class="sync-pill" title="Sync across Web, Desktop, Mobile & VS Code">
      <span id="syncDot" class="dot"></span>
      <span id="syncLabel">Synced</span>
    </button>
    <div style="display:flex;gap:4px;">
      <button id="langBtn" class="secondary" title="Switch EN / বাংলা">EN</button>
      <button id="optBtn" class="secondary" title="All Unified Options">Options</button>
    </div>
  </div>

  <div id="toolbar">
    <select id="model" title="SupremeAI Model (Synced)"></select>
    <select id="role" title="System Persona (Synced)"></select>
    <button id="clear" class="secondary">Clear</button>
  </div>

  <div id="sessionbar">
    <select id="sessionSelect" style="flex:1;" title="Synced Conversations"></select>
    <button id="newSessionBtn" class="secondary" title="New Conversation">+ New</button>
  </div>

  <div id="optionsDrawer">
    <div class="opt-row">
      <label for="thinking">Thinking Effort</label>
      <select id="thinking">
        <option value="LOW">LOW</option>
        <option value="MEDIUM">MEDIUM</option>
        <option value="HIGH">HIGH</option>
        <option value="XHIGH">XHIGH</option>
      </select>
    </div>
    <div class="opt-row">
      <label for="temperature">Temperature</label>
      <input id="temperature" type="number" min="0" max="1.5" step="0.1" style="width:72px;" />
    </div>
    <div class="opt-row">
      <label for="grounding">Web Search Grounding</label>
      <input id="grounding" type="checkbox" />
    </div>
    <div class="opt-row">
      <label for="themeMode">Theme Mode</label>
      <select id="themeMode">
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <label for="customInst">Custom Instructions (Synced)</label>
      <textarea id="customInst" rows="2" placeholder="Synced across Web, Desktop, Mobile & VS Code..."></textarea>
    </div>
  </div>

  <div id="messages"></div>

  <div id="inputbar">
    <textarea id="input" rows="2" placeholder="Ask SupremeAI..."></textarea>
    <button id="send">Send</button>
  </div>

  <script nonce="${nonce}">
    const BOOT = ${initialJson};
    const vscode = acquireVsCodeApi();
    const elModel = document.getElementById('model');
    const elRole = document.getElementById('role');
    const elSession = document.getElementById('sessionSelect');
    const elThinking = document.getElementById('thinking');
    const elTemp = document.getElementById('temperature');
    const elGrounding = document.getElementById('grounding');
    const elThemeMode = document.getElementById('themeMode');
    const elCustomInst = document.getElementById('customInst');
    const elLangBtn = document.getElementById('langBtn');
    const elOptBtn = document.getElementById('optBtn');
    const elDrawer = document.getElementById('optionsDrawer');
    const elSyncDot = document.getElementById('syncDot');
    const elSyncLabel = document.getElementById('syncLabel');
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    for (const m of BOOT.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      elModel.appendChild(opt);
    }
    for (const r of BOOT.roles) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name + ' (' + r.badge + ')';
      elRole.appendChild(opt);
    }

    let currentState = BOOT.state;
    let pendingThinkingEl = null;

    function append(cls, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function renderState(st) {
      currentState = st;
      elModel.value = st.autoModelRouting ? 'auto' : st.selectedModelId;
      elRole.value = st.activeRoleId;
      elThinking.value = st.thinkingLevel;
      elTemp.value = String(st.temperature);
      elGrounding.checked = Boolean(st.enableSearchGrounding);
      elThemeMode.value = st.themeMode;
      if (document.activeElement !== elCustomInst) {
        elCustomInst.value = st.customInstruction || '';
      }
      elLangBtn.textContent = st.language === 'bn' ? 'বাংলা' : 'EN';
      inputEl.placeholder = st.language === 'bn' ? 'SupremeAI-কে জিজ্ঞাসা করুন...' : 'Ask SupremeAI...';
      sendBtn.textContent = st.language === 'bn' ? 'পাঠান' : 'Send';

      elSyncDot.className = 'dot ' + (st.connectionStatus || 'guest');
      elSyncLabel.textContent =
        st.connectionStatus === 'live'
          ? (st.language === 'bn' ? 'লাইভ সিঙ্কড' : 'Live Synced')
          : st.connectionStatus === 'offline'
            ? 'Offline'
            : (st.language === 'bn' ? 'লোকাল মোড' : 'Guest Mode');

      elSession.innerHTML = '';
      for (const s of (st.sessions || [])) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title || 'SupremeAI Chat';
        if (s.id === st.activeSessionId) opt.selected = true;
        elSession.appendChild(opt);
      }

      if (!pendingThinkingEl) {
        const active = (st.sessions || []).find((s) => s.id === st.activeSessionId);
        messagesEl.innerHTML = '';
        for (const msg of (active?.messages || [])) {
          append(msg.role === 'user' ? 'user' : 'assistant', msg.content);
        }
      }
    }

    renderState(currentState);

    elOptBtn.addEventListener('click', () => elDrawer.classList.toggle('open'));
    document.getElementById('syncBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'sync_now' });
    });
    elLangBtn.addEventListener('click', () => {
      const next = currentState.language === 'bn' ? 'en' : 'bn';
      vscode.postMessage({ type: 'update_options', patch: { language: next } });
    });
    elModel.addEventListener('change', () => {
      const val = elModel.value;
      vscode.postMessage({
        type: 'update_options',
        patch: val === 'auto'
          ? { autoModelRouting: true }
          : { selectedModelId: val, autoModelRouting: false }
      });
    });
    elRole.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { activeRoleId: elRole.value } });
    });
    elThinking.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { thinkingLevel: elThinking.value } });
    });
    elTemp.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { temperature: Number(elTemp.value) } });
    });
    elGrounding.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { enableSearchGrounding: elGrounding.checked } });
    });
    elThemeMode.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { themeMode: elThemeMode.value } });
    });
    elCustomInst.addEventListener('change', () => {
      vscode.postMessage({ type: 'update_options', patch: { customInstruction: elCustomInst.value } });
    });
    elSession.addEventListener('change', () => {
      vscode.postMessage({ type: 'select_session', sessionId: elSession.value });
    });
    document.getElementById('newSessionBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'new_session' });
    });

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'send', text, model: elModel.value });
      inputEl.value = '';
    }
    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('clear').addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (!m) return;
      if (m.type === 'sync_state' && m.state) {
        renderState(m.state);
      } else if (m.type === 'user') {
        append('user', m.text);
      } else if (m.type === 'thinking') {
        pendingThinkingEl = append('thinking', currentState.language === 'bn' ? 'চিন্তা করছে...' : 'Thinking...');
      } else if (m.type === 'assistant') {
        if (pendingThinkingEl) { pendingThinkingEl.remove(); pendingThinkingEl = null; }
        append('assistant', m.text);
      } else if (m.type === 'error') {
        if (pendingThinkingEl) { pendingThinkingEl.remove(); pendingThinkingEl = null; }
        append('error', 'Error: ' + m.text);
      } else if (m.type === 'cleared') {
        pendingThinkingEl = null;
        messagesEl.innerHTML = '';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
