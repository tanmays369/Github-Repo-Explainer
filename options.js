'use strict';

const $ = (id) => document.getElementById(id);

const apiKey = $('apiKey');
const saveBtn = $('save');
const statusEl = $('status');
const toggleBtn = $('toggleVisibility');

async function load() {
  const { pollinationsApiKey } = await chrome.storage.local.get('pollinationsApiKey');
  apiKey.value = pollinationsApiKey || '';
}

async function save() {
  const value = apiKey.value.trim();
  await chrome.storage.local.set({ pollinationsApiKey: value });
  await chrome.storage.local.remove('pollinationsModel');
  statusEl.textContent = 'Saved.';
  statusEl.style.color = '#86efac';
  setTimeout(() => { statusEl.textContent = ''; }, 1800);
}

toggleBtn.addEventListener('click', () => {
  apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
});

saveBtn.addEventListener('click', save);
apiKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});

load();
