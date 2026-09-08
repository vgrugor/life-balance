const BASE_PATH = '__BASE_PATH__';
const DB_NAME = 'balance-quadrants-db';
const DB_VERSION = 2;
const SIZE_WEIGHTS = { S: 1, M: 2, L: 3 };
const SIZE_LABELS = { S: 'маленька', M: 'середня', L: 'велика' };
const QUADRANTS = [
  { id: 'self-care', label: 'Я / Підтримка', color: '#b85b62' },
  { id: 'self-growth', label: 'Я / Розвиток', color: '#426b9f' },
  { id: 'world-care', label: 'Світ / Підтримка', color: '#4d7b50' },
  { id: 'world-growth', label: 'Світ / Розвиток', color: '#b4782b' }
];
const TODAY_QUADRANT_ORDER = ['self-care', 'world-care', 'world-growth', 'self-growth'];
const REPEAT_LABELS = {
  none: 'не повторюється',
  daily: 'щодня',
  weekly: 'щотижня',
  weekdays: 'у вибрані дні',
  monthly: 'щомісяця'
};
const WEEKDAY_LABELS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  tasks: [],
  plans: [],
  logs: [],
  currentView: 'today',
  historyDays: 7,
  historyFilter: 'all',
  taskFilter: 'all',
  planFilter: 'all',
  showPostponed: false,
  hideCompletedSingles: true
};

let db;
let deferredInstallPrompt;

function todayISO() {
  return toISODate(new Date());
}

function tomorrowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toISODate(date);
}

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function toISODate(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function toDateTimeLocalValue(value = new Date().toISOString()) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLocalToISO(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
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

function tx(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, 'readwrite').put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function remove(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, 'readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const request = tx('settings').get(key);
    request.onsuccess = () => resolve(request.result?.value || '');
    request.onerror = () => reject(request.error);
  });
}

function putSetting(key, value) {
  return put('settings', { key, value, updatedAt: new Date().toISOString() });
}

async function loadSheetsSettings() {
  const [appUrl, apiKey] = await Promise.all([
    getSetting('sheetsAppUrl'),
    getSetting('sheetsApiKey')
  ]);
  $('#sheetsAppUrl').value = appUrl;
  $('#sheetsApiKey').value = apiKey;
}

async function loadState() {
  const [tasks, plans, logs] = await Promise.all([getAll('tasks'), getAll('plans'), getAll('logs')]);
  state.tasks = tasks.sort((a, b) => a.title.localeCompare(b.title, 'uk'));
  state.plans = plans.sort((a, b) => a.date.localeCompare(b.date));
  state.logs = logs.sort((a, b) => b.date.localeCompare(a.date));
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id);
}

function quadrantById(id) {
  return QUADRANTS.find((quadrant) => quadrant.id === id) || QUADRANTS[0];
}

function isPostponed(task) {
  return task.hiddenUntil && task.hiddenUntil > todayISO();
}

function isRecurringOn(task, dateISO) {
  if (task.repeat === 'none') return false;
  if (task.hiddenUntil && task.hiddenUntil > dateISO) return false;
  const target = new Date(`${dateISO}T12:00:00`);
  const created = new Date(`${(task.createdAt || dateISO).slice(0, 10)}T12:00:00`);
  if (target < created) return false;
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekly') return target.getDay() === created.getDay();
  if (task.repeat === 'weekdays') return (task.repeatDays || []).map(Number).includes(target.getDay());
  if (task.repeat === 'monthly') return target.getDate() === created.getDate();
  return false;
}

function plannedItemsFor(dateISO) {
  return state.plans
    .filter((plan) => plan.date === dateISO)
    .map((plan) => ({ id: plan.id, source: 'plan', task: taskById(plan.taskId), plan }))
    .filter((item) => item.task)
    .sort((a, b) => planOrder(a) - planOrder(b));
}

function recurringSuggestionsFor(dateISO) {
  const plannedTaskIds = new Set(state.plans.filter((plan) => plan.date === dateISO).map((plan) => plan.taskId));
  return state.tasks
    .filter((task) => isRecurringOn(task, dateISO) && !plannedTaskIds.has(task.id))
    .filter((task) => state.planFilter === 'all' || task.quadrant === state.planFilter)
    .map((task) => ({ id: `suggestion-${dateISO}-${task.id}`, source: 'suggestion', task }));
}

function logFor(taskId, dateISO) {
  return state.logs.find((log) => log.taskId === taskId && log.date === dateISO);
}

function hasCompletion(taskId) {
  return state.logs.some((log) => log.taskId === taskId);
}

function isCompletedSingle(task) {
  return task.repeat === 'none' && hasCompletion(task.id);
}

function planOrder(item) {
  return Number.isFinite(item.plan?.order) ? item.plan.order : new Date(item.plan?.createdAt || 0).getTime();
}

function sizeWeight(size) {
  return SIZE_WEIGHTS[size] || 1;
}

function repeatLabel(task) {
  if (task.repeat !== 'weekdays') return REPEAT_LABELS[task.repeat] || REPEAT_LABELS.none;
  const days = (task.repeatDays || []).map(Number);
  if (!days.length) return 'у вибрані дні';
  return `у дні: ${days.map((day) => WEEKDAY_LABELS[day]).join(', ')}`;
}

function selectedRepeatDays() {
  if ($('#taskRepeat').value !== 'weekdays') return [];
  return $$('[name="repeatDay"]:checked').map((input) => Number(input.value));
}

function setSelectedRepeatDays(days) {
  const selected = new Set((days || []).map(Number));
  $$('[name="repeatDay"]').forEach((input) => {
    input.checked = selected.has(Number(input.value));
  });
}

function updateWeekdayPicker() {
  const picker = $('#weekdayPicker');
  const enabled = $('#taskRepeat').value === 'weekdays';
  picker.hidden = !enabled;
  $$('[name="repeatDay"]').forEach((input) => {
    input.disabled = !enabled;
  });
}

function ensureCreatedAtDefault() {
  if ($('#taskId').value || $('#taskCreatedAt').value) return;
  $('#taskCreatedAt').value = toDateTimeLocalValue();
}

function logsForLast(days) {
  const end = new Date(`${todayISO()}T23:59:59`);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return state.logs.filter((log) => {
    const date = new Date(`${log.date}T12:00:00`);
    return date >= start && date <= end;
  });
}

function computeBalanceFromRows(rows) {
  const totals = Object.fromEntries(QUADRANTS.map((q) => [q.id, 0]));
  for (const row of rows) totals[row.quadrant] += sizeWeight(row.size);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return QUADRANTS.map((quadrant) => ({
    ...quadrant,
    value: totals[quadrant.id],
    percent: total ? Math.round((totals[quadrant.id] / total) * 100) : 0
  }));
}

function renderQuadrantOptions() {
  const options = QUADRANTS.map((q) => `<option value="${q.id}">${q.label}</option>`).join('');
  $('#taskQuadrant').innerHTML = options;
  $('#taskFilter').innerHTML = `<option value="all">Усі квадранти</option>${options}`;
  $('#planQuadrantFilter').innerHTML = `<option value="all">Усі квадранти</option>${options}`;
}

function renderTabs() {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.currentView));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${state.currentView}`));
}

function renderTaskSelect() {
  const select = $('#planTaskSelect');
  const date = $('#planDate').value;
  const tasks = state.tasks.filter((task) => {
    if (isPostponed(task)) return false;
    if (state.planFilter !== 'all' && task.quadrant !== state.planFilter) return false;
    return !state.plans.some((plan) => plan.taskId === task.id && plan.date === date);
  });
  if (!tasks.length) {
    select.innerHTML = '<option value="">Немає справ для цього фільтра</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.title)} · ${SIZE_LABELS[task.size]}</option>`).join('');
}

function renderTasks() {
  const filtered = state.tasks.filter((task) => {
    if (!state.showPostponed && isPostponed(task)) return false;
    if (state.hideCompletedSingles && isCompletedSingle(task)) return false;
    return state.taskFilter === 'all' || task.quadrant === state.taskFilter;
  });
  $('#taskEmpty').hidden = filtered.length > 0;
  $('#taskList').innerHTML = filtered.map(renderTaskCard).join('');
}

function renderTaskCard(task) {
  const quadrant = quadrantById(task.quadrant);
  const postponed = isPostponed(task);
  const completedSingle = isCompletedSingle(task);
  return `
    <article class="card ${postponed ? 'is-postponed' : ''} ${completedSingle ? 'is-completed-single' : ''}">
      <div class="card-head">
        <div>
          <p class="title">${escapeHtml(task.title)}</p>
          <div class="meta">
            <span class="badge ${quadrant.id}">${quadrant.label}</span>
            <span class="badge">${SIZE_LABELS[task.size]}</span>
            <span class="badge">${repeatLabel(task)}</span>
            ${completedSingle ? '<span class="badge done-badge">виконано</span>' : ''}
            <span class="badge">додано ${formatDateTime(task.createdAt)}</span>
            ${postponed ? `<span class="badge">пізніше до ${formatDate(task.hiddenUntil)}</span>` : ''}
          </div>
        </div>
      </div>
      ${task.note ? `<p class="note">${escapeHtml(task.note)}</p>` : ''}
      <div class="card-actions">
        <button class="small-button" data-plan-tomorrow="${task.id}">На завтра</button>
        <button class="small-button" data-edit-task="${task.id}">Редагувати</button>
        <button class="small-button" data-postpone-task="${task.id}">${postponed ? 'Повернути' : 'Нагадати пізніше'}</button>
        <button class="small-button danger" data-delete-task="${task.id}">Видалити</button>
      </div>
    </article>
  `;
}

function renderToday() {
  const date = todayISO();
  $('#todayDate').textContent = formatDate(date);
  renderTodayList(plannedItemsFor(date), date);
}

function renderPlan() {
  const date = $('#planDate').value;
  const items = plannedItemsFor(date);
  renderPlanBalance(date);
  renderRecurringSuggestions(date);
  renderPlanList(items, date);
}

function renderPlanBalance(dateISO) {
  const recentRows = logsForLast(14);
  const planRows = plannedItemsFor(dateISO).map((item) => item.task);
  const balance = computeBalanceFromRows([...recentRows, ...planRows]);
  const lowest = [...balance].sort((a, b) => a.value - b.value)[0];
  $('#planBalance').innerHTML = balance.map((item) => `
    <button class="balance-row balance-button" type="button" data-plan-filter="${item.id}">
      <div class="balance-top">
        <span>${item.label}</span>
        <span>${item.percent}%</span>
      </div>
      <div class="bar"><span style="--value: ${item.percent}%; background: ${item.color}"></span></div>
      <div class="muted">${item.value} ваги з урахуванням плану</div>
    </button>
  `).join('');
  $('#planHint').textContent = lowest.value === 0
    ? `Підказка: у найближчій картині майже не видно “${lowest.label}”. Натисни на цей квадрант, щоб відфільтрувати базу.`
    : `Підказка: найменше зараз у “${lowest.label}”. Це не проблема, просто корисний сигнал для вибору.`;
}

function renderRecurringSuggestions(dateISO) {
  const suggestions = recurringSuggestionsFor(dateISO);
  $('#recurringEmpty').hidden = suggestions.length > 0;
  $('#recurringSuggestions').innerHTML = suggestions.map(({ task }) => {
    const quadrant = quadrantById(task.quadrant);
    return `
      <article class="card suggestion-card">
        <div class="card-head">
          <div>
            <p class="title">${escapeHtml(task.title)}</p>
            <div class="meta">
              <span class="badge ${quadrant.id}">${quadrant.label}</span>
              <span class="badge">${SIZE_LABELS[task.size]}</span>
              <span class="badge">${repeatLabel(task)}</span>
            </div>
          </div>
        </div>
        ${task.note ? `<p class="note">${escapeHtml(task.note)}</p>` : ''}
        <div class="card-actions">
          <button class="small-button" data-add-recurring="${task.id}" data-date="${dateISO}">Запланувати</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderTodayList(items, dateISO) {
  $('#todayEmpty').hidden = true;
  $('#todayList').innerHTML = TODAY_QUADRANT_ORDER.map(quadrantById).map((quadrant) => {
    const quadrantItems = items.filter((item) => item.task.quadrant === quadrant.id);
    const activeItems = quadrantItems.filter((item) => !logFor(item.task.id, dateISO)).sort((a, b) => planOrder(a) - planOrder(b));
    const doneItems = quadrantItems.filter((item) => logFor(item.task.id, dateISO)).sort((a, b) => {
      const first = logFor(a.task.id, dateISO);
      const second = logFor(b.task.id, dateISO);
      return new Date(first?.completedAt || first?.createdAt || 0) - new Date(second?.completedAt || second?.createdAt || 0);
    });
    return `
      <details class="quadrant-accordion ${quadrant.id}" ${activeItems.length ? 'open' : ''}>
        <summary class="quadrant-head">
          <span class="quadrant-dot" style="background: ${quadrant.color}"></span>
          <h3>${quadrant.label}</h3>
          <span>${quadrantItems.length}</span>
        </summary>
        <div class="stack">
          ${quadrantItems.length
            ? `${activeItems.map((item, index) => renderTodayCard(item, dateISO, {
                canMoveUp: index > 0,
                canMoveDown: index < activeItems.length - 1
              })).join('')}
              ${renderDoneTodaySection(doneItems, dateISO)}`
            : '<div class="empty compact-empty">На сьогодні тут нічого немає.</div>'}
        </div>
      </details>
    `;
  }).join('');
}

function renderDoneTodaySection(doneItems, dateISO) {
  if (!doneItems.length) return '';
  return `
    <details class="done-accordion">
      <summary class="done-divider">
        <span>Виконані:</span>
        <span>${doneItems.length}</span>
      </summary>
      <div class="stack done-stack">
        ${doneItems.map((item) => renderTodayCard(item, dateISO)).join('')}
      </div>
    </details>
  `;
}

function renderTodayCard(item, dateISO, moveState = {}) {
  const { task, plan } = item;
  const quadrant = quadrantById(task.quadrant);
  const log = logFor(task.id, dateISO);
  return `
    <article class="card today-card ${log ? 'is-done' : ''}">
      <div class="today-card-top">
        <div class="today-card-main">
          <p class="title">${escapeHtml(task.title)}</p>
          <div class="meta">
            <span class="badge ${quadrant.id}">${quadrant.label}</span>
            <span class="badge">${SIZE_LABELS[task.size]}</span>
            ${log ? '<span class="badge done-badge">виконано</span>' : ''}
            ${log ? `<span class="badge">о ${formatTime(log.completedAt || log.createdAt)}</span>` : ''}
          </div>
        </div>
        <div class="today-actions">
          ${!log ? `
            <button class="small-button order-button" ${moveState.canMoveUp ? '' : 'disabled'} data-move-plan="${plan.id}" data-direction="up" title="Вище" aria-label="Перемістити вище">↑</button>
            <button class="small-button order-button" ${moveState.canMoveDown ? '' : 'disabled'} data-move-plan="${plan.id}" data-direction="down" title="Нижче" aria-label="Перемістити нижче">↓</button>
          ` : ''}
          <button class="small-button today-toggle" data-toggle-log="${task.id}" data-date="${dateISO}">${log ? 'Повернути' : 'Готово'}</button>
        </div>
      </div>
      ${task.note ? `<p class="note">${escapeHtml(task.note)}</p>` : ''}
    </article>
  `;
}

function renderPlanList(items, dateISO) {
  $('#planEmpty').hidden = true;
  $('#planList').innerHTML = TODAY_QUADRANT_ORDER.map(quadrantById).map((quadrant) => {
    const quadrantItems = items
      .filter((item) => item.task.quadrant === quadrant.id)
      .sort((a, b) => planOrder(a) - planOrder(b));
    return `
      <details class="quadrant-accordion ${quadrant.id}" ${quadrantItems.length ? 'open' : ''}>
        <summary class="quadrant-head">
          <span class="quadrant-dot" style="background: ${quadrant.color}"></span>
          <h3>${quadrant.label}</h3>
          <span>${quadrantItems.length}</span>
        </summary>
        <div class="stack">
          ${quadrantItems.length
            ? quadrantItems.map((item, index) => renderPlanCard(item, dateISO, {
                canMoveUp: index > 0,
                canMoveDown: index < quadrantItems.length - 1
              })).join('')
            : '<div class="empty compact-empty">На цю дату тут нічого не заплановано.</div>'}
        </div>
      </details>
    `;
  }).join('');
}

function renderPlanCard(item, dateISO, moveState = {}) {
  const { task, plan } = item;
  const quadrant = quadrantById(task.quadrant);
  return `
    <article class="card plan-card">
      <div class="today-card-top">
        <div class="today-card-main">
          <p class="title">${escapeHtml(task.title)}</p>
          <div class="meta">
            <span class="badge ${quadrant.id}">${quadrant.label}</span>
            <span class="badge">${SIZE_LABELS[task.size]}</span>
            <span class="badge">ручний план</span>
          </div>
        </div>
        <div class="today-actions">
          <button class="small-button order-button" ${moveState.canMoveUp ? '' : 'disabled'} data-move-plan="${plan.id}" data-direction="up" title="Вище" aria-label="Перемістити вище">↑</button>
          <button class="small-button order-button" ${moveState.canMoveDown ? '' : 'disabled'} data-move-plan="${plan.id}" data-direction="down" title="Нижче" aria-label="Перемістити нижче">↓</button>
          <button class="small-button danger plan-remove" data-delete-plan="${plan.id}">Прибрати</button>
        </div>
      </div>
      ${task.note ? `<p class="note">${escapeHtml(task.note)}</p>` : ''}
    </article>
  `;
}

function renderOccurrenceList(listSelector, emptySelector, items, dateISO, planning = false) {
  const list = $(listSelector);
  $(emptySelector).hidden = items.length > 0;
  list.innerHTML = items.map(({ id, source, task }) => {
    const quadrant = quadrantById(task.quadrant);
    const log = logFor(task.id, dateISO);
    return `
      <article class="card">
        <div class="card-head">
          <div>
            <p class="title">${escapeHtml(task.title)}</p>
            <div class="meta">
              <span class="badge ${quadrant.id}">${quadrant.label}</span>
              <span class="badge">${SIZE_LABELS[task.size]}</span>
              <span class="badge">${source === 'repeat' ? repeatLabel(task) : 'ручний план'}</span>
              ${log ? '<span class="badge done-badge">виконано</span>' : ''}
            </div>
          </div>
        </div>
        ${task.note ? `<p class="note">${escapeHtml(task.note)}</p>` : ''}
        <div class="card-actions">
          <button class="small-button" data-toggle-log="${task.id}" data-date="${dateISO}">${log ? 'Повернути в активні' : 'Відмітити як виконане'}</button>
          ${planning && source === 'plan' ? `<button class="small-button danger" data-delete-plan="${id}">Прибрати з дати</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderHistory() {
  $$('#historyRanges .chip').forEach((button) => button.classList.toggle('active', Number(button.dataset.days) === state.historyDays));
  const logs = logsForLast(state.historyDays);
  const visibleLogs = state.historyFilter === 'all'
    ? logs
    : logs.filter((log) => log.quadrant === state.historyFilter);
  const balance = computeBalanceFromRows(logs);
  $('#balanceGrid').innerHTML = balance.map((item) => `
    <button class="balance-row balance-button ${state.historyFilter === item.id ? 'active' : ''}" type="button" data-history-filter="${item.id}">
      <div class="balance-top">
        <span>${item.label}</span>
        <span>${item.percent}%</span>
      </div>
      <div class="bar"><span style="--value: ${item.percent}%; background: ${item.color}"></span></div>
      <div class="muted">${item.value} ваги</div>
    </button>
  `).join('');
  $('#historyFilterHint').textContent = state.historyFilter === 'all'
    ? 'Показані всі виконані справи за вибраний період.'
    : `Фільтр: ${quadrantById(state.historyFilter).label}. Натисни цей квадрант ще раз, щоб показати все.`;
  $('#historyLog').innerHTML = visibleLogs.length ? visibleLogs.map((log) => {
    const quadrant = quadrantById(log.quadrant);
    return `
      <article class="card">
        <p class="title">${escapeHtml(log.title)}</p>
        <div class="meta">
          <span class="badge">${formatDate(log.date)}</span>
          <span class="badge ${quadrant.id}">${quadrant.label}</span>
          <span class="badge">${SIZE_LABELS[log.size]}</span>
          <span class="badge">виконано о ${formatTime(log.completedAt || log.createdAt)}</span>
        </div>
      </article>
    `;
  }).join('') : '<div class="empty">За цим фільтром немає відмічених справ.</div>';
}

function renderAll() {
  ensureCreatedAtDefault();
  renderTabs();
  renderTaskSelect();
  renderTasks();
  renderToday();
  renderPlan();
  renderHistory();
}

async function saveTask(event) {
  event.preventDefault();
  const existingId = $('#taskId').value;
  const existing = existingId ? taskById(existingId) : null;
  const now = new Date().toISOString();
  const repeat = $('#taskRepeat').value;
  const repeatDays = repeat === 'weekdays' && !selectedRepeatDays().length
    ? [new Date().getDay()]
    : selectedRepeatDays();
  const hiddenUntil = $('#taskPostponed').checked
    ? existing?.hiddenUntil && existing.hiddenUntil > todayISO()
      ? existing.hiddenUntil
      : addDaysISO(todayISO(), 30)
    : '';
  const task = {
    ...existing,
    id: existingId || uid('task'),
    title: $('#taskTitle').value.trim(),
    quadrant: $('#taskQuadrant').value,
    size: $('#taskSize').value,
    repeat,
    repeatDays,
    note: $('#taskNote').value.trim(),
    createdAt: dateTimeLocalToISO($('#taskCreatedAt').value),
    hiddenUntil,
    updatedAt: now
  };
  await put('tasks', task);
  resetTaskForm();
  await refresh();
}

function resetTaskForm() {
  $('#taskForm').reset();
  $('#taskId').value = '';
  $('#taskCreatedAt').value = toDateTimeLocalValue();
  $('#taskPostponed').checked = false;
  updateWeekdayPicker();
}

async function addPlanFor(taskId, date) {
  if (!taskId || !date) return;
  const exists = state.plans.some((plan) => plan.taskId === taskId && plan.date === date);
  if (exists) return;
  const task = taskById(taskId);
  const siblingOrders = plannedItemsFor(date)
    .filter((item) => item.task.quadrant === task?.quadrant)
    .map(planOrder);
  const order = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
  await put('plans', { id: uid('plan'), taskId, date, order, createdAt: new Date().toISOString() });
}

async function movePlan(planId, direction) {
  const current = state.plans.find((plan) => plan.id === planId);
  const currentTask = taskById(current?.taskId);
  if (!current || !currentTask) return;
  const activeItems = plannedItemsFor(current.date)
    .filter((item) => item.task.quadrant === currentTask.quadrant)
    .filter((item) => !logFor(item.task.id, current.date));
  const currentIndex = activeItems.findIndex((item) => item.plan.id === planId);
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= activeItems.length) return;
  const next = activeItems[nextIndex].plan;
  const currentOrder = planOrder(activeItems[currentIndex]);
  const nextOrder = planOrder(activeItems[nextIndex]);
  await Promise.all([
    put('plans', { ...current, order: nextOrder }),
    put('plans', { ...next, order: currentOrder })
  ]);
  await refresh();
}

async function addPlan(event) {
  event.preventDefault();
  await addPlanFor($('#planTaskSelect').value, $('#planDate').value);
  await refresh();
}

async function toggleLog(taskId, dateISO) {
  const existing = logFor(taskId, dateISO);
  if (existing) {
    await remove('logs', existing.id);
    await refresh();
    return;
  }
  const task = taskById(taskId);
  if (!task) return;
  const completedAt = new Date().toISOString();
  await put('logs', {
    id: uid('log'),
    taskId,
    date: dateISO,
    title: task.title,
    quadrant: task.quadrant,
    size: task.size,
    completedAt,
    createdAt: completedAt
  });
  await refresh();
}

async function refresh() {
  await loadState();
  renderAll();
}

function backupPayload() {
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    tasks: state.tasks,
    plans: state.plans,
    logs: state.logs
  };
}

async function importBackupPayload(payload) {
  if (!Array.isArray(payload.tasks) || !Array.isArray(payload.plans) || !Array.isArray(payload.logs)) {
    throw new Error('Файл не схожий на бекап цього застосунку.');
  }
  await Promise.all(['tasks', 'plans', 'logs'].map(clearStore));
  for (const task of payload.tasks) await put('tasks', task);
  for (const plan of payload.plans) await put('plans', plan);
  for (const log of payload.logs) await put('logs', log);
  await refresh();
}

async function exportJson() {
  const payload = backupPayload();
  download(`balance-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  setStatus('JSON-бекап збережено.');
}

async function importJson(file) {
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  await importBackupPayload(payload);
  setStatus('JSON-бекап імпортовано.');
}

async function getSheetsSettingsFromForm() {
  const url = normalizeSheetsUrl($('#sheetsAppUrl').value.trim());
  const key = $('#sheetsApiKey').value.trim();
  $('#sheetsAppUrl').value = url;
  await Promise.all([
    putSetting('sheetsAppUrl', url),
    putSetting('sheetsApiKey', key)
  ]);
  return { url, key };
}

function normalizeSheetsUrl(url) {
  return url.replace(/\?.*$/, '').trim();
}

async function backupToSheets() {
  const { url, key } = await getSheetsSettingsFromForm();
  if (!url || !key) {
    setStatus('Вкажи URL application і API ключ.', true);
    return;
  }

  setStatus('Відправляю backup у Google Sheets...');
  const payload = {
    key,
    savedAt: new Date().toISOString(),
    source: location.origin + location.pathname,
    data: backupPayload()
  };

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    setStatus('Backup відправлено. Через обмеження браузера відповідь Apps Script не читається, але restore покаже, чи backup збережений.', true);
  } catch (error) {
    setStatus(`Не вдалося відправити backup: ${error.message}.`, true);
  }
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

async function restoreFromSheets() {
  const { url, key } = await getSheetsSettingsFromForm();
  if (!url || !key) {
    setStatus('Вкажи URL application і API ключ.', true);
    return;
  }
  if (!confirm('Відновити дані з Google Sheets? Поточні локальні справи, плани та історію буде замінено backup-версією.')) return;

  setStatus('Завантажую backup із Google Sheets...');
  try {
    const payload = await fetchSheetsBackupJsonp(url, key);
    if (!payload?.ok || !payload.data) {
      throw new Error(payload?.error || 'Backup not found');
    }
    await importBackupPayload(payload.data);
    setStatus(`Відновлено backup від ${payload.savedAt || 'невідомої дати'}.`, true);
  } catch (error) {
    setStatus(`Не вдалося відновити backup: ${error.message}. Перевір URL, ключ і чи вже був зроблений backup у Sheets.`, true);
  }
}

async function testSheetsConnection() {
  const { url, key } = await getSheetsSettingsFromForm();
  if (!url || !key) {
    setStatus('Вкажи URL application і API ключ.', true);
    return;
  }
  setStatus('Перевіряю Google Sheets backup...');
  try {
    const payload = await fetchSheetsBackupJsonp(url, key);
    if (!payload?.ok) throw new Error(payload?.error || 'Endpoint returned an empty response');
    const counts = payload.data ? [
      `${payload.data.tasks?.length || 0} справ`,
      `${payload.data.plans?.length || 0} планів`,
      `${payload.data.logs?.length || 0} записів історії`
    ].join(', ') : 'без даних';
    setStatus(`Підключення працює. Backup від ${payload.savedAt || 'невідомої дати'}: ${counts}.`, true);
  } catch (error) {
    setStatus(`Перевірка не пройшла: ${error.message}.`, true);
  }
}

function rowsForExport() {
  const header = ['date', 'completed_at', 'title', 'quadrant', 'size', 'weight'];
  const rows = state.logs.map((log) => [
    log.date,
    log.completedAt || log.createdAt || '',
    log.title,
    quadrantById(log.quadrant).label,
    SIZE_LABELS[log.size],
    sizeWeight(log.size)
  ]);
  return [header, ...rows];
}

function toDelimited(rows, separator) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '');
    if (value.includes(separator) || value.includes('"') || value.includes('\n')) return `"${value.replaceAll('"', '""')}"`;
    return value;
  }).join(separator)).join('\n');
}

function exportCsv() {
  download(`balance-sheets-${todayISO()}.csv`, toDelimited(rowsForExport(), ','), 'text/csv;charset=utf-8');
  setStatus('CSV для Google Sheets збережено.');
}

async function copyTsv() {
  await navigator.clipboard.writeText(toDelimited(rowsForExport(), '\t'));
  setStatus('TSV скопійовано. Його можна вставити в Google Sheets.');
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function setStatus(message, sticky = false) {
  $('#backupStatus').textContent = message;
  if (sticky) return;
  window.setTimeout(() => {
    if ($('#backupStatus').textContent === message) $('#backupStatus').textContent = '';
  }, 3500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function bindEvents() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.currentView = tab.dataset.view;
      if (state.currentView === 'tasks') ensureCreatedAtDefault();
      renderAll();
    });
  });
  $('#taskForm').addEventListener('submit', saveTask);
  $('#resetTaskForm').addEventListener('click', resetTaskForm);
  $('#taskRepeat').addEventListener('change', updateWeekdayPicker);
  $('#taskFilter').addEventListener('change', (event) => {
    state.taskFilter = event.target.value;
    renderTasks();
  });
  $('#showPostponed').addEventListener('change', (event) => {
    state.showPostponed = event.target.checked;
    renderTasks();
  });
  $('#hideCompletedSingles').addEventListener('change', (event) => {
    state.hideCompletedSingles = event.target.checked;
    renderTasks();
  });
  $('#planForm').addEventListener('submit', addPlan);
  $('#planDate').addEventListener('change', renderAll);
  $('#planQuadrantFilter').addEventListener('change', (event) => {
    state.planFilter = event.target.value;
    renderPlan();
    renderTaskSelect();
  });
  $('#historyRanges').addEventListener('click', (event) => {
    const button = event.target.closest('[data-days]');
    if (!button) return;
    state.historyDays = Number(button.dataset.days);
    renderHistory();
  });
  $('#balanceGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-history-filter]');
    if (!button) return;
    state.historyFilter = state.historyFilter === button.dataset.historyFilter ? 'all' : button.dataset.historyFilter;
    renderHistory();
  });
  document.body.addEventListener('click', async (event) => {
    const planFilter = event.target.closest('[data-plan-filter]');
    const planTomorrow = event.target.closest('[data-plan-tomorrow]');
    const addRecurring = event.target.closest('[data-add-recurring]');
    const moveButton = event.target.closest('[data-move-plan]');
    const editTask = event.target.closest('[data-edit-task]');
    const postponeTask = event.target.closest('[data-postpone-task]');
    const deleteTask = event.target.closest('[data-delete-task]');
    const deletePlan = event.target.closest('[data-delete-plan]');
    const toggle = event.target.closest('[data-toggle-log]');
    if (planFilter) {
      state.planFilter = planFilter.dataset.planFilter;
      $('#planQuadrantFilter').value = state.planFilter;
      renderTaskSelect();
    }
    if (planTomorrow) {
      await addPlanFor(planTomorrow.dataset.planTomorrow, tomorrowISO());
      state.currentView = 'plan';
      $('#planDate').value = tomorrowISO();
      await refresh();
    }
    if (addRecurring) {
      await addPlanFor(addRecurring.dataset.addRecurring, addRecurring.dataset.date);
      await refresh();
    }
    if (moveButton) {
      await movePlan(moveButton.dataset.movePlan, moveButton.dataset.direction);
    }
    if (editTask) {
      const task = taskById(editTask.dataset.editTask);
      if (!task) return;
      $('#taskId').value = task.id;
      $('#taskTitle').value = task.title;
      $('#taskCreatedAt').value = toDateTimeLocalValue(task.createdAt);
      $('#taskPostponed').checked = isPostponed(task);
      $('#taskQuadrant').value = task.quadrant;
      $('#taskSize').value = task.size;
      $('#taskRepeat').value = task.repeat;
      $('#taskNote').value = task.note || '';
      setSelectedRepeatDays(task.repeatDays || []);
      updateWeekdayPicker();
      state.currentView = 'tasks';
      renderTabs();
    }
    if (postponeTask) {
      const task = taskById(postponeTask.dataset.postponeTask);
      if (!task) return;
      const hiddenUntil = isPostponed(task) ? '' : addDaysISO(todayISO(), 30);
      await put('tasks', { ...task, hiddenUntil, updatedAt: new Date().toISOString() });
      await refresh();
    }
    if (deleteTask) {
      await remove('tasks', deleteTask.dataset.deleteTask);
      await refresh();
    }
    if (deletePlan) {
      await remove('plans', deletePlan.dataset.deletePlan);
      await refresh();
    }
    if (toggle) {
      await toggleLog(toggle.dataset.toggleLog, toggle.dataset.date);
    }
  });
  $('#exportJson').addEventListener('click', exportJson);
  $('#sheetsSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await Promise.all([
      putSetting('sheetsAppUrl', $('#sheetsAppUrl').value.trim()),
      putSetting('sheetsApiKey', $('#sheetsApiKey').value.trim())
    ]);
    setStatus('Налаштування Google Sheets збережено локально на цьому пристрої.');
  });
  $('#clearSheetsSettings').addEventListener('click', async () => {
    $('#sheetsAppUrl').value = '';
    $('#sheetsApiKey').value = '';
    await Promise.all([
      putSetting('sheetsAppUrl', ''),
      putSetting('sheetsApiKey', '')
    ]);
    setStatus('Локальні налаштування Google Sheets очищено.');
  });
  $('#importJson').addEventListener('change', async (event) => {
    try {
      await importJson(event.target.files[0]);
      event.target.value = '';
    } catch (error) {
      setStatus(error.message);
    }
  });
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#copyTsv').addEventListener('click', () => copyTsv().catch(() => setStatus('Не вдалося скопіювати TSV.')));
  $('#backupToSheets').addEventListener('click', backupToSheets);
  $('#restoreFromSheets').addEventListener('click', restoreFromSheets);
  $('#testSheetsConnection').addEventListener('click', testSheetsConnection);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#installButton').hidden = false;
  });
  $('#installButton').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#installButton').hidden = true;
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register(`${BASE_PATH}sw.js`);
}

async function init() {
  renderQuadrantOptions();
  $('#planDate').value = tomorrowISO();
  $('#taskCreatedAt').value = toDateTimeLocalValue();
  bindEvents();
  db = await openDb();
  await loadSheetsSettings();
  await refresh();
  await registerServiceWorker();
}

init().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><div class="empty">Не вдалося запустити застосунок: ${escapeHtml(error.message)}</div></main>`;
});
