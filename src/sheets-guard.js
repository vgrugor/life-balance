const DB_NAME = 'balance-quadrants-db';
const DB_VERSION = 2;
const STORE_NAMES = ['tasks', 'plans', 'logs'];

const $ = (selector) => document.querySelector(selector);

function setStatus(message, sticky = false) {
  const status = $('#backupStatus');
  if (!status) return;
  status.textContent = message;
  if (sticky) return;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 3500);
}

function normalizeSheetsUrl(url) {
  return url.replace(/\?.*$/, '').trim();
}

function looksLikeAppsScriptExecUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(url);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('tasks')) database.createObjectStore('tasks', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('plans')) database.createObjectStore('plans', { keyPath: 'id' }).createIndex('date', 'date');
      if (!database.objectStoreNames.contains('logs')) database.createObjectStore('logs', { keyPath: 'id' }).createIndex('date', 'date');
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSheetsSettingsFromForm() {
  const db = await openDb();
  const url = normalizeSheetsUrl($('#sheetsAppUrl')?.value.trim() || '');
  const key = $('#sheetsApiKey')?.value.trim() || '';
  if ($('#sheetsAppUrl')) $('#sheetsAppUrl').value = url;
  await Promise.all([
    put(db, 'settings', { key: 'sheetsAppUrl', value: url, updatedAt: new Date().toISOString() }),
    put(db, 'settings', { key: 'sheetsApiKey', value: key, updatedAt: new Date().toISOString() })
  ]);
  db.close();
  return { url, key };
}

async function backupPayload() {
  const db = await openDb();
  const [tasks, plans, logs] = await Promise.all(STORE_NAMES.map((storeName) => getAll(db, storeName)));
  db.close();
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    tasks,
    plans,
    logs
  };
}

async function importBackupPayload(payload) {
  if (!Array.isArray(payload?.tasks) || !Array.isArray(payload?.plans) || !Array.isArray(payload?.logs)) {
    throw new Error('Backup не схожий на дані цього застосунку');
  }
  const db = await openDb();
  await Promise.all(STORE_NAMES.map((storeName) => clearStore(db, storeName)));
  for (const task of payload.tasks) await put(db, 'tasks', task);
  for (const plan of payload.plans) await put(db, 'plans', plan);
  for (const log of payload.logs) await put(db, 'logs', log);
  db.close();
}

function fetchSheetsBackupJsonp(url, key) {
  return new Promise((resolve, reject) => {
    const callbackName = `receiveBalanceBackup_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timeout'));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}key=${encodeURIComponent(key)}&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('Script load failed'));
    };
    document.body.appendChild(script);
  });
}

async function requireSheetsSettings() {
  const settings = await getSheetsSettingsFromForm();
  if (!settings.url || !settings.key) throw new Error('Вкажи URL application і API ключ');
  if (!looksLikeAppsScriptExecUrl(settings.url)) {
    throw new Error('URL application має бути Web App URL, який закінчується на /exec. URL /dev або посилання на таблицю не підійдуть');
  }
  return settings;
}

async function backupToSheets() {
  const { url, key } = await requireSheetsSettings();
  const exportedAt = new Date().toISOString();
  const data = await backupPayload();
  const payload = {
    key,
    savedAt: exportedAt,
    source: location.origin + location.pathname,
    data
  };

  setStatus('Відправляю backup у Google Sheets...');
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });

  setStatus('Запит відправлено. Перевіряю, чи backup справді збережений...');
  await wait(1500);
  const saved = await fetchSheetsBackupJsonp(url, key);
  if (!saved?.ok || !saved.data) throw new Error(saved?.error || 'Backup не знайдено після запису');
  if (saved.savedAt && saved.savedAt !== exportedAt) {
    throw new Error(`Google Sheets показує попередній backup від ${saved.savedAt}`);
  }
  setStatus(`Backup збережено в Google Sheets: ${data.tasks.length} справ, ${data.plans.length} планів, ${data.logs.length} записів історії.`, true);
}

async function restoreFromSheets() {
  const { url, key } = await requireSheetsSettings();
  if (!confirm('Відновити дані з Google Sheets? Поточні локальні справи, плани та історію буде замінено backup-версією.')) return;

  setStatus('Завантажую backup із Google Sheets...');
  const payload = await fetchSheetsBackupJsonp(url, key);
  if (!payload?.ok || !payload.data) throw new Error(payload?.error || 'Backup not found');
  await importBackupPayload(payload.data);
  setStatus(`Відновлено backup від ${payload.savedAt || 'невідомої дати'}. Перезавантажую застосунок...`, true);
  window.setTimeout(() => window.location.reload(), 800);
}

async function testSheetsConnection() {
  const { url, key } = await requireSheetsSettings();
  setStatus('Перевіряю Google Sheets backup...');
  const payload = await fetchSheetsBackupJsonp(url, key);
  if (!payload?.ok) throw new Error(payload?.error || 'Endpoint returned an empty response');
  const counts = payload.data ? [
    `${payload.data.tasks?.length || 0} справ`,
    `${payload.data.plans?.length || 0} планів`,
    `${payload.data.logs?.length || 0} записів історії`
  ].join(', ') : 'без даних';
  setStatus(`Підключення працює. Backup від ${payload.savedAt || 'невідомої дати'}: ${counts}.`, true);
}

const actions = {
  backupToSheets,
  restoreFromSheets,
  testSheetsConnection
};

document.addEventListener('click', async (event) => {
  const button = event.target.closest('#backupToSheets, #restoreFromSheets, #testSheetsConnection');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    await actions[button.id]();
  } catch (error) {
    setStatus(`Google Sheets: ${error.message}. Перевір Web App доступ: Execute as me, Who has access: Anyone, і URL має закінчуватися на /exec.`, true);
  }
}, true);
