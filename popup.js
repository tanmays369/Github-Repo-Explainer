'use strict';

const $ = (id) => document.getElementById(id);

const repoLabel = $('repoLabel');
const analyzeBtn = $('analyzeBtn');
const optionsBtn = $('optionsBtn');
const hint = $('hint');
const progressEl = $('progress');
const progressText = $('progressText');
const progressLog = $('progressLog');
const resultEl = $('result');
const visualEl = $('visual');
const visualImg = $('visualImg');
const visualCaption = $('visualCaption');
const explanationEl = $('explanation');
const promptDetails = $('promptDetails');
const promptText = $('promptText');
const errorEl = $('error');

function parseGithubRepo(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const reserved = new Set([
      'orgs', 'settings', 'marketplace', 'pulls', 'issues',
      'notifications', 'explore', 'topics', 'collections',
      'sponsors', 'features', 'enterprise', 'about', 'login', 'signup',
    ]);
    if (reserved.has(parts[0].toLowerCase())) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

let currentRepo = null;

async function detectRepo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    repoLabel.textContent = 'No active tab.';
    hint.textContent = 'Open a github.com repository tab.';
    return;
  }
  const parsed = parseGithubRepo(tab.url);
  if (!parsed) {
    repoLabel.textContent = 'Not a GitHub repository page.';
    hint.textContent = 'Navigate to https://github.com/<owner>/<repo>.';
    return;
  }
  currentRepo = parsed;
  repoLabel.textContent = `${parsed.owner}/${parsed.repo}`;
  analyzeBtn.disabled = false;
  hint.textContent = '';
}

function showError(text) {
  errorEl.textContent = text;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function appendLog(text, cls) {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.classList.add(cls);
  progressLog.appendChild(li);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function setStatus(text) {
  progressText.textContent = text;
}

function startProgress() {
  progressEl.classList.remove('hidden');
  resultEl.classList.add('hidden');
  visualEl.classList.add('hidden');
  promptDetails.classList.add('hidden');
  progressLog.innerHTML = '';
  setStatus('Initializing…');
}

function stopProgress() {
  progressEl.classList.add('hidden');
}

function describeProgress(p) {
  switch (p.kind) {
    case 'thinking':
      setStatus(`Reasoning (step ${p.iter + 1})…`);
      return null;
    case 'tool-call':
      return { text: `→ ${p.name}(${p.args})` };
    case 'tool-result':
      return { text: `  ↳ ${p.name} returned ${p.length} chars`, cls: 'ok' };
    case 'tool-error':
      return { text: `  ↳ ${p.name} error: ${p.message}`, cls: 'err' };
    case 'final-text':
      setStatus('Composing explainer…');
      return { text: '✓ final text ready', cls: 'ok' };
    default:
      return null;
  }
}

async function analyze() {
  if (!currentRepo) return;
  clearError();
  analyzeBtn.disabled = true;
  startProgress();

  const portName = `analyze:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const port = chrome.runtime.connect({ name: portName });
  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.kind === 'status') {
      setStatus(msg.text);
    } else if (msg.kind === 'progress') {
      const entry = describeProgress(msg);
      if (entry) appendLog(entry.text, entry.cls);
    }
  });

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'analyze',
      owner: currentRepo.owner,
      repo: currentRepo.repo,
      portName,
    });
    if (!resp || !resp.ok) {
      throw new Error(resp?.error || 'Unknown error');
    }
    renderResult(resp);
  } catch (e) {
    showError(`Analysis failed: ${e.message || e}`);
  } finally {
    try { port.disconnect(); } catch {}
    stopProgress();
    analyzeBtn.disabled = false;
  }
}

function renderResult({ markdown, imagePrompt, imageUrl, imageError }) {
  const stripped = markdown.replace(/```pollinations-prompt[\s\S]*?```/i, '').trim();
  explanationEl.innerHTML = window.renderMarkdown(stripped);

  if (imageUrl) {
    visualImg.src = imageUrl;
    visualCaption.textContent = imagePrompt
      ? imagePrompt.length > 220 ? imagePrompt.slice(0, 217) + '…' : imagePrompt
      : '';
    visualEl.classList.remove('hidden');
  } else if (imageError) {
    appendLog(`visual: ${imageError}`, 'err');
  }

  if (imagePrompt) {
    promptText.textContent = imagePrompt;
    promptDetails.classList.remove('hidden');
  }

  resultEl.classList.remove('hidden');
}

analyzeBtn.addEventListener('click', () => {
  analyze();
});

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

detectRepo();
