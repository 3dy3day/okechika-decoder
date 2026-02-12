const cipherInput = document.getElementById('cipher-input');
const decodedInput = document.getElementById('decoded-input');
const addBtn = document.getElementById('add-btn');
const applyBtn = document.getElementById('apply-btn');
const restoreBtn = document.getElementById('restore-btn');
const searchInput = document.getElementById('search-input');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');

let defaultDict = {};
let userDict = {};
let deletedKeys = [];

async function init() {
  const resp = await fetch(chrome.runtime.getURL('dict.json'));
  defaultDict = await resp.json();
  const data = await chrome.storage.local.get(['userDict', 'deletedKeys']);
  userDict = data.userDict || {};
  deletedKeys = data.deletedKeys || [];
  renderList();
  updateCount();
}

function getMergedDict() {
  const merged = { ...defaultDict, ...userDict };
  for (const key of deletedKeys) delete merged[key];
  return merged;
}

function updateCount() {
  countEl.textContent = `${Object.keys(getMergedDict()).length} 文字`;
}

function renderList(filter = '') {
  const merged = getMergedDict();
  const entries = Object.entries(merged);
  const filtered = filter
    ? entries.filter(([k, v]) => k.includes(filter) || v.includes(filter))
    : entries;

  listEl.innerHTML = '';
  for (const [cipher, decoded] of filtered) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <span class="cipher">${cipher}</span>
      <span class="arrow">→</span>
      <span class="decoded">${decoded}</span>
      <div class="actions-right">
        <button class="icon-btn edit">&#9998;</button>
        <button class="icon-btn delete">&#10005;</button>
      </div>
    `;
    item.querySelector('.edit').addEventListener('click', () => {
      const decodedSpan = item.querySelector('.decoded');
      const actionsRight = item.querySelector('.actions-right');
      const input = document.createElement('input');
      input.className = 'edit-input';
      input.value = decoded;
      decodedSpan.replaceWith(input);
      input.focus();
      input.select();
      actionsRight.innerHTML = `
        <button class="icon-btn save">&#10003;</button>
        <button class="icon-btn cancel">&#10005;</button>
      `;
      const save = () => {
        const val = input.value.trim();
        if (val) {
          userDict[cipher] = val;
          deletedKeys = deletedKeys.filter(k => k !== cipher);
          chrome.storage.local.set({ userDict, deletedKeys });
        }
        renderList(searchInput.value);
        updateCount();
      };
      actionsRight.querySelector('.save').addEventListener('click', save);
      actionsRight.querySelector('.cancel').addEventListener('click', () => renderList(searchInput.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') renderList(searchInput.value);
      });
    });
    item.querySelector('.delete').addEventListener('click', () => {
      if (cipher in userDict) delete userDict[cipher];
      if (cipher in defaultDict && !deletedKeys.includes(cipher)) {
        deletedKeys.push(cipher);
      }
      chrome.storage.local.set({ userDict, deletedKeys });
      renderList(searchInput.value);
      updateCount();
    });
    listEl.appendChild(item);
  }
  statusEl.textContent = filter
    ? `${filtered.length} / ${entries.length} 件表示`
    : `${entries.length} 件`;
}

// Input validation
function checkInputs() {
  addBtn.disabled = !(cipherInput.value.trim() && decodedInput.value.trim());
}
cipherInput.addEventListener('input', checkInputs);
decodedInput.addEventListener('input', checkInputs);

// Add mapping
addBtn.addEventListener('click', () => {
  const cipher = cipherInput.value.trim();
  const decoded = decodedInput.value.trim();
  if (!cipher || !decoded) return;
  userDict[cipher] = decoded;
  deletedKeys = deletedKeys.filter(k => k !== cipher);
  chrome.storage.local.set({ userDict, deletedKeys });
  cipherInput.value = '';
  decodedInput.value = '';
  addBtn.disabled = true;
  cipherInput.focus();
  renderList(searchInput.value);
  updateCount();
});

decodedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !addBtn.disabled) addBtn.click();
});

// Search
searchInput.addEventListener('input', () => {
  renderList(searchInput.value.trim());
});

// Export dict
exportBtn.addEventListener('click', () => {
  const dict = getMergedDict();
  const blob = new Blob([JSON.stringify(dict, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const ts = now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `decoder_dict_${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = 'エクスポートしました';
});

// Import dict
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    let count = 0;
    for (const [k, v] of Object.entries(imported)) {
      if (typeof k === 'string' && typeof v === 'string') {
        userDict[k] = v;
        count++;
      }
    }
    chrome.storage.local.set({ userDict });
    renderList(searchInput.value);
    updateCount();
    statusEl.textContent = `${count} 件インポートしました`;
  } catch {
    statusEl.textContent = 'インポートに失敗しました';
  }
  importFile.value = '';
});

// Apply dict to page
applyBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const dict = getMergedDict();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (dict) => {
        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const orig = node.textContent;
            let out = '';
            for (const ch of orig) out += dict[ch] || ch;
            if (out !== orig) node.textContent = out;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.tagName)) return;
            for (const child of node.childNodes) walk(child);
            for (const attr of ['alt', 'title', 'placeholder']) {
              if (node.hasAttribute(attr)) {
                const val = node.getAttribute(attr);
                let out = '';
                for (const ch of val) out += dict[ch] || ch;
                if (out !== val) node.setAttribute(attr, out);
              }
            }
          }
        }
        walk(document.body);
      },
      args: [dict],
    });
    statusEl.textContent = '適用しました';
  } catch {
    statusEl.textContent = '対象外のページです';
  }
});

// Restore page
restoreBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.reload(),
    });
    statusEl.textContent = '元に戻しました';
  } catch {
    statusEl.textContent = '対象外のページです';
  }
});

init();
