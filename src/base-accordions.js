const DB_NAME = 'balance-quadrants-db';
const DB_VERSION = 2;
const SIZE_LABELS = { S: 'маленька', M: 'середня', L: 'велика' };
const QUADRANTS = [
  { id: 'self-care', label: 'Я / Підтримка', color: '#b85b62' },
  { id: 'self-growth', label: 'Я / Розвиток', color: '#426b9f' },
  { id: 'world-care', label: 'Світ / Підтримка', color: '#4d7b50' },
  { id: 'world-growth', label: 'Світ / Розвиток', color: '#b4782b' }
];
const QUADRANT_ORDER = ['self-care', 'world-care', 'world-growth', 'self-growth'];
const REPEAT_LABELS = {
  none: 'не повторюється',
  daily: 'щодня',
  weekly: 'щотижня',
  weekdays: 'у вибрані дні',
  monthly: 'щомісяця'
};
const WEEKDAY_LABELS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

let lastSavedTaskId = '';
let observer;

const $ = (selector) => document.querySelector(selector);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

function todayISO() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isPostponed(task) {
  return task.hiddenUntil && task.hiddenUntil > todayISO();
}

function hasCompletion(logs, taskId) {
  return logs.some((log) => log.taskId === taskId);
}

function isCompletedSingle(task, logs) {
  return task.repeat === 'none' && hasCompletion(logs, task.id);
}

function quadrantById(id) {
  return QUADRANTS.find((quadrant) => quadrant.id === id) || QUADRANTS[0];
}

function repeatLabel(task) {
  if (task.repeat !== 'weekdays') return REPEAT_LABELS[task.repeat] || REPEAT_LABELS.none;
  const days = (task.repeatDays || []).map(Number);
  if (!days.length) return 'у вибрані дні';
  return `у дні: ${days.map((day) => WEEKDAY_LABELS[day]).join(', ')}`;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function renderTaskCard(task, logs) {
  const quadrant = quadrantById(task.quadrant);
  const postponed = isPostponed(task);
  const completedSingle = isCompletedSingle(task, logs);
  return `
    <article class="card ${postponed ? 'is-postponed' : ''} ${completedSingle ? 'is-completed-single' : ''} ${task.id === lastSavedTaskId ? 'is-recently-saved' : ''}">
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

async function renderBaseAccordions() {
  const list = $('#taskList');
  if (!list || list.querySelector('.quadrant-accordion')) return;

  const db = await openDb();
  const [tasks, logs] = await Promise.all([getAll(db, 'tasks'), getAll(db, 'logs')]);
  db.close();
  tasks.sort((a, b) => a.title.localeCompare(b.title, 'uk'));

  const showPostponed = $('#showPostponed')?.checked || false;
  const hideCompletedSingles = $('#hideCompletedSingles')?.checked ?? true;
  const visibleTasks = tasks.filter((task) => {
    if (!showPostponed && isPostponed(task)) return false;
    if (hideCompletedSingles && isCompletedSingle(task, logs)) return false;
    return true;
  });
  const empty = $('#taskEmpty');
  if (empty) {
    empty.hidden = visibleTasks.length > 0;
    empty.textContent = 'У базі немає активних справ для показу.';
  }

  observer?.disconnect();
  list.innerHTML = QUADRANT_ORDER.map(quadrantById).map((quadrant) => {
    const quadrantTasks = visibleTasks.filter((task) => task.quadrant === quadrant.id);
    const shouldOpen = quadrantTasks.some((task) => task.id === lastSavedTaskId);
    return `
      <details class="quadrant-accordion ${quadrant.id}" ${shouldOpen ? 'open' : ''}>
        <summary class="quadrant-head">
          <span class="quadrant-dot" style="background: ${quadrant.color}"></span>
          <h3>${quadrant.label}</h3>
          <span>${quadrantTasks.length}</span>
        </summary>
        <div class="stack">
          ${quadrantTasks.length
            ? quadrantTasks.map((task) => renderTaskCard(task, logs)).join('')
            : '<div class="empty compact-empty">У цьому квадранті немає активних справ.</div>'}
        </div>
      </details>
    `;
  }).join('');
  observeTaskList();
}

function ensureTaskStatus() {
  const form = $('#taskForm');
  if (!form || $('#taskFormStatus')) return;
  form.insertAdjacentHTML('beforeend', '<p class="form-status" id="taskFormStatus" role="status" aria-live="polite"></p>');
}

function setTaskFormStatus(message) {
  ensureTaskStatus();
  const status = $('#taskFormStatus');
  if (status) status.textContent = message;
}

async function markLatestTask(wasEditing) {
  const db = await openDb();
  const tasks = await getAll(db, 'tasks');
  db.close();
  const latest = tasks.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  if (!latest) return;
  lastSavedTaskId = latest.id;
  setTaskFormStatus(wasEditing ? 'Справу оновлено.' : 'Справу додано в базу.');
  const list = $('#taskList');
  if (list) list.innerHTML = '';
  await renderBaseAccordions();
}

function observeTaskList() {
  const list = $('#taskList');
  if (!list) return;
  observer = new MutationObserver(() => {
    if (!list.querySelector('.quadrant-accordion')) renderBaseAccordions();
  });
  observer.observe(list, { childList: true });
}

function initBaseAccordions() {
  ensureTaskStatus();
  const filter = $('#taskFilter');
  if (filter) filter.hidden = true;
  renderBaseAccordions();
  observeTaskList();

  $('#showPostponed')?.addEventListener('change', () => {
    const list = $('#taskList');
    if (list) list.innerHTML = '';
    renderBaseAccordions();
  });

  $('#hideCompletedSingles')?.addEventListener('change', () => {
    const list = $('#taskList');
    if (list) list.innerHTML = '';
    renderBaseAccordions();
  });

  $('#taskForm')?.addEventListener('submit', (event) => {
    const wasEditing = Boolean($('#taskId')?.value);
    window.setTimeout(() => markLatestTask(wasEditing), 250);
  }, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBaseAccordions);
} else {
  initBaseAccordions();
}
