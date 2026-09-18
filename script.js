// ── HELPERS: SAFETY ──────────────────────────────────────────
// Corrupted localStorage shouldn't take down the app — check shape, not just parse.
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      console.warn(`GetItDone: "${key}" was not a list, using fallback.`);
      return fallback;
    }
    return parsed;
  } catch (e) {
    console.warn(`GetItDone: corrupted data in "${key}", using fallback.`, e);
    return fallback;
  }
}
function findProjectById(id) {
  for (const p of projects) {
    if (p.id === id) return p;
  }
  return undefined;
}

// Old saved projects can have pure black or white — invisible against the bg. Fall back to blue.
function getAccentColor(project) {
  const color = project.color || '#5B9CF6';
  const upper = color.toUpperCase();
  if (upper === '#000000' || upper === '#FFFFFF') {
    return 'var(--accent)';
  }
  return color;
}
function esc(s) {
  const safeValue = (s === null || s === undefined) ? '' : s;
  return String(safeValue).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function starIcon(filled) {
  return filled
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6l2.9 6.4 6.9.6-5.2 4.6 1.6 6.8-6.2-3.7-6.2 3.7 1.6-6.8-5.2-4.6 6.9-.6z"/></svg>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.6l2.9 6.4 6.9.6-5.2 4.6 1.6 6.8-6.2-3.7-6.2 3.7 1.6-6.8-5.2-4.6 6.9-.6z"/></svg>`;
}

// ── STATE ─────────────────────────────────────────────────────
// Drop empty blocks. Doubles as a guard — bad saved data shouldn't crash the render.
function cleanBlocks(p) {
  if (!Array.isArray(p.blocks)) {
    p.blocks = [];
    return p;
  }
  const cleaned = [];
  for (const b of p.blocks) {
    if (b && typeof b.text === 'string' && b.text.trim() !== '') {
      cleaned.push(b);
    }
  }
  p.blocks = cleaned;
  return p;
}

// One bad entry (a null, a stray string) shouldn't take out the whole list.
function loadProjects(key) {
  const saved = loadJSON(key, []);
  const projectList = [];
  for (const p of saved) {
    if (p && typeof p === 'object') {
      projectList.push(cleanBlocks(p));
    }
  }
  return projectList;
}

let projects = loadProjects('gid-projects');
let doneProjects = loadProjects('gid-done');
let editingId = null;
let draftWarningShown = false; // so a failing draft save only warns once per editor session
let activeGoalTab = 'all'; // 'all' or goal index as string

function updateGoalTabs() {
  const blocks = Array.from(document.querySelectorAll('#editorBlocks .block-row'));
  const goals = blocks.filter(b => b.dataset.type === 'section').map(b => b.querySelector('.block-input').value || 'Goal');
  const tabsEl = document.getElementById('editorGoalTabs');
  if (goals.length < 2) { tabsEl.classList.add('hidden'); activeGoalTab = 'all'; showAllBlocks(); return; }
  tabsEl.classList.remove('hidden');
  tabsEl.innerHTML = `<button class="editor-goal-tab ${activeGoalTab==='all'?'active':''}" data-idx="all">All</button>` +
    goals.map((g, i) => `
      <span class="editor-goal-tab-wrap">
        <button class="goal-tab-arrow" data-move="${i},-1" ${i===0?'disabled':''} title="Move left" aria-label="Move goal left">‹</button>
        <button class="editor-goal-tab ${activeGoalTab==i?'active':''}" data-idx="${i}">${esc(g.toUpperCase()) || `GOAL ${i+1}`}</button>
        <button class="goal-tab-arrow" data-move="${i},1" ${i===goals.length-1?'disabled':''} title="Move right" aria-label="Move goal right">›</button>
      </span>
    `).join('');
  applyGoalFilter();

  tabsEl.querySelectorAll('.editor-goal-tab').forEach(tab => {
    tab.addEventListener('click', () => setGoalTab(tab.dataset.idx === 'all' ? 'all' : parseInt(tab.dataset.idx)));
  });
  tabsEl.querySelectorAll('.goal-tab-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      const [fromIdx, dir] = btn.dataset.move.split(',').map(Number);
      reorderGoalBlocks(fromIdx, fromIdx + dir);
    });
  });

}

function reorderGoalBlocks(fromIdx, toIdx) {
  const container = document.getElementById('editorBlocks');
  const rows = Array.from(container.querySelectorAll('.block-row'));
  // Group blocks by goal
  const groups = [];
  let current = [];
  rows.forEach(row => {
    if (row.dataset.type === 'section') {
      if (current.length) groups.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  });
  if (current.length) groups.push(current);
  [groups[fromIdx], groups[toIdx]] = [groups[toIdx], groups[fromIdx]];
  groups.flat().forEach(row => container.appendChild(row));
  activeGoalTab = toIdx;
  updateNums();
  saveDraft();
}

function setGoalTab(idx) {
  activeGoalTab = idx;
  updateGoalTabs();
};

function showAllBlocks() {
  document.querySelectorAll('#editorBlocks .block-row').forEach(b => b.style.display = '');
}

function applyGoalFilter() {
  if (activeGoalTab === 'all') { showAllBlocks(); return; }
  const blocks = document.querySelectorAll('#editorBlocks .block-row');
  let gCount = -1, show = false;
  blocks.forEach(b => {
    if (b.dataset.type === 'section') { gCount++; show = gCount == activeGoalTab; }
    b.style.display = show ? '' : 'none';
  });
}
let selectedTaskText = null;
let currentProjectPageId = null;
let editorReturnPage = 'home';
let editorReturnPid = null;
const cardGoalTabs = {}; // pid -> goal index or 'all'

let selectedColor = '#5B9CF6';

document.getElementById('colorPickerToggle').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('colorPicker').classList.toggle('open');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#colorPickerToggle') && !e.target.closest('#colorPicker')) {
    const colorPickerEl = document.getElementById('colorPicker');
    if (colorPickerEl) colorPickerEl.classList.remove('open');
  }
});

function updatePaintSwatch(color) {
  const swatch = document.getElementById('paintSwatch');
  if (swatch) swatch.style.background = color;
}

document.querySelectorAll('.color-pick-btn').forEach(b => b.addEventListener('click', () => {
  selectedColor = b.dataset.color;
  document.querySelectorAll('.color-pick-btn').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected');
  updatePaintSwatch(selectedColor);
  const wrap = document.querySelector('.editor-wrap');
  wrap.style.setProperty('--card-accent', selectedColor);
  saveDraft();
}));
let undoStack = [];

// Short message at the bottom of the screen, for things that fail quietly like a save.
function showSaveError(message) {
  let bar = document.getElementById('saveErrorBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'saveErrorBar';
    bar.className = 'save-error-bar';
    document.body.appendChild(bar);
  }
  bar.textContent = message;
  bar.classList.add('visible');
  clearTimeout(showSaveError.timer);
  showSaveError.timer = setTimeout(() => bar.classList.remove('visible'), 6000);
}

function save() {
  projects.forEach(cleanBlocks);
  // Snapshot both — half a write loses the project from the active list AND the archive.
  const previousProjects = localStorage.getItem('gid-projects');
  const previousDone = localStorage.getItem('gid-done');
  try {
    localStorage.setItem('gid-projects', JSON.stringify(projects));
    localStorage.setItem('gid-done', JSON.stringify(doneProjects));
  } catch (e) {
    console.warn('GetItDone: could not save (storage full or blocked).', e);
    // Roll back so the two keys stay in agreement with each other.
    try {
      if (previousProjects === null) localStorage.removeItem('gid-projects');
      else localStorage.setItem('gid-projects', previousProjects);
      if (previousDone === null) localStorage.removeItem('gid-done');
      else localStorage.setItem('gid-done', previousDone);
    } catch (rollbackError) {
      console.warn('GetItDone: rollback also failed.', rollbackError);
    }
    showSaveError("Couldn't save — your browser storage may be full. Recent changes won't be kept.");
  }
  updateSidebarProjects();
}

// ── HELPERS ───────────────────────────────────────────────────
function getTasks(p) { return (p.blocks||[]).filter(b => b.type === 'step'); }
function getDoneCount(p) { return getTasks(p).filter(t => t.done).length; }
// The task after this one, pre-rendered off to the right so it can slide in.
function getNextTask(p, current) {
  const tasks = getTasks(p);
  const start = tasks.indexOf(current);
  if (start === -1) return null;
  for (let i = start + 1; i < tasks.length; i++) {
    if (!tasks[i].done) return tasks[i];
  }
  // Wrap around to anything still undone before it.
  for (let i = 0; i < start; i++) {
    if (!tasks[i].done) return tasks[i];
  }
  return null;
}

function getCurrentTask(p) {
  const tasks = getTasks(p);
  if (!tasks.length) return null;
  // Always the first still-undone task — nothing stateful to drift out of sync.
  for (let i = 0; i < tasks.length; i++) {
    if (!tasks[i].done) return tasks[i];
  }
  return null; // everything done
}

// Flat block list → goals, their phases, their tasks.
function groupBlocks(p) {
  const goals = [];
  let goal = null, phase = null;
  (p.blocks || []).forEach((b, i) => {
    if (b.type === 'section') {
      goal = { name: b.text, phases: [], loose: [], blockIndex: i };
      goals.push(goal);
      phase = null;
    } else if (b.type === 'phase') {
      phase = { name: b.text, tasks: [], blockIndex: i };
      if (goal) goal.phases.push(phase);
    } else if (b.type === 'step') {
      const task = { text: b.text, done: !!b.done, blockIndex: i };
      if (phase) phase.tasks.push(task);
      else if (goal) goal.loose.push(task);
    }
  });
  return goals;
}

// A goal's tasks, phases included — loose ones first, which is also document order.
function goalTasks(g) {
  return [...g.loose, ...g.phases.flatMap(ph => ph.tasks)];
}

// The tree the timeline draws from, tallied at each level.
function getProjectTimeline(p) {
  const blocks = p.blocks || [];
  const curTask = getCurrentTask(p);
  const curIndex = curTask ? blocks.indexOf(curTask) : -1;

  const goals = groupBlocks(p);

  // Tally each level and mark where the next-to-do task sits.
  goals.forEach(g => {
    const all = goalTasks(g);
    g.taskTotal = all.length;
    g.taskDone = all.filter(t => t.done).length;
    g.done = g.taskTotal > 0 && g.taskDone >= g.taskTotal;
    g.current = all.some(t => t.blockIndex === curIndex);
    g.phases.forEach(ph => {
      ph.taskTotal = ph.tasks.length;
      ph.taskDone = ph.tasks.filter(t => t.done).length;
      ph.done = ph.taskTotal > 0 && ph.taskDone >= ph.taskTotal;
      ph.current = ph.tasks.some(t => t.blockIndex === curIndex);
    });
  });

  let curGoalIdx = goals.findIndex(g => g.current);
  // If nothing is "current" (all done), point at the last goal.
  if (curGoalIdx === -1 && goals.length) curGoalIdx = goals.length - 1;

  return { goals, curGoalIdx };
}

// The timeline bar: goal dots on a track, progress fill underneath, labels around it.
function renderTimeline(p, accentColor) {
  const tl = getProjectTimeline(p);
  if (!tl.goals.length) return '';

  const N = tl.goals.length;
  // First dot at the left, last one short of the right end — 100% is the finish line.
  const dotAt = (gi) => (gi / N) * 100;
  // A goal's span runs from its own dot to the next one's.
  const spanStart = (gi) => dotAt(gi);
  const spanEnd = (gi) => (gi < N - 1) ? dotAt(gi + 1) : 100;
  const dotPos = tl.goals.map((g, gi) => dotAt(gi));

  const curGoal = tl.goals[tl.curGoalIdx] || tl.goals[0];
  const curPhase = curGoal ? curGoal.phases.find(ph => ph.current) : null;
  const curDotPos = dotPos[tl.curGoalIdx] != null ? dotPos[tl.curGoalIdx] : dotPos[0];
  // Phase label centers between the current goal's dot and the next marker.
  const nextDotPos = dotPos[tl.curGoalIdx + 1] != null ? dotPos[tl.curGoalIdx + 1] : 100;
  const curPhaseCenter = (curDotPos + nextDotPos) / 2;

  const dotsHtml = tl.goals.map((g, i) => {
    const cls = g.done ? 'done' : (i === tl.curGoalIdx ? 'current' : 'up');
    return `<span class="tl-dot ${cls}" style="left:${dotPos[i]}%" aria-hidden="true"></span>`;
  }).join('');

  // Fills up to the first undone task — out-of-order checks won't light it past a gap.
  const orderedTasks = getTasks(p);
  let climbReach = 0;                    // # of contiguously-completed tasks from start
  for (let i = 0; i < orderedTasks.length; i++) {
    if (orderedTasks[i].done) climbReach++;
    else break;
  }

  // How much of the climb falls inside each goal's slice.
  const fillPieces = [];
  let taskCursor = 0;                    // running index into orderedTasks
  tl.goals.forEach((g, gi) => {
    const gStart = spanStart(gi);
    const gEnd = spanEnd(gi);
    const spanW = gEnd - gStart;
    const gTotal = g.taskTotal;
    // How many of this goal's tasks are within the contiguous climb reach.
    const climbedHere = Math.max(0, Math.min(gTotal, climbReach - taskCursor));
    taskCursor += gTotal;

    if (gTotal > 0 && climbedHere >= gTotal) {
      // Whole goal climbed in order → blue segment.
      fillPieces.push({ from: gStart, to: gEnd, width: spanW, kind: 'goal' });
    } else if (climbedHere > 0) {
      // Partway up this goal → green grows from its dot toward the next.
      const ratio = climbedHere / gTotal;
      fillPieces.push({ from: gStart, to: gStart + spanW * ratio, width: spanW * ratio, kind: 'phase' });
    }
  });

  const EPS = 0.01;
  const fillsHtml = fillPieces.map((p, idx) => {
    // Round outer ends; adjacent goal fills butt together so a run reads continuous.
    const joinsLeft = fillPieces.some(q => q !== p && Math.abs(q.to - p.from) < EPS);
    const joinsRight = fillPieces.some(q => q !== p && Math.abs(q.from - p.to) < EPS);
    const cls = 'tl-fill tl-fill-' + p.kind + (!joinsLeft ? ' round-l' : '') + (!joinsRight ? ' round-r' : '');
    // Keyed by start position, not colour, so a completing goal recolours in place.
    const key = '@' + p.from.toFixed(2);
    return `<div class="${cls}" data-fill="${key}" style="left:${p.from}%;width:${p.width}%;"></div>`;
  }).join('');

  // Where wireTimeline puts the two labels once it can measure them.
  const labelData = esc(JSON.stringify({
    curGoal: curGoal ? curGoal.name : '', curGoalPos: curDotPos,
    curPhase: curPhase ? curPhase.name : '', curPhasePos: curPhaseCenter
  }));

  const goalLabelInit = curGoal ? `class="tl-goal-label show no-anim" style="left:${curDotPos}%"` : `class="tl-goal-label"`;
  const phaseLabelInit = curPhase ? `class="tl-phase-label show no-anim" style="left:${curPhaseCenter}%"` : `class="tl-phase-label"`;

  return `
    <div class="tl-wrap" style="--card-accent:${accentColor}" data-labels="${labelData}">
      <span ${goalLabelInit} aria-hidden="true">${curGoal ? esc(curGoal.name) : ''}</span>
      <div class="tl-bar">
        ${fillsHtml}
        ${dotsHtml}
      </div>
      <span ${phaseLabelInit} aria-hidden="true">${curPhase ? esc(curPhase.name) : ''}</span>
    </div>`;
}


function id() { return Math.random().toString(36).slice(2); }

// ── NAVIGATION ────────────────────────────────────────────────
function showPage(id) {
  hideEditorIfOpen();
  if (typeof closeSidebarOnMobile === 'function') closeSidebarOnMobile();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageToShow = document.getElementById('page-' + id);
  if (pageToShow) pageToShow.classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  document.querySelectorAll('.nav-item[data-project]').forEach(b => b.classList.remove('active'));
  currentProjectPageId = null;
  updateSidebarProjects();
  if (id === 'home') renderProjectsGrid();
  if (id === 'account') renderAccount();
  if (id === 'gotitdone') renderDone();
}

function showProjectPage(pid) {
  hideEditorIfOpen();
  if (typeof closeSidebarOnMobile === 'function') closeSidebarOnMobile();
  selectedTaskText = null; // a task selected while browsing a different project should never leak in here
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-project').classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-project]').forEach(b => b.classList.remove('active'));
  const navItemToHighlight = document.querySelector(`.nav-item[data-project="${pid}"]`);
  if (navItemToHighlight) navItemToHighlight.classList.add('active');
  currentProjectPageId = pid;
  renderProjectPage(pid);
}

const projectPageMode = {};
function setProjectPageMode(pid, mode) {
  projectPageMode[pid] = mode;
  renderProjectPage(pid);
};

function renderProjectPage(pid) {
  const p = findProjectById(pid);
  const el = document.getElementById('projectPageContent');
  if (!p || !el) return;

  const tasks = getTasks(p);
  const done = getDoneCount(p);
  const pct = tasks.length ? Math.round((done/tasks.length)*100) : 0;
  // Focus always shows the first still-undone task, so it can't drift out of sync.
  const cur = getCurrentTask(p);

  const nextTask = cur ? getNextTask(p, cur) : null;
  const savedTab = cardGoalTabs[pid];
  const activeTab = (savedTab === undefined || savedTab === null) ? 'all' : savedTab;
  const mode = projectPageMode[pid] || 'focus';

  const accentColor = getAccentColor(p);

  const goals = (p.blocks||[]).filter(b => b.type === 'section');
  const tabsHtml = goals.length >= 2 ? `
    <div class="card-goal-tabs card-goal-tabs-project-page">
      <button class="card-goal-tab ${activeTab==='all'?'active':''}" onclick="setProjectPageTab('${pid}','all')">All</button>
      ${goals.map((g,i) => `<button class="card-goal-tab ${activeTab==i?'active':''}" onclick="setProjectPageTab('${pid}',${i})">${esc(g.text) || `Goal ${i+1}`}</button>`).join('')}
    </div>` : '';

  document.getElementById('projectPageBack').innerHTML = 
    `<button class="project-page-back" onclick="showPage('home')">‹ Projects</button>`;

  const focusHtml = cur ? `
    <div class="focus-view">
      <div class="focus-content">
        ${renderTimeline(p, accentColor)}
        <div class="focus-stage" style="--card-accent:${accentColor}">
          <div class="focus-track">
            <div class="focus-slot"><div class="focus-task-text">${esc(cur.text)}</div></div>
            ${nextTask ? `<div class="focus-slot focus-slot-next"><div class="focus-task-text">${esc(nextTask.text)}</div></div>` : ''}
          </div>
        </div>
      </div>
      <div class="focus-actions">
        <div class="focus-action-bar" style="--card-accent:${accentColor}">
          <button class="focus-done-btn" onclick="focusCompleteTask('${pid}',${p.blocks.indexOf(cur)})">Done</button>
        </div>
        <div class="focus-kbd-hint"><kbd>space</kbd> done</div>
      </div>
    </div>` : `<div class="focus-empty">${tasks.length ? 'All tasks done' : 'No tasks yet'}</div>`;

  const checklistHtml = `
    ${tabsHtml}
    ${renderConvexBody(p, activeTab)}`;

  el.innerHTML = `
    <div class="project-page-body">
      <div class="pp-band" style="background:${accentColor}; --card-accent:${accentColor}">
        <span class="pp-band-name">${esc(p.name)}</span>
        <div class="pp-band-right">
          <div class="pp-mode-toggle">
            <button class="pp-mode-btn ${mode==='focus'?'active':''}" onclick="setProjectPageMode('${pid}','focus')">Focus</button>
            <button class="pp-mode-btn ${mode==='checklist'?'active':''}" onclick="setProjectPageMode('${pid}','checklist')">Checklist</button>
          </div>
          <button class="pp-band-edit" onclick="openEditor('${pid}')" title="Edit" aria-label="Edit project">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 14 14"><path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z"/></svg>
          </button>
        </div>
      </div>
      <div class="pp-inner">
        ${mode === 'focus' ? '' : `<div class="pp-progress-line"><div class="pp-progress-fill" style="width:${pct}%;background:${accentColor}"></div></div>`}
        ${mode === 'focus' ? focusHtml : checklistHtml}
      </div>
    </div>
  `;

  wireTimeline(el);
}

// Places the two labels, and grows fills from their last width instead of replaying.
function wireTimeline(el) {
  wireTimeline._widths = wireTimeline._widths || {};
  const wrap = el.querySelector('.tl-wrap');
  if (!wrap) return;
  const bar = wrap.querySelector('.tl-bar');
  const goalEl = wrap.querySelector('.tl-goal-label');
  const phaseEl = wrap.querySelector('.tl-phase-label');
  if (!bar || !goalEl || !phaseEl) return;

  // Grow, don't replay: start each fill at last render's width and let CSS carry it.
  const pid = currentProjectPageId || '';
  const prev = wireTimeline._widths[pid] || {};
  const nextWidths = {};
  const fills = Array.from(bar.querySelectorAll('.tl-fill'));
  // Set the "from" state now, flip to "to" next frame. Needs a real rAF or it snaps.
  const pending = [];
  fills.forEach(f => {
    const key = f.dataset.fill;
    const target = f.style.width;               // the new width, as a % string
    const isGoal = f.classList.contains('tl-fill-goal');   // blue vs green
    nextWidths[key] = { width: target, goal: isGoal };
    const was = prev[key];

    let fromWidth = null, fromColor = null;
    if (was === undefined) {
      fromWidth = '0%';                         // brand-new fill grows from zero
    } else if (was.width !== target) {
      fromWidth = was.width;                    // grow from previous width
    }
    if (was !== undefined && was.goal !== isGoal) {
      fromColor = was.goal ? 'var(--accent)' : 'var(--success)';   // recolour crossfade
    }
    if (fromWidth !== null || fromColor !== null) {
      if (fromWidth !== null) f.style.width = fromWidth;
      if (fromColor !== null) f.style.backgroundColor = fromColor;
      pending.push({ f, target, recolor: fromColor !== null });
    }
  });
  wireTimeline._widths[pid] = nextWidths;

  const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn => setTimeout(fn, 16));

  if (pending.length) {
    raf(() => raf(() => {
      pending.forEach(({ f, target, recolor }) => {
        f.style.width = target;
        if (recolor) f.style.backgroundColor = '';   // → class colour, transitions
      });
    }));
  }

  let data;
  try { data = JSON.parse(wrap.dataset.labels); } catch (e) { return; }
  if (!data) return;

  // Center a label on `pct`, then clamp it so a long name can't clip off the bar.
  function place(elm, text, pct, instant) {
    elm.textContent = text;
    elm.className = (elm === goalEl ? 'tl-goal-label' : 'tl-phase-label') + (text ? ' show' : '') + (instant ? ' no-anim' : '');
    if (!text) return;
    const barW = bar.getBoundingClientRect().width || 1;
    const half = (elm.getBoundingClientRect().width / 2);
    const halfPct = (half / barW) * 100;
    let clamped = pct;
    if (clamped - halfPct < 0) clamped = halfPct;
    if (clamped + halfPct > 100) clamped = 100 - halfPct;
    elm.style.left = clamped + '%';
  }

  function showCurrent() {
    place(goalEl, data.curGoal, data.curGoalPos, true);
    place(phaseEl, data.curPhase, data.curPhasePos, true);
  }

  // Display-only bar. Defer a frame so the labels can measure before being placed.
  raf(showCurrent);
}

function setProjectPageTab(pid, tab) {
  cardGoalTabs[pid] = tab;
  renderProjectPage(pid);
};

function doneTaskPage(pid, blockIndex) {
  doneTask(pid, blockIndex);
  renderProjectPage(pid);
};

// Grow the on-screen fill without re-rendering, so it moves in sync with the checkmark.
function growTimelineNow(pid) {
  const el = document.getElementById('projectPageContent');
  const p = findProjectById(pid);
  if (!el || !p) return;
  const bar = el.querySelector('.tl-bar');
  if (!bar) return;
  // Swap fresh timeline markup into the existing wrapper, then re-wire it.
  const wrap = el.querySelector('.tl-wrap');
  if (!wrap) return;
  const accent = getComputedStyle(wrap).getPropertyValue('--card-accent').trim() || 'var(--accent)';
  const fresh = renderTimeline(p, accent);
  if (!fresh) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = fresh;
  const newWrap = tmp.firstElementChild;
  wrap.parentNode.replaceChild(newWrap, wrap);
  wireTimeline(el);
}

function focusCompleteTask(pid, blockIndex) {
  const taskEl = document.querySelector('.focus-task-text');
  const doneBtn = document.querySelector('.focus-done-btn');
  // If the animation elements aren't on screen, just complete the task directly.
  if (!taskEl || !doneBtn) { doneTaskPage(pid, blockIndex); return; }
  // Disable it so a second click can't land while the animation plays.
  const color = doneBtn.style.background || 'var(--accent)';
  doneBtn.disabled = true;
  doneBtn.classList.add('pulsed');
  const burst = document.createElement('div');
  burst.className = 'focus-check-burst';
  burst.innerHTML = `<div class="focus-check-burst-circle" style="background:${color}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><polyline points="5,13 10,18 19,7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  const focusContentEl = document.querySelector('.focus-content');
  if (focusContentEl) focusContentEl.appendChild(burst);
  // The last task finishes the project, so take the plain path; otherwise grow now.
  const p = findProjectById(pid);
  const isLast = p && (getDoneCount(p) + 1 >= getTasks(p).length);
  if (isLast) {
    setTimeout(() => { advanceFocusTrack(() => doneTaskPage(pid, blockIndex)); }, 120);
    return;
  }
  doneTask(pid, blockIndex, false, true);   // suppressRender=true: don't rebuild the card yet
  growTimelineNow(pid);
  setTimeout(() => {
    advanceFocusTrack(() => renderProjectPage(pid));
  }, 120);
};
// Slide the next task in, then re-render. No track on screen → just run the callback.
function advanceFocusTrack(then) {
  const track = document.querySelector('.focus-track');
  const hasNext = track && track.querySelector('.focus-slot-next');
  if (!hasNext) { then(); return; }
  track.classList.add('advancing');
  setTimeout(then, 520);   // matches the CSS transition
}

function updateSidebarProjects() {
  const nav = document.getElementById('sidebarProjectsNav');
  if (!nav) return;
  const ordered = [...projects].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  nav.innerHTML = ordered.map(p => `
    <div class="nav-item nav-item-project${currentProjectPageId===p.id?' active':''}" data-project="${p.id}">
      <button class="nav-item-open" onclick="showProjectPage('${p.id}')">
        <span class="nav-item-dot" style="background:${p.color&&p.color.toUpperCase()!=='#FFFFFF'?p.color:'var(--border2)'}"></span>
        <span class="nav-item-name">${esc(p.name)}</span>
      </button>
      <button class="nav-item-star${p.favorite ? ' active' : ''}" onclick="toggleFavorite('${p.id}', event)" title="${p.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${p.favorite ? 'Remove from favorites' : 'Add to favorites'}">${starIcon(p.favorite)}</button>
    </div>`).join('');
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
document.getElementById('newProjectNavBtn').addEventListener('click', () => { closeSidebarOnMobile(); openEditor(); });

// ── SIDEBAR QUICK CONTROLS ────────────────────────────────────
document.getElementById('headerLogoBtn').addEventListener('click', () => showPage('home'));
document.getElementById('headerProfileBtn').addEventListener('click', () => showPage('account'));
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sidebarCloseBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});
function closeSidebarOnMobile() {
  if (window.matchMedia('(max-width: 600px)').matches) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

// ── SETTINGS ──────────────────────────────────────────────────
document.getElementById('clearDataBtn').addEventListener('click', () => {
  showConfirmModal(
    'Clear all data?',
    'This permanently deletes every project, your finished history, and your name. This cannot be undone.',
    'Clear everything',
    () => {
      projects = []; doneProjects = [];
      localStorage.removeItem('gid-name');
      localStorage.removeItem('gid-draft');
      save();
      renderAll();
      renderAccount();
    }
  );
});

// ── ACCOUNT ───────────────────────────────────────────────────
function renderAccount() {
  const p = projects.length;
  // Add up how many tasks are left across every active project
  let left = 0;
  for (const proj of projects) {
    left += getTasks(proj).length - getDoneCount(proj);
  }
  ['statActive','statLeft'].forEach((id,i)=>{ const el=document.getElementById(id); if(el) el.textContent=[p,left][i]; });
  // Name input
  const name = getDisplayName();
  const localInput = document.getElementById('localDisplayName');
  if (localInput) localInput.value = name;
  // Avatar initial
  const initials = getInitials(name);
  const guestAvatar = document.getElementById('acctAvatarGuest');
  if (guestAvatar) guestAvatar.textContent = initials;
  updateHeaderProfile();
}

// ── DONE PAGE ─────────────────────────────────────────────────
let doneSort = 'newest';

function renderDone() {
  document.getElementById('vaultSub').textContent = doneProjects.length ? `${doneProjects.length} project${doneProjects.length!==1?'s':''} finished.` : 'Nothing here yet. Finish a project to get started.';

  const statsEl = document.getElementById('vaultStats');
  // Add up completed tasks across both active and finished projects
  const allProjects = projects.concat(doneProjects);
  let totalTasksDone = 0;
  for (const p of allProjects) {
    totalTasksDone += getDoneCount(p);
  }
  if (doneProjects.length && statsEl) {
    statsEl.innerHTML = `
      <div class="vault-stat"><div class="vault-stat-num">${totalTasksDone}</div><div class="vault-stat-label">Tasks done</div></div>
      <div class="vault-stat"><div class="vault-stat-num">${doneProjects.length}</div><div class="vault-stat-label">Projects finished</div></div>
    `;
  } else if (statsEl) {
    statsEl.innerHTML = '';
  }

  let sorted = doneProjects.map((p, i) => ({...p, _i: i}));
  if (doneSort === 'newest') sorted = [...sorted]; // already newest first (unshift order)
  else if (doneSort === 'oldest') sorted = [...sorted].reverse();
  else if (doneSort === 'name') sorted = [...sorted].sort((a,b) => a.name.localeCompare(b.name));

  document.getElementById('doneList').innerHTML = sorted.map((p,i) => {
    const bodyHtml = groupBlocks(p).map(g=>`
      <div class="done-goal-name">● ${esc(g.name)}</div>
      ${g.loose.map(t=>`<div class="done-task-item">${esc(t.text)}</div>`).join('')}
      ${g.phases.map(ph=>`<div class="done-phase-name">◆ ${esc(ph.name)}</div>${ph.tasks.map(t=>`<div class="done-task-item">${esc(t.text)}</div>`).join('')}`).join('')}
    `).join('');
    const dateStr = p.finishedAt ? new Date(p.finishedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : p.finishedDate || '';
    const createdStr = p.createdAt ? `Created ${new Date(p.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` : '';
    const cardAccent = getAccentColor(p);
    return `<div class="done-card" id="donecard-${i}" style="--card-accent:${cardAccent}" onclick="toggleDoneCard(${i})">
      <div class="done-card-header">
        <span class="done-badge">Done</span>
        <span class="done-card-dot" style="background:${cardAccent}"></span>
        <span class="done-card-name">${esc(p.name)}</span>
        <span class="done-card-date">${dateStr}</span>
        <span class="done-chevron">›</span>
      </div>
      <div class="done-card-body">
        ${createdStr ? `<div class="done-card-created">${createdStr}</div>` : ''}
        ${bodyHtml}
      </div>
    </div>`;
  }).join('');
}

// Sort toggle
document.getElementById('doneSortToggle').addEventListener('click', e => {
  const btn = e.target.closest('.pill-btn');
  if (!btn) return;
  document.querySelectorAll('#doneSortToggle .pill-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  doneSort = btn.dataset.sort;
  renderDone();
});
window.toggleDoneCard = i => {
  const doneCardEl = document.getElementById('donecard-'+i);
  if (doneCardEl) doneCardEl.classList.toggle('open');
};

// ── HOME PAGE: PROJECT GRID ────────────────────────────────────

function renderProjectsGrid() {
  const wrap = document.getElementById('projectsListWrap');
  if (!wrap) return;

  if (!projects.length) {
    wrap.innerHTML = `<div class="projects-list-empty"><p>Nothing active yet.</p><button class="btn btn-primary projects-empty-create-btn" onclick="openEditor()">+ Create your first project</button></div>`;
    updateSidebarProjects();
    return;
  }

  const byRecent = (a, b) => Math.max(b.lastTouched || 0, b.createdAt || 0) - Math.max(a.lastTouched || 0, a.createdAt || 0);

  const starred = projects.filter(p => p.favorite).sort(byRecent);
  const others = projects.filter(p => !p.favorite).sort(byRecent);
  const allOrdered = [...starred, ...others];

  const gridHtml = allOrdered.map(p => {
    const tasks = getTasks(p);
    const done = getDoneCount(p);
    const pct = tasks.length ? Math.round((done/tasks.length)*100) : 0;
    const cur = getCurrentTask(p);
    const accentColor = getAccentColor(p);

    // What to show as the preview line under the project name
    let taskPreview;
    if (cur) taskPreview = esc(cur.text);
    else if (tasks.length > 0) taskPreview = 'All done';
    else taskPreview = 'No tasks yet';

    return `<div class="project-grid-card" style="--card-accent:${accentColor}" onclick="showProjectPage('${p.id}')">
      <div class="project-grid-band" style="background:${accentColor}">
        <span class="project-grid-name">${esc(p.name)}</span>
        <button class="project-grid-star${p.favorite ? ' active' : ''}" onclick="toggleFavorite('${p.id}', event)" title="${p.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${p.favorite ? 'Remove from favorites' : 'Add to favorites'}">${starIcon(false)}</button>
      </div>
      <div class="project-grid-body">
        <span class="project-grid-task">${taskPreview}</span>
      </div>
      <div class="project-grid-flush"><div class="project-grid-flush-fill" style="width:${pct}%;background:${accentColor}"></div></div>
    </div>`;
  }).join('');

  const newProjectCard = `<button class="project-grid-card project-grid-new" onclick="openEditor()">
    <span class="project-grid-new-icon">+</span>
    <span class="project-grid-new-label">New project</span>
  </button>`;

  wrap.innerHTML = `
    <div class="projects-page-header">
      <div class="projects-page-title">Projects</div>
    </div>
    <div class="projects-grid">${gridHtml}${newProjectCard}</div>`;

  updateSidebarProjects();
}

// ── CHECKLIST VIEW ──────────────────────────────────────────────

function renderConvexBody(p, activeTab) {
  if (activeTab === undefined || activeTab === null) activeTab = 'all';
  const curTask = getCurrentTask(p);
  const goals = groupBlocks(p);

  // On a single-goal tab the highlight follows that goal's own next undone task.
  const tabGoal = activeTab === 'all' ? null : goals[Number(activeTab)];
  const featured = activeTab === 'all'
    ? curTask
    : (tabGoal ? goalTasks(tabGoal).find(t => !t.done) : null);

  const renderTasks = (tasks) => tasks.map((t) => {
    const isSelected = selectedTaskText === t.text;
    const isCurrent = !t.done && !selectedTaskText && featured && t.text === featured.text;
    const isFeatured = isSelected || isCurrent;
    const cls = 'cvx-task' + (t.done ? ' done' : '') + (isFeatured ? ' current' : '');
    // The whole row is the click target now — no need to aim for the tiny circle.
    const rowAction = t.done ? `undoTask('${p.id}',${t.blockIndex},true)` : `doneTask('${p.id}',${t.blockIndex},true)`;
    const checkBtn = `<span class="cvx-check-circle${t.done ? ' done' : ''}" aria-hidden="true">${t.done ? `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><polyline points="2,7 5,10.5 12,3.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}</span>`;
    return `<div class="${cls}" role="button" tabindex="0" aria-label="${t.done ? 'Mark not done' : 'Mark done'}" onclick="${rowAction}" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();${rowAction}}">${checkBtn}<span class="cvx-task-text" ondblclick="event.stopPropagation();cvxInlineEditStart('${p.id}',${t.blockIndex},this)">${esc(t.text)}</span></div>`;
  }).join('');

  const filteredGoals = activeTab === 'all' ? goals : goals.filter((g, i) => i == activeTab);
  const goalsHtml = filteredGoals.map(g => {
    const all = goalTasks(g);
    const gDone = all.length > 0 && all.every(t => t.done);
    const gPct = all.length ? Math.round((all.filter(t => t.done).length / all.length) * 100) : 0;

    const phasesHtml = g.phases.map(ph => `
      <div class="cvx-phase">
        <div class="cvx-phase-label">${esc(ph.name)}</div>
        <div class="cvx-tasks">${renderTasks(ph.tasks)}</div>
      </div>`).join('');

    const looseHtml = g.loose.length ? `<div class="cvx-tasks">${renderTasks(g.loose)}</div>` : '';

    const goalIsEmpty = !g.loose.length && !g.phases.length;
    const emptyGoalHint = goalIsEmpty ? `<div class="cvx-goal-empty-hint">No tasks yet — add some from Edit.</div>` : '';

    return `<div class="cvx-goal${gDone ? ' done' : ''}">
      <div class="cvx-goal-header">
        <span class="cvx-goal-name">${esc(g.name)}</span>
        <span class="cvx-goal-pct">${gDone ? '✓ complete' : `${gPct}%`}</span>
      </div>
      <div class="cvx-goal-progress"><div class="cvx-goal-bar" style="width:${gPct}%"></div></div>
      ${emptyGoalHint}${looseHtml}${phasesHtml}
    </div>`;
  }).join('');

  return `
    <div class="cvx-goals">${goalsHtml}</div>
    ${(!curTask && getTasks(p).length > 0) ? `<button class="btn-done" onclick="finishProjectById('${p.id}')">Mark project as done →</button>` : ''}
  `;
}

// ── TASK ACTIONS: DONE, SKIP, UNDO, FINISH ─────────────────────

function finishProjectById(pid) {
  const p = findProjectById(pid); if (!p) return;
  finishProject(p);
};

// Double-tap to edit a task inline
function cvxInlineEditStart(pid, blockIndex, el) {
  const p = findProjectById(pid);
  const task = p ? getTaskAt(p, blockIndex) : null;
  if (!task) return;
  const originalText = task.text;
  const span = el.closest('.cvx-task-text') || el;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cvx-task-dbl-input';
  input.value = originalText;
  span.replaceWith(input);
  input.focus();
  input.select();
  const save_ = () => {
    const newText = input.value.trim();
    if (newText && newText !== originalText) {
      const block = getTaskAt(p, blockIndex);
      if (block) { block.text = newText; save(); }
    }
    renderAll();
  };
  input.addEventListener('blur', save_);
  input.addEventListener('keydown', e => {
    // The row behind this input completes the task on Enter/Space, so keep keys in here.
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); save_(); }
    if (e.key === 'Escape') renderAll();
  });
};

// By position, not text — two tasks can share a name and we'd check off the wrong one.
function getTaskAt(p, blockIndex) {
  const block = (p.blocks || [])[blockIndex];
  if (!block || block.type !== 'step') return null;
  return block;
}

function doneTask(pid, blockIndex, fromChecklist, suppressRender) {
  const p = findProjectById(pid); if (!p) return;
  const task = getTaskAt(p, blockIndex);
  if (!task || task.done) return;
  task.done = true;
  task.doneAt = Date.now();   // so Cmd/Ctrl+Z can undo the most recent completion
  p.lastTouched = Date.now(); save();
  if (getDoneCount(p) >= getTasks(p).length) { finishProject(p); return; }
  if (!fromChecklist) {
    const next = getCurrentTask(p);
    selectedTaskText = next ? next.text : null;
  }
  if (!suppressRender) renderAll();
};
function undoTask(pid, blockIndex, fromChecklist) {
  const p = findProjectById(pid); if (!p) return;
  const task = getTaskAt(p, blockIndex);
  if (!task || !task.done) return;
  task.done = false; delete task.doneAt;
  if (!fromChecklist) selectedTaskText = null;
  p.lastTouched = Date.now(); save(); renderAll();
};

// Cmd/Ctrl+Z: reopen the most recently completed task, by doneAt stamp.
function undoLastCompleted(pid) {
  const p = findProjectById(pid); if (!p || !Array.isArray(p.blocks)) return;
  let best = null;
  p.blocks.forEach(b => {
    if (b.type === 'step' && b.done) {
      if (!best) best = b;
      else if ((b.doneAt || 0) >= (best.doneAt || 0)) best = b;
    }
  });
  if (!best) return;
  best.done = false; delete best.doneAt; selectedTaskText = best.text;
  p.lastTouched = Date.now(); save();
  renderProjectPage(pid);
}

function finishProject(p) {
  const finishedDate = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const finishedAt = Date.now();
  doneProjects.unshift({...p, finishedDate, finishedAt});
  projects = projects.filter(x => x.id !== p.id);
  save();
  renderFinishSummary({...p, finishedDate});
}

// ── FINISH SUMMARY PAGE ─────────────────────────────────────────

function renderFinishSummary(p) {
  const goals = groupBlocks(p);
  const taskCount = getTasks(p).length;
  const bodyHtml = goals.map(g => `
    <div class="finish-summary-goal-name">${esc(g.name)}</div>
    ${g.loose.map(t => `<div class="finish-summary-task">${esc(t.text)}</div>`).join('')}
    ${g.phases.map(ph => `<div class="finish-summary-phase-name">${esc(ph.name)}</div>${ph.tasks.map(t => `<div class="finish-summary-task">${esc(t.text)}</div>`).join('')}`).join('')}
  `).join('');

  const accentColor = getAccentColor(p);
  const taskWord = taskCount === 1 ? 'task' : 'tasks';
  const goalWord = goals.length === 1 ? 'goal' : 'goals';

  document.getElementById('finishSummaryContent').innerHTML = `
    <div class="finish-summary-wrap">
      <div class="finish-summary-badge" style="background:${accentColor}">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><polyline points="5,13 10,18 19,7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="finish-summary-title">GotItDone.</div>
      <div class="finish-summary-sub">${esc(p.name)} · finished ${esc(p.finishedDate)}</div>
      <div class="finish-summary-stat">${taskCount} ${taskWord} <span class="finish-summary-stat-dim">across ${goals.length} ${goalWord}</span></div>
      <button class="finish-summary-toggle" id="finishSummaryToggle">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        See everything you did
      </button>
      <div class="finish-summary-card hidden" id="finishSummaryDetail">${bodyHtml}</div>
      <button class="finish-summary-done-btn" id="finishSummaryDoneBtn" style="background:${accentColor}">Back to projects</button>
    </div>`;

  document.getElementById('finishSummaryToggle').addEventListener('click', () => {
    const detail = document.getElementById('finishSummaryDetail');
    const btn = document.getElementById('finishSummaryToggle');
    const nowHidden = detail.classList.toggle('hidden');
    btn.classList.toggle('open', !nowHidden);
    btn.lastChild.textContent = nowHidden ? 'See everything you did' : 'Hide details';
  });

  document.getElementById('finishSummaryDoneBtn').addEventListener('click', () => {
    showPage('home');
  });

  document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
  document.getElementById('page-finish-summary').classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));
}

// ── PROJECT ACTIONS ───────────────────────────────────────────
window.toggleFavorite = (id, e) => {
  if (e) e.stopPropagation();
  const p = findProjectById(id);
  if (!p) return;
  p.favorite = !p.favorite;
  save();
  renderAll();
  updateSidebarProjects();
};

// ── EDITOR ───────────────────────────────────────────────────
function openEditor(projectId) {
  editingId = projectId || null;
  draftWarningShown = false;
  lastFocusedRow = null;
  activeGoalTab = 'all';
  const p = projectId ? findProjectById(projectId) : null;
  document.getElementById('editorTitle').value = p ? p.name : '';
  document.getElementById('editorBlocks').innerHTML = '';
  undoStack = [];
  selectedColor = (p && p.color) || '#5B9CF6';

  // Restore draft or load project
  if (!projectId) {
    const draft = readDraft();
    if (draft) {
      document.getElementById('editorTitle').value = draft.name;
      if (draft.color) selectedColor = draft.color;
      draft.blocks.forEach(b => addBlock(b.type, b.text));
    }
    if (!document.getElementById('editorBlocks').children.length) {
      const firstRow = addBlock('section','');
      // The very first goal gets an extra-guiding prompt to set the step-by-step tone.
      const firstInput = firstRow && firstRow.querySelector('.block-input');
      if (firstInput) firstInput.placeholder = "What's your first goal?";
    }
  } else {
    const blocksToLoad = (p && p.blocks) || [];
    blocksToLoad.forEach(b=>addBlock(b.type,b.text));
    if (!document.getElementById('editorBlocks').children.length) addBlock('section','');
    // mark done tasks based on each block's own done flag
    const stepBlocks = ((p && p.blocks) || []).filter(b => b.type === 'step');
    let sc = 0;
    document.querySelectorAll('#editorBlocks .block-row').forEach(row=>{
      if(row.dataset.type==='step'){ if(stepBlocks[sc] && stepBlocks[sc].done) row.classList.add('done-block'); sc++; }
    });
  }

  // Reflect color selection in the picker UI
  document.querySelectorAll('.color-pick-btn').forEach(b => b.classList.toggle('selected', b.dataset.color === selectedColor));
  const editorWrapEl = document.querySelector('.editor-wrap');
  editorWrapEl.style.setProperty('--card-accent', selectedColor);
  updatePaintSwatch(selectedColor);

  document.getElementById('deleteProjectBtn').classList.toggle('hidden', !projectId);

  // Remember which page opened the editor so we can return to it
  editorReturnPage = currentProjectPageId ? 'project' : 'home';
  editorReturnPid = currentProjectPageId;

  // Show editor — keep current page active but hide its content
  document.getElementById('projectsListWrap').style.display = 'none';
  document.getElementById('projectPageContent').style.display = 'none';
  document.getElementById('projectPageBack').style.display = 'none';
  document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
  document.getElementById('page-home').classList.add('active');
  document.getElementById('editorWrap').classList.remove('hidden');
  const sf = document.querySelector('.shortcuts-footer');
  sf.style.display = 'block';
  setTimeout(() => document.getElementById('editorTitle').focus(), 50);
  updateNums();
}

// Draft survives navigating away; only Cancel discards it.
function hideEditorIfOpen(discardDraft) {
  if (document.getElementById('editorWrap').classList.contains('hidden')) return;
  document.getElementById('editorWrap').classList.add('hidden');
  document.querySelector('.shortcuts-footer').style.display = 'none';
  document.getElementById('projectsListWrap').style.display = '';
  document.getElementById('projectPageContent').style.display = '';
  document.getElementById('projectPageBack').style.display = '';
  if (discardDraft) localStorage.removeItem('gid-draft');
  editingId = null;
  editorReturnPage = 'home';
  editorReturnPid = null;
}

function closeEditor() {
  const returnPid = editorReturnPid;
  const returnPage = editorReturnPage;
  // Cancel means "throw this away" — discard the draft.
  hideEditorIfOpen(true);
  if (returnPage === 'project' && returnPid) {
    showProjectPage(returnPid);
  } else {
    showPage('home');
  }
}

document.getElementById('editorCancel').addEventListener('click', closeEditor);
document.getElementById('editorSave').addEventListener('click', saveEditor);

document.getElementById('editorTitle').addEventListener('keydown', e => {
  if (e.key==='Enter'||e.key==='ArrowDown') {
    e.preventDefault();
    const firstBlockInput = document.querySelector('#editorBlocks .block-input');
    if (firstBlockInput) firstBlockInput.focus();
  }
});
// Debounced — re-walking every block on each keystroke made typing lag on big projects.
let _editInputTimer = null;
function scheduleDraftUpdate() {
  clearTimeout(_editInputTimer);
  _editInputTimer = setTimeout(() => { saveDraft(); updateNums(); }, 250);
}
document.getElementById('editorTitle').addEventListener('input', scheduleDraftUpdate);
document.getElementById('editorBlocks').addEventListener('input', scheduleDraftUpdate);

// A toolbar click blurs the textarea first, so capture the row on focusin instead.
let lastFocusedRow = null;
document.getElementById('editorBlocks').addEventListener('focusin', e => {
  const row = e.target.closest('.block-row');
  if (row) lastFocusedRow = row;
});

// Which row a new block of `type` goes after. null means the very bottom.
function findInsertPoint(type) {
  const rows = Array.from(document.querySelectorAll('#editorBlocks .block-row'));
  if (!rows.length) return null;

  // If nothing was focused, or the focused row is gone, append to the bottom.
  const from = lastFocusedRow && lastFocusedRow.isConnected ? lastFocusedRow : null;
  if (!from) return null;

  const start = rows.indexOf(from);
  if (start === -1) return null;

  // A new goal is top-level, so it lands after the current goal's last block.
  if (type === 'section') {
    for (let i = start + 1; i < rows.length; i++) {
      if (rows[i].dataset.type === 'section') return rows[i - 1];
    }
    return rows[rows.length - 1];
  }

  // A new phase goes at the end of the current goal, so it starts a fresh group.
  if (type === 'phase') {
    for (let i = start + 1; i < rows.length; i++) {
      if (rows[i].dataset.type === 'section') return rows[i - 1];
    }
    return rows[rows.length - 1];
  }

  // A new task goes after the last task in the group you're in.
  let last = from;
  for (let i = start + 1; i < rows.length; i++) {
    const t = rows[i].dataset.type;
    if (t === 'step') { last = rows[i]; continue; }
    break; // hit the next phase or goal
  }
  return last;
}

function addBlockFromToolbar(type) {
  const existing = document.querySelectorAll('#editorBlocks .block-row');
  const hasGoal = Array.from(existing).some(r => r.dataset.type === 'section');
  // Nothing can precede the first Goal — a phase or task needs one to live under.
  if (!hasGoal && type !== 'section') type = 'section';

  const insertAfter = findInsertPoint(type);
  const row = addBlock(type, '', insertAfter);
  saveDraft();
  updateNums();
  // addBlock focuses it already; just remember it as the anchor for the next click.
  if (row) lastFocusedRow = row;
}

document.getElementById('addGoalBtn').addEventListener('click', () => addBlockFromToolbar('section'));
document.getElementById('addPhaseBtn').addEventListener('click', () => addBlockFromToolbar('phase'));
document.getElementById('addTaskBtn').addEventListener('click', () => addBlockFromToolbar('step'));


// Reusable confirm modal — pass what to show and what to do if the user confirms.
let modalConfirmCallback = null;
let modalPreviousFocus = null;
function showConfirmModal(title, sub, confirmLabel, onConfirm) {
  document.getElementById('deleteModalTitle').textContent = title;
  document.getElementById('deleteModalSub').textContent = sub;
  document.getElementById('deleteModalConfirm').textContent = confirmLabel;
  modalConfirmCallback = onConfirm;
  modalPreviousFocus = document.activeElement;
  document.getElementById('deleteModal').classList.remove('hidden');
  document.getElementById('deleteModalCancel').focus();
}
function hideConfirmModal() {
  document.getElementById('deleteModal').classList.add('hidden');
  if (modalPreviousFocus && typeof modalPreviousFocus.focus === 'function') modalPreviousFocus.focus();
  modalPreviousFocus = null;
}
// Trap Tab inside the modal so focus can't land on the content behind it.
document.getElementById('deleteModal').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const first = document.getElementById('deleteModalCancel');
  const last = document.getElementById('deleteModalConfirm');
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Delete flow — X opens modal
document.getElementById('deleteProjectBtn').addEventListener('click', () => {
  showConfirmModal('Delete project?', "This can't be undone.", 'Delete', () => {
    projects = projects.filter(p => p.id !== editingId);
    save();
    // Go home, not back — the page we came from may be the project we just deleted.
    hideEditorIfOpen(true);
    currentProjectPageId = null;
    showPage('home');
    renderAll();
  });
});
document.getElementById('deleteModalCancel').addEventListener('click', hideConfirmModal);
document.getElementById('deleteModalConfirm').addEventListener('click', () => {
  hideConfirmModal();
  if (modalConfirmCallback) modalConfirmCallback();
  modalConfirmCallback = null;
});
document.getElementById('deleteModal').addEventListener('click', e => {
  if (e.target === document.getElementById('deleteModal')) hideConfirmModal();
});

function blockLabel(type) {
  if (type === 'section') return 'Goal';
  if (type === 'phase') return 'Phase';
  return 'Task';
}
function blockPlaceholder(type, ordinal) {
  // ordinal: 'first' or 'next', so the wording reads like an ordered plan.
  if (type === 'section') {
    if (ordinal === 'first') return "What's your first goal?";
    if (ordinal === 'next') return "What's your next goal?";
    return "What's your goal?";
  }
  if (type === 'phase') {
    if (ordinal === 'first') return "What's the first phase of your plan?";
    if (ordinal === 'next') return "What's the next phase?";
    return "What's a phase to get there?";
  }
  // step
  if (ordinal === 'first') return "What's the first step?";
  if (ordinal === 'next') return "What's the next step?";
  return "What's the next step?";
}

// Is this row the first of its type in its context, or a later one? Picks the wording.
function placeholderOrdinalFor(row) {
  const rows = Array.from(document.querySelectorAll('#editorBlocks .block-row'));
  const idx = rows.indexOf(row);
  if (idx === -1) return undefined;
  const type = row.dataset.type;
  if (type === 'section') {
    // First goal overall?
    for (let i = 0; i < idx; i++) if (rows[i].dataset.type === 'section') return 'next';
    return 'first';
  }
  if (type === 'phase') {
    // Scan back to the enclosing goal; is there a phase between it and here?
    for (let i = idx - 1; i >= 0; i--) {
      if (rows[i].dataset.type === 'section') return 'first';
      if (rows[i].dataset.type === 'phase') return 'next';
    }
    return 'first';
  }
  // step: scan back to the enclosing phase or goal; any step in between?
  for (let i = idx - 1; i >= 0; i--) {
    if (rows[i].dataset.type === 'phase' || rows[i].dataset.type === 'section') return 'first';
    if (rows[i].dataset.type === 'step') return 'next';
  }
  return 'first';
}

// Keep first/next wording correct as blocks move. Only touches empty inputs.
function refreshPlaceholders() {
  document.querySelectorAll('#editorBlocks .block-row').forEach(row => {
    const input = row.querySelector('.block-input');
    if (input && !input.value) {
      input.placeholder = blockPlaceholder(row.dataset.type, placeholderOrdinalFor(row));
    }
  });
}
// Goal is blue, Phase green, Task plain.
function blockTypeClass(type) {
  if (type === 'section') return 'is-section';
  if (type === 'phase') return 'is-phase';
  return '';
}

function pushUndo() {
  const snap = Array.from(document.querySelectorAll('#editorBlocks .block-row')).map(r=>({type:r.dataset.type,text:r.querySelector('.block-input').value}));
  undoStack.push(snap);
  if (undoStack.length>50) undoStack.shift();
}
function applyUndo() {
  if (!undoStack.length) return;
  const snap = undoStack.pop();
  document.getElementById('editorBlocks').innerHTML='';
  snap.forEach(b=>addBlock(b.type,b.text));
  updateNums(); saveDraft();
}
document.addEventListener('keydown', e => {
  if ((e.metaKey||e.ctrlKey)&&e.key==='z'&&!document.getElementById('editorWrap').classList.contains('hidden')) {
    e.preventDefault(); applyUndo();
    return;
  }
  // Escape backs out of the topmost thing: modal, then editor, then mobile drawer.
  if (e.key === 'Escape') {
    if (!document.getElementById('deleteModal').classList.contains('hidden')) {
      document.getElementById('deleteModalCancel').click();
      return;
    }
    if (!document.getElementById('editorWrap').classList.contains('hidden')) {
      document.getElementById('editorCancel').click();
      return;
    }
    if (document.getElementById('sidebar').classList.contains('open')) {
      document.getElementById('sidebar').classList.remove('open');
      return;
    }
  }
  // Task shortcuts on the project page's Focus view (never while typing).
  const activeEl = document.activeElement;
  const tag = activeEl ? activeEl.tagName : undefined;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (activeEl && activeEl.isContentEditable);
  if (isTyping) return;
  const projectPageEl = document.getElementById('page-project');
  if (!projectPageEl || !projectPageEl.classList.contains('active')) return;
  if (!currentProjectPageId || (projectPageMode[currentProjectPageId] || 'focus') !== 'focus') return;

  // Cmd/Ctrl+Z reopens the last completed task, in case Done was hit by accident.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoLastCompleted(currentProjectPageId);
    return;
  }

  const doneBtn = document.querySelector('.focus-done-btn');
  if (!doneBtn) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); doneBtn.click(); }
});

function addBlock(type, text, insertAfter) {
  const container = document.getElementById('editorBlocks');
  const row = document.createElement('div');
  row.className = 'block-row';
  row.dataset.type = type;
  row.innerHTML = `
    <span class="block-arrows">
      <button class="block-arrow" data-dir="up" title="Move up" aria-label="Move up">▲</button>
      <button class="block-arrow" data-dir="down" title="Move down" aria-label="Move down">▼</button>
    </span>
    <button class="block-type-btn ${blockTypeClass(type)}">${blockLabel(type)}</button>
    <textarea class="block-input ${blockTypeClass(type)}" placeholder="${blockPlaceholder(type)}" aria-label="${blockLabel(type)} text" rows="1">${(text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
    <button class="block-del" aria-label="Delete ${blockLabel(type).toLowerCase()}">×</button>
  `;
  if (insertAfter) insertAfter.after(row);
  else container.appendChild(row);

  const typeBtn = row.querySelector('.block-type-btn');
  const input = row.querySelector('.block-input');
  const del = row.querySelector('.block-del');

  typeBtn.addEventListener('click', () => cycleType(row, typeBtn, input));

  // Auto-grow textarea
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  }
  input.addEventListener('input', autoGrow);
  setTimeout(autoGrow, 0);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pushUndo();
      // Enter picks the smart type; Shift forces Phase, Cmd forces Goal — if valid here.
      let newType;
      if (e.metaKey || e.ctrlKey) {
        newType = 'section';                       // Cmd/Ctrl+Enter → Goal
      } else if (e.shiftKey) {
        newType = 'phase';                         // Shift+Enter → Phase
      } else {
        // Smart default: after a Goal → Phase, otherwise → Task.
        newType = row.dataset.type === 'section' ? 'phase' : 'step';
      }

      const newRow = addBlock(newType, '', row);
      // If the forced type was invalid at this position, cycle it to a valid one.
      if (newRow && !isTypeValidForRow(newRow, newType)) {
        const order = ['section', 'phase', 'step'];
        for (const cand of order) {
          if (isTypeValidForRow(newRow, cand)) {
            const btn = newRow.querySelector('.block-type-btn');
            const inp = newRow.querySelector('.block-input');
            cycleTypeTo(newRow, btn, inp, cand);
            break;
          }
        }
      }

      const nextRow = row.nextElementSibling;
      if (nextRow) {
        const nextInput = nextRow.querySelector('.block-input');
        if (nextInput) nextInput.focus();
      }
      updateNums();
      saveDraft();
    }
    // Backspace on an empty block removes it — caret at 0 only, so it never eats a char.
    else if (e.key === 'Backspace' && input.value === '' &&
             input.selectionStart === 0 && input.selectionEnd === 0) {
      const prevRow = row.previousElementSibling;
      const container = document.getElementById('editorBlocks');
      // Keep at least one block, and only merge up if there's a row to land on.
      if (prevRow && container.children.length > 1) {
        e.preventDefault();
        pushUndo();
        const prevInput = prevRow.querySelector('.block-input');
        row.remove();
        if (prevInput) {
          prevInput.focus();
          // Put the caret at the end of the previous block's text.
          const end = prevInput.value.length;
          prevInput.setSelectionRange(end, end);
        }
        updateNums();
        saveDraft();
      }
    }
    // Arrow up/down move between blocks.
    else if (e.key === 'ArrowDown') {
      const nextRow = row.nextElementSibling;
      const nextInput = nextRow && nextRow.querySelector('.block-input');
      if (nextInput) {
        e.preventDefault();
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    }
    else if (e.key === 'ArrowUp') {
      const prevRow = row.previousElementSibling;
      const prevInput = prevRow && prevRow.querySelector('.block-input');
      if (prevInput) {
        e.preventDefault();
        prevInput.focus();
        prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
      } else {
        // At the top block — hop up to the project title field.
        const title = document.getElementById('editorTitle');
        if (title) { e.preventDefault(); title.focus(); title.setSelectionRange(title.value.length, title.value.length); }
      }
    }
  });

  del.addEventListener('click', () => {
    if (document.getElementById('editorBlocks').children.length>1){
      pushUndo();
      const prevRow=row.previousElementSibling;
      row.remove();
      if (prevRow) {
        const prevInput = prevRow.querySelector('.block-input');
        if (prevInput) prevInput.focus();
      }
      updateNums();saveDraft();
    }
  });

  // Reorder — swap with the adjacent row
  row.querySelector('.block-arrow[data-dir="up"]').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (!prev) return;
    pushUndo();
    prev.before(row);
    updateNums(); saveDraft();
  });
  row.querySelector('.block-arrow[data-dir="down"]').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (!next) return;
    pushUndo();
    next.after(row);
    updateNums(); saveDraft();
  });

  if (!text) setTimeout(() => { input.focus(); }, 0);
  return row;
}

// Enforces the hierarchy: first block is a Goal, and no two Goals back-to-back.
function isTypeValidForRow(row, type) {
  const rows = Array.from(document.querySelectorAll('#editorBlocks .block-row'));
  const idx = rows.indexOf(row);
  if (idx === -1) return true;

  // The first block can only be a Goal.
  if (idx === 0) return type === 'section';

  const prev = rows[idx - 1];
  const next = rows[idx + 1];
  const prevType = prev ? prev.dataset.type : null;
  const nextType = next ? next.dataset.type : null;

  // Is there a Goal anywhere above this row?
  let hasGoalAbove = false;
  for (let i = 0; i < idx; i++) {
    if (rows[i].dataset.type === 'section') { hasGoalAbove = true; break; }
  }

  if (type === 'section') {
    // No two Goals back-to-back — a Goal must contain something.
    if (prevType === 'section') return false;
    if (nextType === 'section') return false;
    return true;
  }
  // Phase or Task must live under a Goal.
  return hasGoalAbove;
}

function cycleType(row, btn, input) {
  // Cycle Goal → Phase → Task, skipping anything that would break the hierarchy.
  const order = ['section', 'phase', 'step'];
  const start = order.indexOf(row.dataset.type);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(start + i) % order.length];
    if (candidate !== row.dataset.type && isTypeValidForRow(row, candidate)) {
      cycleTypeTo(row, btn, input, candidate);
      return;
    }
  }
  // No valid alternative — leave it unchanged.
}
function cycleTypeTo(row, btn, input, nt) {
  row.dataset.type = nt;
  btn.textContent = blockLabel(nt);
  btn.className = `block-type-btn ${blockTypeClass(nt)}`;
  input.className = `block-input ${blockTypeClass(nt)}`;
  input.placeholder = blockPlaceholder(nt, placeholderOrdinalFor(row));
  refreshPlaceholders();
}

function updateNums() {
  document.querySelectorAll('#editorBlocks .block-row').forEach(row => {
    const btn = row.querySelector('.block-type-btn');
    btn.textContent = blockLabel(row.dataset.type);
  });
  refreshPlaceholders();
  updateGoalTabs();
}

// Validate before touching the editor, or a broken draft half-fills it.
function readDraft() {
  const raw = localStorage.getItem('gid-draft');
  if (!raw) return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    console.warn('GetItDone: draft was corrupted, discarding it.', e);
    localStorage.removeItem('gid-draft');
    return null;
  }
  if (!d || typeof d !== 'object' || !Array.isArray(d.blocks)) {
    console.warn('GetItDone: draft had an unexpected shape, discarding it.');
    localStorage.removeItem('gid-draft');
    return null;
  }
  const blocks = [];
  for (const b of d.blocks) {
    if (b && typeof b.text === 'string') {
      blocks.push({ type: b.type, text: b.text });
    }
  }
  return {
    name: typeof d.name === 'string' ? d.name : '',
    color: typeof d.color === 'string' ? d.color : null,
    blocks: blocks
  };
}

function saveDraft() {
  if (editingId) return; // only new projects get drafted
  const name = document.getElementById('editorTitle').value;
  const blocks = Array.from(document.querySelectorAll('#editorBlocks .block-row')).map(r => ({
    type: r.dataset.type,
    text: r.querySelector('.block-input').value
  }));
  try {
    localStorage.setItem('gid-draft', JSON.stringify({ name, blocks, color: selectedColor }));
  } catch (e) {
    console.warn('GetItDone: could not save draft.', e);
    // Runs on every keystroke, so only warn once per session.
    if (!draftWarningShown) {
      draftWarningShown = true;
      showSaveError("Couldn't save your draft — browser storage may be full.");
    }
  }
}

function saveEditor() {
  const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const name=titleCase(document.getElementById('editorTitle').value.trim());
  if (!name){document.getElementById('editorTitle').focus();return;}
  const rawBlocks=Array.from(document.querySelectorAll('#editorBlocks .block-row')).map(r=>{
    const type = r.dataset.type;
    const text = r.querySelector('.block-input').value.trim();
    // Capitalize first letter of each word for phases (unless already all-caps)
    const finalText = type === 'phase' ? titleCase(text) : text;
    return { type, text: finalText };
  }).filter(b=>b.text);
  if (editingId) {
    const p=findProjectById(editingId);
    if(p){
      // Preserve done state on step blocks whose text matches an existing one
      const oldSteps = (p.blocks||[]).filter(b=>b.type==='step');
      const usedOldIdx = new Set();
      const blocks = rawBlocks.map(b => {
        if (b.type !== 'step') return b;
        let matchIdx = -1;
        for (let i = 0; i < oldSteps.length; i++) {
          if (!usedOldIdx.has(i) && oldSteps[i].text === b.text) { matchIdx = i; break; }
        }
        if (matchIdx !== -1) {
          usedOldIdx.add(matchIdx);
          return { ...b, done: oldSteps[matchIdx].done };
        }
        return b;
      });
      p.name=name;p.blocks=blocks;p.color=selectedColor;
    }
  } else {
    projects.unshift({id:id(),name,blocks:rawBlocks,createdAt:Date.now(),color:selectedColor});
  }
  save(); closeEditor();
}

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll() {
  const activePage = document.querySelector('.page.active');
  const pg = activePage ? activePage.id.replace('page-','') : undefined;
  if (pg === 'home') renderProjectsGrid();
  else if (pg === 'project' && currentProjectPageId) renderProjectPage(currentProjectPageId);
  else if (pg === 'account') renderAccount();
  else if (pg === 'gotitdone') renderDone();
}

// ── DISPLAY NAME ──────────────────────────────────────────────
function getDisplayName() {
  return localStorage.getItem('gid-name') || '';
}
// "Carter Young" → "CY". Shows "?" when there's no name yet.
function getInitials(name) {
  if (!name) return '?';
  let initials = '';
  const words = name.split(' ');
  for (const word of words) {
    if (word) initials += word[0];
  }
  return initials.toUpperCase().slice(0, 2);
}
function setDisplayName(name) {
  localStorage.setItem('gid-name', name.slice(0, 18));
  updateHeaderProfile();
}
// Update the header profile button to show the person's first name and initials.
function updateHeaderProfile() {
  const name = getDisplayName();
  const firstName = name ? name.split(' ')[0] : '';
  const headerName = document.getElementById('headerProfileName');
  if (headerName) headerName.textContent = firstName || 'Account';
  const avatar = document.getElementById('headerProfileAvatar');
  if (avatar) {
    avatar.textContent = getInitials(name);
  }
}

// ── NAME SAVE BUTTONS ─────────────────────────────────────────
document.getElementById('saveLocalNameBtn').addEventListener('click', () => {
  const name = document.getElementById('localDisplayName').value.trim();
  if (name) { setDisplayName(name); renderAccount(); }
});

// Enter key on the name input
const nameInputEl = document.getElementById('localDisplayName');
if (nameInputEl) {
  nameInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('saveLocalNameBtn').click(); }
  });
}

// ── INIT ──────────────────────────────────────────────────────
updateHeaderProfile();
renderAll();
updateSidebarProjects();
