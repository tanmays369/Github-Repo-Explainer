'use strict';

const POLLI_TEXT_URL = 'https://text.pollinations.ai/openai';
const POLLI_IMAGE_BASE = 'https://image.pollinations.ai';
const MCP_URL = 'https://mcp.deepwiki.com/mcp';
const DEFAULT_MODEL = 'openai';
const MCP_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_BYTES = 14_000;

const SYSTEM_PROMPT = `You are a DeepWiki-style repository explainer inside a Firefox extension.

You will be given the DeepWiki structure and contents for a public GitHub repository. Your job is to turn those into a tight, honest, architecture-first explainer.

Rules:
- Do not return JSON.
- Do not give file-by-file summaries unless they are necessary to convey architecture.
- Do not invent modules, frameworks, or behavior. If the evidence does not support a claim, omit it or call it out as uncertain.
- Do not hide uncertainty.
- Use only the evidence provided. Do not browse, do not assume.

Output format: pure Markdown with these H2 sections, in this order, even if a section is short:

## Overview
## Stack
## Architecture
## Major modules
## Entrypoints
## Dependency flow
## Runtime flow
## Data flow
## Evidence
## Uncertainties
## Open questions
## Final explanation

Use short paragraphs and bullet lists. You may include ONE Mermaid diagram inside a \`\`\`mermaid fenced block when it materially helps. Tag major claims inline in italics like *(structural)*, *(documentation)*, *(inference)*, *(uncertainty)*.

After the Final explanation section, append EXACTLY ONE fenced block of language "pollinations-prompt" containing a single concise prompt (one paragraph, no quotes, no JSON) suitable for image generation. The prompt must describe an infographic-style architecture summary including repo name, stack, major modules, dependency flow, runtime flow, and one short summary sentence. Style: clean vector infographic, dark background, soft neon accents, isometric blocks with labels, sans-serif.

Do not output anything after the pollinations-prompt block.`;

const mcpState = {
  initialized: false,
  sessionId: null,
  nextId: 1,
};

function nextRpcId() {
  return mcpState.nextId++;
}

function parseSseToJsonRpc(text) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    try {
      messages.push(JSON.parse(payload));
    } catch (_) {}
  }
  return messages;
}

async function mcpRpc(method, params, { isNotification = false } = {}) {
  const body = isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextRpcId(), method, params };

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (mcpState.sessionId) headers['Mcp-Session-Id'] = mcpState.sessionId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MCP_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const sid = resp.headers.get('Mcp-Session-Id');
  if (sid) mcpState.sessionId = sid;

  if (isNotification) return null;

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`DeepWiki MCP HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const text = await resp.text();
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  let messages;
  if (ct.includes('text/event-stream')) {
    messages = parseSseToJsonRpc(text);
  } else {
    try {
      messages = [JSON.parse(text)];
    } catch (e) {
      throw new Error(`DeepWiki MCP: non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  const reply = messages.find((m) => m && m.id === body.id);
  if (!reply) {
    throw new Error('DeepWiki MCP: no matching JSON-RPC response');
  }
  if (reply.error) {
    throw new Error(`DeepWiki MCP error ${reply.error.code}: ${reply.error.message}`);
  }
  return reply.result;
}

async function mcpInitOnce() {
  if (mcpState.initialized) return;
  await mcpRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'deepwiki-explainer-firefox', version: '0.1.0' },
  });
  try {
    await mcpRpc('notifications/initialized', {}, { isNotification: true });
  } catch (_) {}
  mcpState.initialized = true;
}

async function mcpCallTool(name, args) {
  await mcpInitOnce();
  const result = await mcpRpc('tools/call', { name, arguments: args });
  if (result && result.isError) {
    const msg = (result.content || [])
      .map((c) => c.text || '')
      .join('\n')
      .slice(0, 600);
    throw new Error(`DeepWiki tool ${name} error: ${msg}`);
  }
  if (result && Array.isArray(result.content)) {
    return result.content.map((c) => c.text ?? '').join('\n');
  }
  return JSON.stringify(result);
}

async function getPollenKey() {
  const { pollinationsApiKey } = await chrome.storage.local.get('pollinationsApiKey');
  return (pollinationsApiKey || '').trim() || null;
}

async function pollinationsChat(messages) {
  const apiKey = await getPollenKey();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const resp = await fetch(POLLI_TEXT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Pollinations HTTP ${resp.status}: ${txt.slice(0, 400)}`);
  }
  return resp.json();
}

async function pollinationsImageBlobUrl(prompt) {
  const apiKey = await getPollenKey();
  const url = new URL(`${POLLI_IMAGE_BASE}/prompt/${encodeURIComponent(prompt)}`);
  url.searchParams.set('width', '1280');
  url.searchParams.set('height', '720');
  url.searchParams.set('nologo', 'true');
  url.searchParams.set('model', 'flux');
  if (apiKey) url.searchParams.set('key', apiKey);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Pollinations image HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

function clamp(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`;
}

async function runWorkflow({ owner, repo }, onProgress) {
  const repoName = `${owner}/${repo}`.toLowerCase();

  onProgress({ kind: 'tool-call', name: 'read_wiki_structure', args: repoName });
  let structure = '';
  try {
    structure = await mcpCallTool('read_wiki_structure', { repoName });
    onProgress({ kind: 'tool-result', name: 'read_wiki_structure', length: structure.length });
  } catch (e) {
    onProgress({ kind: 'tool-error', name: 'read_wiki_structure', message: e.message });
    structure = `(unavailable: ${e.message})`;
  }

  onProgress({ kind: 'tool-call', name: 'read_wiki_contents', args: repoName });
  let contents = '';
  try {
    contents = await mcpCallTool('read_wiki_contents', { repoName });
    onProgress({ kind: 'tool-result', name: 'read_wiki_contents', length: contents.length });
  } catch (e) {
    onProgress({ kind: 'tool-error', name: 'read_wiki_contents', message: e.message });
    contents = `(unavailable: ${e.message})`;
  }

  const evidence = clamp(
    `## DeepWiki structure for ${repoName}\n\n${structure}\n\n## DeepWiki contents for ${repoName}\n\n${contents}`,
    MAX_EVIDENCE_BYTES
  );

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Repository: ${repoName}\n\nEvidence (verbatim from DeepWiki):\n\n${evidence}\n\nProduce the explainer now, following the format exactly.`,
    },
  ];

  onProgress({ kind: 'thinking' });
  const resp = await pollinationsChat(messages);
  const choice = resp.choices && resp.choices[0];
  if (!choice) throw new Error('Pollinations returned no choices');
  const final = (choice.message && choice.message.content) || '';
  onProgress({ kind: 'final-text' });

  if (!final.trim()) {
    throw new Error('Model returned empty content');
  }
  return final;
}

function extractPollinationsPrompt(markdown) {
  const re = /```pollinations-prompt\s*\n([\s\S]*?)```/i;
  const m = markdown.match(re);
  if (!m) return null;
  return m[1].trim();
}

const activePorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name || !port.name.startsWith('analyze:')) return;
  activePorts.set(port.name, port);
  port.onDisconnect.addListener(() => activePorts.delete(port.name));
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || !req.type) return false;

  if (req.type === 'analyze') {
    (async () => {
      const portName = req.portName;
      const post = (msg) => {
        if (!portName) return;
        try {
          const port = activePorts.get(portName);
          if (port) port.postMessage(msg);
        } catch (_) {}
      };

      try {
        post({ kind: 'status', text: 'Reading repository wiki…' });
        const finalMarkdown = await runWorkflow(
          { owner: req.owner, repo: req.repo },
          (p) => post({ kind: 'progress', ...p })
        );

        post({ kind: 'status', text: 'Generating visual…' });
        const imgPrompt = extractPollinationsPrompt(finalMarkdown);
        let imageUrl = null;
        let imageError = null;
        if (imgPrompt) {
          try {
            imageUrl = await pollinationsImageBlobUrl(imgPrompt);
          } catch (e) {
            imageError = e.message;
          }
        } else {
          imageError = 'Model did not produce a pollinations-prompt block.';
        }

        sendResponse({
          ok: true,
          markdown: finalMarkdown,
          imagePrompt: imgPrompt,
          imageUrl,
          imageError,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'reset-mcp') {
    mcpState.initialized = false;
    mcpState.sessionId = null;
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
