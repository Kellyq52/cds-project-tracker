// app.js — PM Workflow Application Controller

'use strict';

// ── Phase constants (global — used by checklist.js, gantt.js, summary) ────────
const PHASES = ['Onboarding', 'Due Diligence', 'On Hold', 'Design', 'Permitting', 'Bidding', 'Financing', 'Construction', 'Close Out'];

const PHASE_COLORS = {
  'Onboarding':       { bg: '#dbeafe', text: '#1d4ed8' },
  'Due Diligence':  { bg: '#dcfce7', text: '#15803d' },
  'On Hold':        { bg: '#f1f5f9', text: '#475569' },
  'Design':         { bg: '#fef3c7', text: '#92400e' },
  'Permitting':     { bg: '#fee2e2', text: '#991b1b' },
  'Bidding':        { bg: '#ffedd5', text: '#9a3412' },
  'Financing':      { bg: '#ecfccb', text: '#3f6212' },
  'Construction':   { bg: '#93c5fd', text: '#1e3a8a' },
  'Close Out':      { bg: '#ede9fe', text: '#5b21b6' },
};

const PHASE_INDEX = new Map(PHASES.map((p, i) => [p, i]));

const SUMMARY_COLS = [
  { key: 'comments', label: 'Comments' },
  { key: 'progress', label: 'Progress' },
  ...PHASES.map(p => ({ key: p, label: p })),
  { key: 'pm', label: 'PM' },
  { key: 'cm', label: 'CM' },
  { key: 'pd', label: 'PD' },
];

const PHASE_TASKS = {
  'Onboarding': [
    { name: 'Intro call to client',          duration: 1  },
    { name: 'Set up project',                duration: 2  },
    { name: 'Create and send proposal',      duration: 5  },
    { name: 'Receive proposal and deposit',  duration: 7  },
  ],
  'Due Diligence': [
    { name: 'SIR',                    duration: 10 },
    { name: 'Site Survey',            duration: 7  },
    { name: 'Preliminary Floor Plan', duration: 10 },
    { name: 'Lease Review',           duration: 7  },
    { name: 'Create schedule',        duration: 3  },
    { name: 'Create budget',          duration: 5  },
    { name: 'Publish DD memo',        duration: 2  },
  ],
  'On Hold': [
    { name: 'On Hold', duration: 14 },
  ],
  'Design': [
    { name: 'CDKO',             duration: 21 },
    { name: '90% review',       duration: 7  },
    { name: 'Issue for Permit', duration: 3  },
  ],
  'Permitting': [
    { name: 'Submit permit',          duration: 1  },
    { name: 'Receive comments',       duration: 21 },
    { name: 'Respond to comments',    duration: 7  },
    { name: 'Permit review complete', duration: 14 },
    { name: 'Permit issued',          duration: 1  },
  ],
  'Bidding': [
    { name: 'Out to bid',         duration: 14 },
    { name: 'Receive bids',       duration: 14 },
    { name: 'Select GC',          duration: 5  },
    { name: 'Contract execution', duration: 7  },
    { name: 'Notice to commence', duration: 1  },
  ],
  'Financing': [
    { name: 'Financing', duration: 14 },
  ],
  'Construction': [
    { name: 'Construction start',       duration: 1  },
    { name: 'Substantial Completion',   duration: 90 },
    { name: 'Certificate of Occupancy', duration: 14 },
  ],
  'Close Out': [
    { name: 'Receive lien waivers',   duration: 14 },
    { name: 'Receive close out docs', duration: 7  },
    { name: 'Review final pay apps',  duration: 7  },
  ],
};

// ── App controller ─────────────────────────────────────────────────────────────
const App = (function () {
  const STORAGE_KEY   = 'pmWorkflow_v2';
  const TEMPLATES_KEY = 'pmTemplates_v1';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let _seq = 0;

  // ── State ──────────────────────────────────────────────────────────────────
  let state = { programs: [], activeProjectId: null, archiveActiveProjectId: null };

  const expanded = new Set();   // programs expanded in sidebar
  let editingId   = null;
  let currentView = 'checklist';
  let currentTab    = 'project';  // 'project' | 'summary' | 'capacity'
  let currentDivision = 'pm';     // 'pm' | 'pd'
  let summarySort   = { col: 'program', dir: 'asc' };
  let summaryFilter = '';         // '' = all programs, otherwise program id
  let summaryProjectFilter = 'active'; // 'active' = projects with tasks | 'pipeline' = projects with no tasks
  let myProjectsOnly = false;          // true = show only projects assigned to current user
  let summaryHiddenCols = new Set(); // persisted in localStorage
  let capacityFilter = { pm: '', cm: '', pd: '', program: '' };
  let capacitySort   = { phase: '', dir: 'asc' };
  let _usersEditingId = null; // null=list view, 'new'=add form, id=edit form

  // ── ID generation ──────────────────────────────────────────────────────────
  function genId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + (++_seq);
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  // Normalise a user's roles to an array, handling the legacy single-role string.
  function _userRoles(u) {
    return Array.isArray(u.roles) ? u.roles : [u.role].filter(Boolean);
  }

  // Return the id of the first project matching the archived flag, or null.
  function _nextProjectId(wantArchived) {
    for (const p of state.programs)
      for (const pr of p.projects)
        if (!!pr.archived === !!wantArchived) return pr.id;
    return null;
  }

  // Expand only the program that contains the active project
  function _expandActiveProgram() {
    const id = state.activeProjectId;
    for (const prog of state.programs) {
      if (prog.projects.some(p => p.id === id)) { expanded.add(prog.id); break; }
    }
  }

  // ── Active project helpers ─────────────────────────────────────────────────
  function getActiveProject() {
    const id = currentTab === 'archive' ? state.archiveActiveProjectId : state.activeProjectId;
    for (const prog of state.programs) {
      const proj = prog.projects.find(p => p.id === id);
      if (proj) return proj;
    }
    // Fallback: first project matching the tab context
    for (const prog of state.programs) {
      for (const proj of prog.projects) {
        if (currentTab === 'archive' ? proj.archived : !proj.archived) return proj;
      }
    }
    return null;
  }

  function getActiveProgramName() {
    const id = currentTab === 'archive' ? state.archiveActiveProjectId : state.activeProjectId;
    for (const prog of state.programs) {
      if (prog.projects.some(p => p.id === id)) return prog.name;
    }
    return '';
  }

  // ── Seed data ──────────────────────────────────────────────────────────────
  function seedState() {
    const defs = [
      { name: 'Barre3',       city: 'Austin'    },
      { name: '4EY',          city: 'Denver'    },
      { name: 'Slick City',   city: 'Nashville' },
      { name: 'Salons by JC', city: 'Phoenix'   },
      { name: 'Bodybar',      city: 'Charlotte' },
      { name: 'D1 Sports',    city: 'Tampa'     },
    ];
    state.programs = defs.map(def => {
      const progId = genId('prog'), projId = genId('proj');
      let tasks = [];
      if (def.name === 'Bodybar') {
        const t1Id = genId('t'), t2Id = genId('t');
        tasks = [
          { id: t1Id, name: 'Financing Start', phase: 'Financing', duration: 1, assignee: '', status: 'not_started', actualStart: null, actualEnd: null, dependencies: [],                                        plannedStart: null, plannedEnd: null },
          { id: t2Id, name: 'Financing End',   phase: 'Financing', duration: 1, assignee: '', status: 'not_started', actualStart: null, actualEnd: null, dependencies: [{ taskId: t1Id, type: 'FS', lag: 0 }], plannedStart: null, plannedEnd: null },
        ];
      }
      return { id: progId, name: def.name, projects: [{
        id: projId, name: def.city, startDate: CPM.todayIso(), tasks, phaseAssignees: {}, phases: [],
      }]};
    });
    state.activeProjectId = state.programs[0].projects[0].id;
    state.archiveActiveProjectId = null;
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { alert('Storage quota exceeded — export your data to preserve your work.'); }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        _expandActiveProgram();
        if (!('archiveActiveProjectId' in state)) state.archiveActiveProjectId = null;
      } else if (window.__CDS_STATE__ && Array.isArray(window.__CDS_STATE__.programs)) {
        state = window.__CDS_STATE__;
        _expandActiveProgram();
        if (!('archiveActiveProjectId' in state)) state.archiveActiveProjectId = null;
        save(); // bootstrap localStorage from the portable data file
        if (window.__CDS_TEMPLATES__ && window.__CDS_TEMPLATES__.length)
          saveCustomTemplates(window.__CDS_TEMPLATES__);
      } else {
        seedState();
      }
    } catch (e) { seedState(); }
  }

  // ── Migration ──────────────────────────────────────────────────────────────
  function migrateAddPhases() {
    let changed = false;

    // Steps 1 & 1b (On Hold / Financing / Bidding seeding) were originally
    // written as always-on checks, which meant removing those phases from a
    // project or template was impossible — they'd reappear on the next page
    // load. Gate them behind migrationVersion so they run only once total.
    if (!state.migrationVersion || state.migrationVersion < 1) {
      for (const prog of state.programs) {
        for (const proj of prog.projects) {
          ['On Hold', 'Financing'].forEach(phase => {
            if (!proj.tasks.some(t => t.phase === phase)) {
              proj.tasks.push({
                id: genId('t'), name: phase, phase, duration: 14,
                assignee: '', status: 'not_started', actualStart: null, actualEnd: null,
                dependencies: [], plannedStart: null, plannedEnd: null,
              });
            }
          });
          if (!proj.tasks.some(t => t.phase === 'Bidding')) {
            const bDefs = PHASE_TASKS['Bidding'];
            const bIds  = bDefs.map(() => genId('t'));
            bDefs.forEach((def, i) => {
              proj.tasks.push({
                id: bIds[i], name: def.name, phase: 'Bidding', duration: def.duration,
                assignee: '', status: 'not_started', actualStart: null, actualEnd: null,
                dependencies: i > 0 ? [{ taskId: bIds[i - 1], type: 'FS', lag: 0 }] : [],
                plannedStart: null, plannedEnd: null,
              });
            });
          }
        }
      }
      state.migrationVersion = 1;
      changed = true;
    }

    // Step 2: backfill assignedProjects from existing phase + task assignees
    if (!state.migrationVersion || state.migrationVersion < 2) {
      for (const prog of state.programs) {
        for (const proj of prog.projects) {
          const pa = proj.phaseAssignees || {};
          Object.values(pa).forEach(id => { if (id) _grantProjectAccess(proj.id, id); });
          (proj.tasks || []).forEach(t => { if (t.assignee) _grantProjectAccess(proj.id, t.assignee); });
        }
      }
      state.migrationVersion = 2;
      changed = true;
    }

    // Step 3→4 cleanup: remove Pipeline phase tasks (feature reverted)
    if (!state.migrationVersion || state.migrationVersion < 4) {
      for (const prog of state.programs) {
        for (const proj of prog.projects) {
          const pipelineIds = new Set(
            (proj.tasks || []).filter(t => t.phase === 'Pipeline').map(t => t.id)
          );
          if (!pipelineIds.size) continue;
          proj.tasks = proj.tasks.filter(t => t.phase !== 'Pipeline');
          if (Array.isArray(proj.phases)) proj.phases = proj.phases.filter(p => p !== 'Pipeline');
          for (const task of proj.tasks) {
            if (Array.isArray(task.dependencies))
              task.dependencies = task.dependencies.filter(d => !pipelineIds.has(d.taskId));
          }
          changed = true;
        }
      }
      state.migrationVersion = 4;
      changed = true;
    }

    for (const prog of state.programs) {
      for (const proj of prog.projects) {
        // Step 4: populate proj.phases from existing tasks if missing
        if (!Array.isArray(proj.phases) || !proj.phases.length) {
          const taskPhases = new Set(proj.tasks.map(t => t.phase).filter(Boolean));
          proj.phases = PHASES.filter(p => taskPhases.has(p));
          proj.tasks.forEach(t => { if (t.phase && !proj.phases.includes(t.phase)) proj.phases.push(t.phase); });
          if (proj.phases.length) changed = true;
        }

        // Step 5: add actualStart to existing tasks that lack it
        for (const t of proj.tasks) {
          if (!('actualStart' in t)) { t.actualStart = null; changed = true; }
        }
      }
    }
    if (changed) save();
  }

  // ── User migration ─────────────────────────────────────────────────────────
  function migrateUsers() {
    let changed = false;
    if (!Array.isArray(state.users) || !state.users.length) {
      state.users = [{
        id: 'u_admin',
        name: 'Admin',
        username: 'admin',
        password: 'admin',
        roles: ['administrator'],
        assignedProjects: [],
        assignedPrograms: [],
      }];
      changed = true;
    } else {
      for (const u of state.users) {
        // Migrate single role → roles array; map legacy 'user' → 'construction_manager'
        if (!Array.isArray(u.roles)) {
          const legacy = u.role || 'construction_manager';
          u.roles = legacy === 'user' ? ['construction_manager'] : [legacy];
          changed = true;
        }
        if (!Array.isArray(u.assignedPrograms)) { u.assignedPrograms = []; changed = true; }
      }
    }
    if (changed) save();
  }

  // ── Tab switching ──────────────────────────────────────────────────────────
  function setTab(tab) {
    currentTab = tab;
    const isProjectLike = tab === 'project' || tab === 'archive';
    document.getElementById('tabProject').classList.toggle('active', tab === 'project');
    document.getElementById('tabSummary').classList.toggle('active', tab === 'summary');
    document.getElementById('tabCapacity').classList.toggle('active', tab === 'capacity');
    document.getElementById('tabArchive').classList.toggle('active', tab === 'archive');
    document.getElementById('projectTabContent').classList.toggle('hidden', !isProjectLike);
    document.getElementById('summaryTabContent').classList.toggle('hidden', tab !== 'summary');
    document.getElementById('capacityTabContent').classList.toggle('hidden', tab !== 'capacity');
    // Show view toggle and task controls on both project and archive tabs
    const canEdit = Auth.can('editTasks');
    document.getElementById('viewToggleGroup').classList.toggle('hidden', !isProjectLike);
    document.getElementById('addTaskBtn').classList.toggle('hidden', !isProjectLike || !canEdit);
    document.getElementById('addPhaseBtn').classList.toggle('hidden', !isProjectLike || !canEdit);
    document.getElementById('loadTemplateBtn').classList.toggle('hidden', !isProjectLike || !canEdit);
    document.getElementById('btnRestoreProject').classList.toggle('hidden', tab !== 'archive');
    if (tab === 'summary')  renderSummaryView();
    if (tab === 'capacity') renderCapacityView();
    if (isProjectLike) {
      // Auto-select first archived project when entering archive with no selection
      if (tab === 'archive' && !state.archiveActiveProjectId) {
        for (const prog of state.programs) {
          const p = prog.projects.find(pr => pr.archived);
          if (p) { state.archiveActiveProjectId = p.id; break; }
        }
      }
      renderSidebar(); syncHeader(); recompute(); render();
    }
  }

  // ── CPM helpers ────────────────────────────────────────────────────────────
  function recompute() {
    const proj = getActiveProject();
    const warn = document.getElementById('cycleWarning');
    if (!proj) { if (warn) warn.classList.add('hidden'); return; }
    const result = CPM.compute(proj.tasks, proj.startDate);
    if (!result.ok) { warn.textContent = '\u26A0 ' + result.error; warn.classList.remove('hidden'); }
    else warn.classList.add('hidden');
  }

  // Run CPM for every active (non-archived) project
  function computeAll() {
    for (const prog of state.programs)
      for (const proj of prog.projects)
        if (!proj.archived) CPM.compute(proj.tasks, proj.startDate);
  }

  // Get start/end dates and status for a phase within a project's tasks.
  // Accepts an optional pre-computed today string to avoid repeated Date.now() calls.
  function getPhaseDates(tasks, phase, today) {
    if (!today) today = CPM.todayIso();
    let start = null, end = null, total = 0, complete = 0, overdue = false, inProg = false;
    for (const t of tasks) {
      if (t.phase !== phase || !t.plannedStart) continue;
      total++;
      if (!start || t.plannedStart < start) start = t.plannedStart;
      if (!end   || t.plannedEnd   > end)   end   = t.plannedEnd;
      if (t.status === 'complete') complete++;
      else {
        if (t.status === 'in_progress') inProg = true;
        if (t.plannedEnd && t.plannedEnd < today) overdue = true;
      }
    }
    if (!total) return null;
    if (complete > 0 && complete < total) inProg = true;
    let status;
    if (complete === total) status = 'complete';
    else if (overdue)       status = 'overdue';
    else if (inProg)        status = 'in_progress';
    else                    status = 'not_started';
    return { start, end, total, complete, status };
  }

  // ── Program Summary view ───────────────────────────────────────────────────
  function renderSummaryView() {
    computeAll();

    function fmtShort(iso) {
      if (!iso) return '';
      const [, m, d] = iso.split('-').map(Number);
      return MONTHS[m - 1] + ' ' + d;
    }

    function sortIcon(col) {
      if (summarySort.col !== col)
        return '<span class="sort-icon">\u21C5</span>';
      return summarySort.dir === 'asc'
        ? '<span class="sort-icon active">\u2191</span>'
        : '<span class="sort-icon active">\u2193</span>';
    }

    function phaseCell(d, phase) {
      if (!d) return '<td class="phase-cell pc-empty"><span class="pc-dash">\u2014</span></td>';
      const pct = d.total ? Math.round(d.complete / d.total * 100) : 0;
      const colors = PHASE_COLORS[phase] || { bg: '#f8fafc', text: '#475569' };
      const statusCls = { complete: 'pc-complete', overdue: 'pc-overdue', in_progress: 'pc-inprog', not_started: 'pc-notstarted' }[d.status];
      return `
        <td class="phase-cell ${statusCls}">
          <div class="pc-dates">
            <span class="pc-start">${fmtShort(d.start)}</span>
            <span class="pc-arrow">\u2192</span>
            <span class="pc-end">${fmtShort(d.end)}</span>
          </div>
          <div class="pc-bar-wrap"><div class="pc-bar-fill" style="width:${pct}%;background:${colors.text}"></div></div>
          <div class="pc-count">${d.complete}/${d.total} complete</div>
        </td>`;
    }

    // ── Controls bar ───────────────────────────────────────────────────────
    const visiblePrograms = state.programs
      .filter(p => p.projects.some(pr => !pr.archived && (Auth.canViewProject(pr.id) || Auth.canViewProgram(p.id))))
      .slice().sort((a, b) => a.name.localeCompare(b.name));

    const filterBar = `
      <div class="summary-controls">
        <div class="summary-filter-wrap">
          <span class="filter-label">Program</span>
          <select class="summary-program-select" onchange="App.filterSummary(this.value)">
            <option value="">All Programs</option>
            ${visiblePrograms.map(p =>
              `<option value="${esc(p.id)}" ${summaryFilter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="col-toggle-wrap" id="summaryColToggleWrap">
          <button class="btn btn-sm col-toggle-btn" onclick="App.toggleSummaryColMenu(event)">Columns &#9662;</button>
          <div class="col-menu" id="summaryColMenu">
            ${SUMMARY_COLS.map(c => `
              <label class="col-menu-item">
                <input type="checkbox" ${!summaryHiddenCols.has(c.key) ? 'checked' : ''}
                  onchange="App.toggleSummaryCol('${c.key}')">
                ${esc(c.label)}
              </label>`).join('')}
          </div>
        </div>
      </div>`;

    // Build sortable rows (apply program filter + assigned filter)
    const rows = [];
    for (const prog of state.programs) {
      if (summaryFilter && prog.id !== summaryFilter) continue;
      for (const proj of prog.projects) {
        if (!proj.archived && (Auth.canViewProject(proj.id) || Auth.canViewProgram(prog.id))) {
          if (summaryProjectFilter === 'active'   && (proj.tasks || []).length === 0) continue;
          if (summaryProjectFilter === 'pipeline' && (proj.tasks || []).length  >  0) continue;
          if (myProjectsOnly && !isMyProject(proj)) continue;
          rows.push({ prog, proj });
        }
      }
    }

    const today = CPM.todayIso();

    // Pre-compute all phase dates once per project — reused for both sorting and rendering.
    const phaseDateCache = new Map(rows.map(({ proj }) =>
      [proj.id, new Map(PHASES.map(p => [p, getPhaseDates(proj.tasks, p, today)]))]
    ));

    const sortKey = ({ prog, proj }) => {
      const pa = proj.phaseAssignees || {};
      if (summarySort.col === 'program')  return prog.name;
      if (summarySort.col === 'project')  return proj.name;
      if (summarySort.col === 'pm')       return pa['Due Diligence'] || '';
      if (summarySort.col === 'cm')       return pa['Construction']  || '';
      if (summarySort.col === 'pd')       return pa['Permitting']    || '';
      const d = phaseDateCache.get(proj.id).get(summarySort.col);
      return d ? (d.start || 'zzzz') : 'zzzz';
    };
    const sortKeys = new Map(rows.map(r => [r.proj.id, sortKey(r)]));
    rows.sort((a, b) => {
      const cmp = String(sortKeys.get(a.proj.id)).localeCompare(String(sortKeys.get(b.proj.id)));
      if (cmp !== 0) return summarySort.dir === 'asc' ? cmp : -cmp;
      const progCmp = a.prog.name.localeCompare(b.prog.name);
      if (progCmp !== 0) return progCmp;
      return a.proj.name.localeCompare(b.proj.name);
    });

    const H = k => summaryHiddenCols.has(k);
    const thead = `<tr>
      <th class="sh-cell sth sth-prog" onclick="App.sortSummary('program')">Program ${sortIcon('program')}</th>
      <th class="sh-cell sth sth-proj" onclick="App.sortSummary('project')">Project ${sortIcon('project')}</th>
      ${H('comments') ? '' : `<th class="sh-cell sth comment-th">Comments</th>`}
      ${H('progress') ? '' : `<th class="sh-cell sth progress-th">Progress</th>`}
      ${PHASES.filter(p => !H(p)).map(p => `<th class="sh-cell sth phase-th" onclick="App.sortSummary('${p.replace(/'/g,"\\'")}')">
        <span class="phase-th-label" style="color:${(PHASE_COLORS[p]||{}).text||'#374151'}">${esc(p)}</span>
        ${sortIcon(p)}
      </th>`).join('')}
      ${H('pm') ? '' : `<th class="sh-cell sth person-th" onclick="App.sortSummary('pm')" title="Due Diligence assignee">PM ${sortIcon('pm')}</th>`}
      ${H('cm') ? '' : `<th class="sh-cell sth person-th" onclick="App.sortSummary('cm')" title="Construction assignee">CM ${sortIcon('cm')}</th>`}
      ${H('pd') ? '' : `<th class="sh-cell sth person-th" onclick="App.sortSummary('pd')" title="Permitting assignee">PD ${sortIcon('pd')}</th>`}
    </tr>`;

    const tbody = rows.map(({ prog, proj }) => {
      const rowPD  = phaseDateCache.get(proj.id);
      let total = 0, complete = 0, overdue = 0;
      for (const t of proj.tasks) {
        total++;
        if (t.status === 'complete') complete++;
        if (t.status !== 'complete' && t.plannedEnd && t.plannedEnd < today) overdue++;
      }
      const pct      = total ? Math.round(complete / total * 100) : 0;
      const isActive = proj.id === state.activeProjectId;

      return `<tr class="sr ${isActive ? 'sr-active' : ''}" onclick="App.navigateToProject('${proj.id}')" title="Click to open project">
        <td class="sc-prog">
          <span class="prog-pill">${esc(prog.name)}</span>
        </td>
        <td class="sc-proj">
          <div class="sc-proj-name">${proj.number ? `<span class="proj-num">${esc(proj.number)}</span> ` : ''}${esc(proj.name)}</div>
          <div class="sc-proj-meta">${total} task${total !== 1 ? 's' : ''}${overdue ? ' &bull; <span class="ov-txt">' + overdue + ' overdue</span>' : ''}</div>
        </td>
        ${H('comments') ? '' : `<td class="sc-comment" onclick="event.stopPropagation()">
          <textarea class="comment-input" rows="2"
            placeholder="Add notes&hellip;"
            oninput="App.setProjectComment('${proj.id}', this.value)"
            onclick="event.stopPropagation()"
          >${esc(proj.comment || '')}</textarea>
        </td>`}
        ${H('progress') ? '' : `<td class="sc-progress">
          <div class="prog-pct-label">${pct}%</div>
          <div class="prog-pct-bar"><div class="prog-pct-fill" style="width:${pct}%"></div></div>
          <div class="prog-pct-sub">${complete}/${total}</div>
        </td>`}
        ${PHASES.filter(p => !H(p)).map(p => phaseCell(rowPD.get(p), p)).join('')}
        ${H('pm') ? '' : `<td class="sc-person">${esc((proj.phaseAssignees || {})['Due Diligence'] || '\u2014')}</td>`}
        ${H('cm') ? '' : `<td class="sc-person">${esc((proj.phaseAssignees || {})['Construction']  || '\u2014')}</td>`}
        ${H('pd') ? '' : `<td class="sc-person">${esc((proj.phaseAssignees || {})['Permitting']    || '\u2014')}</td>`}
      </tr>`;
    }).join('');

    document.getElementById('summaryView').innerHTML = filterBar + `
      <div class="summary-scroll">
        <table class="summary-table">
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;
  }

  function sortSummary(col) {
    summarySort.dir = summarySort.col === col && summarySort.dir === 'asc' ? 'desc' : 'asc';
    summarySort.col = col;
    renderSummaryView();
  }

  function filterSummary(progId) {
    summaryFilter = progId;
    renderSummaryView();
  }

  function cycleSummaryProjectFilter() {
    const order = ['active', 'pipeline', 'all'];
    summaryProjectFilter = order[(order.indexOf(summaryProjectFilter) + 1) % order.length];
    renderSidebar();
    if (currentTab === 'summary') renderSummaryView();
  }

  function isMyProject(proj) {
    const uid = Auth.current()?.id;
    if (!uid) return false;
    if ((proj.tasks || []).some(t => t.assignee === uid)) return true;
    return Object.values(proj.phaseAssignees || {}).some(v => v === uid);
  }

  function toggleMyProjects() {
    myProjectsOnly = !myProjectsOnly;
    const btn = document.getElementById('btnMyProjects');
    if (btn) {
      btn.textContent = myProjectsOnly ? 'My Projects' : 'All Projects';
      btn.classList.toggle('scope-tab-active', myProjectsOnly);
    }
    renderSidebar();
    if (currentTab === 'summary')  renderSummaryView();
    if (currentTab === 'capacity') renderCapacityView();
  }

  function toggleSummaryColMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('summaryColMenu');
    if (menu) menu.classList.toggle('open');
  }

  function toggleSummaryCol(key) {
    if (summaryHiddenCols.has(key)) summaryHiddenCols.delete(key);
    else summaryHiddenCols.add(key);
    try { localStorage.setItem('cds_summaryHiddenCols', JSON.stringify([...summaryHiddenCols])); } catch(e) {}
    renderSummaryView();
  }

  function setProjectComment(projId, text) {
    for (const prog of state.programs) {
      const proj = prog.projects.find(p => p.id === projId);
      if (proj) { proj.comment = text; save(); return; }
    }
  }

  function setActiveProjectComment(text) {
    const proj = getActiveProject();
    if (proj) { proj.comment = text; save(); }
  }

  // ── CM Capacity view ───────────────────────────────────────────────────────
  function renderCapacityView() {
    computeAll();
    const container = document.getElementById('capacityView');
    if (!container) return;

    // Collect unique PM, CM, and PD names for filter dropdowns
    const pmNames = new Set(), cmNames = new Set(), pdNames = new Set();
    for (const prog of state.programs)
      for (const proj of prog.projects) {
        if (proj.archived) continue;
        const pa = proj.phaseAssignees || {};
        if (pa['Due Diligence']) pmNames.add(pa['Due Diligence']);
        if (pa['Construction'])  cmNames.add(pa['Construction']);
        if (pa['Permitting'])    pdNames.add(pa['Permitting']);
      }

    // Dropdown helper
    function filterSelect(type, names, allLabel) {
      const current = capacityFilter[type];
      const opts = `<option value="">${esc(allLabel)}</option>` +
        [...names].sort().map(n => `<option value="${esc(n)}" ${current === n ? 'selected' : ''}>${esc(n)}</option>`).join('');
      return `<div class="summary-filter-wrap">
        <span class="filter-label">${esc(allLabel.replace('All ',''))}</span>
        <select class="summary-program-select" onchange="App.filterCapacity('${type}', this.value)">${opts}</select>
      </div>`;
    }

    const visPrograms = state.programs
      .filter(p => p.projects.some(pr => !pr.archived))
      .slice().sort((a, b) => a.name.localeCompare(b.name));
    const progOpts = `<option value="">All Programs</option>` +
      visPrograms.map(p => `<option value="${esc(p.id)}" ${capacityFilter.program === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

    // Filter bar HTML (shown regardless of row count)
    const filterBars = `
      <div class="summary-controls">
        <div class="summary-filter-wrap">
          <span class="filter-label">Program</span>
          <select class="summary-program-select" onchange="App.filterCapacity('program', this.value)">${progOpts}</select>
        </div>
        ${filterSelect('pm', pmNames, 'All PM')}
        ${filterSelect('cm', cmNames, 'All CM')}
        ${filterSelect('pd', pdNames, 'All PD')}
      </div>
`;

    // Build rows (apply all filters)
    const rows = [];
    for (const prog of state.programs)
      for (const proj of prog.projects) {
        if (proj.archived) continue;
        if (!(proj.tasks || []).length) continue;
        if (!Auth.canViewProject(proj.id) && !Auth.canViewProgram(prog.id)) continue;
        if (capacityFilter.program && prog.id !== capacityFilter.program) continue;
        const pa = proj.phaseAssignees || {};
        // Person filters: OR within the same person (show all their projects across roles),
        // AND across different people (both must match).
        const personFilters = [
          [capacityFilter.pm, pa['Due Diligence']],
          [capacityFilter.cm, pa['Construction']],
          [capacityFilter.pd, pa['Permitting']],
        ].filter(([f]) => f);
        if (personFilters.length) {
          const byPerson = new Map();
          for (const [f, v] of personFilters) {
            if (!byPerson.has(f)) byPerson.set(f, []);
            byPerson.get(f).push(v);
          }
          const allMatch = [...byPerson.entries()].every(([f, vals]) => vals.some(v => (v || '') === f));
          if (!allMatch) continue;
        }
        rows.push({ prog, proj });
      }

    if (!rows.length) {
      container.innerHTML = filterBars + '<p class="gantt-empty">No projects match the selected filters.</p>';
      return;
    }

    const today = CPM.todayIso();

    // Pre-compute phase dates for all rows (reused for date range + bar rendering)
    const pdCache = new Map(rows.map(({ proj }) => {
      const m = {};
      for (const phase of PHASES) m[phase] = getPhaseDates(proj.tasks, phase, today);
      return [proj.id, m];
    }));

    // Sort: phase start overrides if set; alphabetical by program then project always as base/tiebreaker
    rows.sort((a, b) => {
      if (capacitySort.phase) {
        const da = pdCache.get(a.proj.id)[capacitySort.phase];
        const db = pdCache.get(b.proj.id)[capacitySort.phase];
        const sa = (da && da.start) ? da.start : 'zzzz';
        const sb = (db && db.start) ? db.start : 'zzzz';
        const cmp = sa.localeCompare(sb);
        if (cmp !== 0) return capacitySort.dir === 'asc' ? cmp : -cmp;
      }
      const progCmp = a.prog.name.localeCompare(b.prog.name);
      if (progCmp !== 0) return progCmp;
      return a.proj.name.localeCompare(b.proj.name);
    });

    // Date range: 12 months before today through 18 months ahead
    const todayDay  = CPM.isoToDay(today);
    const [ty, tm, td] = today.split('-').map(Number);
    const minDay    = CPM.isoToDay(new Date(Date.UTC(ty, tm - 1 - 12, td)).toISOString().slice(0, 10));
    const maxDay    = CPM.isoToDay(new Date(Date.UTC(ty, tm - 1 + 18, td)).toISOString().slice(0, 10));
    const totalDays = maxDay - minDay + 1;

    // Layout
    const LABEL_W  = 260;
    const HEADER_H = 48;
    const ROW_H    = 44;
    const BAR_H    = 18;
    const BAR_PAD  = (ROW_H - BAR_H) / 2;
    const WEEK_W   = 20;                        // px per week — increase to widen
    const DAY_W    = WEEK_W / 7;               // ≈ 2.9 px/day
    const svgW  = LABEL_W + totalDays * DAY_W;
    const bodyH = rows.length * ROW_H;

    const chartW  = totalDays * DAY_W;
    const todayX  = (todayDay - minDay) * DAY_W + DAY_W / 2;

    function mkSvg(w, h, html) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.setAttribute('width', w); el.setAttribute('height', h);
      el.style.display = 'block'; el.innerHTML = html; return el;
    }

    // ── Left column: label header SVG ──────────────────────────────────────
    let sLblHdr = '';
    sLblHdr += `<rect x="0" y="0" width="${LABEL_W}" height="${HEADER_H}" fill="#f1f5f9"/>`;
    sLblHdr += `<line x1="0" y1="${HEADER_H - 1}" x2="${LABEL_W}" y2="${HEADER_H - 1}" stroke="#cbd5e1" stroke-width="1.5"/>`;
    sLblHdr += `<text x="10" y="20" class="g-label-hdr">Program / Project</text>`;
    sLblHdr += `<text x="10" y="37" class="g-label-hdr">PM / CM / PD</text>`;

    // ── Left column: label body SVG ────────────────────────────────────────
    let sLblBody = '';
    sLblBody += `<defs><clipPath id="capLblClip"><rect x="0" y="0" width="${LABEL_W - 6}" height="${bodyH}"/></clipPath></defs>`;
    sLblBody += `<rect x="0" y="0" width="${LABEL_W}" height="${bodyH}" fill="#f8fafc"/>`;
    rows.forEach((_, i) => {
      const y = i * ROW_H;
      if (i % 2 === 1) sLblBody += `<rect x="0" y="${y}" width="${LABEL_W}" height="${ROW_H}" fill="#fafbfc"/>`;
      sLblBody += `<line x1="0" y1="${y + ROW_H}" x2="${LABEL_W}" y2="${y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
    });
    rows.forEach(({ prog, proj }, i) => {
      const rowY = i * ROW_H, midY = rowY + ROW_H / 2;
      const pa  = proj.phaseAssignees || {};
      const pmN = pa['Due Diligence'] || '', cmN = pa['Construction'] || '', pdN = pa['Permitting'] || '';
      const projLabel = (proj.number ? proj.number + ' ' : '') + proj.name;
      const combined = prog.name + ' \u00b7 ' + projLabel;
      const labelStr = combined.length > 30 ? combined.slice(0, 29) + '\u2026' : combined;
      sLblBody += `<text x="10" y="${midY - 5}" class="g-label-name cap-proj-link" clip-path="url(#capLblClip)"
             onclick="App.navigateToProject('${proj.id}')" title="${esc(combined)}">${esc(labelStr)}</text>`;
      const meta = [pmN ? 'PM:\u00a0' + pmN : '', cmN ? 'CM:\u00a0' + cmN : '', pdN ? 'PD:\u00a0' + pdN : ''].filter(Boolean).join('  \u00b7  ');
      if (meta) sLblBody += `<text x="10" y="${midY + 10}" class="cap-meta-label" clip-path="url(#capLblClip)">${esc(meta)}</text>`;
    });

    // ── Right column: chart header SVG ─────────────────────────────────────
    let sChartHdr = '';
    sChartHdr += `<rect x="0" y="0" width="${chartW}" height="${HEADER_H}" fill="#f8fafc"/>`;
    sChartHdr += `<line x1="0" y1="${HEADER_H - 1}" x2="${chartW}" y2="${HEADER_H - 1}" stroke="#cbd5e1" stroke-width="1.5"/>`;
    let prevMonth = -1;
    for (let d = 0; d < totalDays; d++) {
      const iso = CPM.dayToIso(minDay + d);
      const [yr, mo] = iso.split('-').map(Number);
      const x = d * DAY_W;
      if (mo !== prevMonth) {
        if (d > 0) sChartHdr += `<line x1="${x}" y1="0" x2="${x}" y2="${HEADER_H}" stroke="#e2e8f0" stroke-width="1"/>`;
        let monthEndD = d + 1;
        while (monthEndD < totalDays && parseInt(CPM.dayToIso(minDay + monthEndD).split('-')[1]) === mo) monthEndD++;
        if ((monthEndD - d) * DAY_W > 44)
          sChartHdr += `<text x="${x + 4}" y="17" class="g-month">${MONTHS[mo - 1]} ${yr}</text>`;
        prevMonth = mo;
      }
      if (new Date(iso + 'T12:00:00Z').getUTCDay() === 1)
        sChartHdr += `<line x1="${x}" y1="${HEADER_H - 7}" x2="${x}" y2="${HEADER_H}" stroke="#cbd5e1" stroke-width="1"/>`;
    }
    if (todayX >= 0 && todayX < chartW) {
      sChartHdr += `<line x1="${todayX}" y1="0" x2="${todayX}" y2="${HEADER_H}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>`;
      sChartHdr += `<text x="${todayX + 3}" y="${HEADER_H - 10}" class="g-today-label">Today</text>`;
    }

    // ── Right column: chart body SVG ───────────────────────────────────────
    let sChartBody = '';
    sChartBody += `<defs><clipPath id="capChartClip"><rect x="0" y="0" width="${chartW}" height="${bodyH}"/></clipPath></defs>`;
    sChartBody += `<rect x="0" y="0" width="${chartW}" height="${bodyH}" fill="#fff"/>`;
    for (let d = 0; d < totalDays; d++) {
      const iso = CPM.dayToIso(minDay + d);
      if (new Date(iso + 'T12:00:00Z').getUTCDay() % 6 === 0)
        sChartBody += `<rect x="${d * DAY_W}" y="0" width="${DAY_W}" height="${bodyH}" fill="#f9fafb"/>`;
    }
    rows.forEach((_, i) => {
      const y = i * ROW_H;
      if (i % 2 === 1) sChartBody += `<rect x="0" y="${y}" width="${chartW}" height="${ROW_H}" fill="#fafbfc"/>`;
      sChartBody += `<line x1="0" y1="${y + ROW_H}" x2="${chartW}" y2="${y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
    });
    if (todayX >= 0 && todayX < chartW)
      sChartBody += `<line x1="${todayX}" y1="0" x2="${todayX}" y2="${bodyH}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>`;
    // Blend two or more hex colors by averaging RGB channels
    function hexBlend(...hexes) {
      const ch = hexes.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
      return '#' + [0,1,2].map(i => Math.round(ch.reduce((s,v) => s+v[i], 0) / ch.length).toString(16).padStart(2,'0')).join('');
    }

    let barsStr = '';
    rows.forEach(({ proj }, i) => {
      const rowY = i * ROW_H;
      const barY = rowY + BAR_PAD;

      // Collect phase bars present for this row
      const bars = [];
      PHASES.forEach(phase => {
        const pd = pdCache.get(proj.id)[phase];
        if (!pd || !pd.start || !pd.end) return;
        const colors = PHASE_COLORS[phase] || { bg: '#e2e8f0', text: '#475569' };
        const startD = CPM.isoToDay(pd.start) - minDay;
        const endD   = CPM.isoToDay(pd.end)   - minDay;
        bars.push({ phase, startD, endD, colors, pd });
      });

      // Draw base bar rects
      bars.forEach(({ phase, startD, endD, colors, pd }) => {
        const barX = startD * DAY_W;
        const barW = Math.max((endD - startD + 1) * DAY_W, 4);
        barsStr += `<rect x="${barX}" y="${barY}" width="${barW}" height="${BAR_H}" rx="3"
               fill="${colors.bg}" stroke="${colors.text}" stroke-width="1.5" stroke-opacity="0.5">
               <title>${esc(phase)}: ${pd.start} \u2192 ${pd.end} | ${pd.complete}/${pd.total} complete</title>
             </rect>`;
      });

      // Draw blended overlay wherever two or more bars overlap
      for (let a = 0; a < bars.length; a++) {
        for (let b = a + 1; b < bars.length; b++) {
          const A = bars[a], B = bars[b];
          const oStart = Math.max(A.startD, B.startD);
          const oEnd   = Math.min(A.endD,   B.endD);
          if (oStart > oEnd) continue;
          const blendBg   = hexBlend(A.colors.bg,   B.colors.bg);
          const blendText = hexBlend(A.colors.text, B.colors.text);
          const x = oStart * DAY_W;
          const w = Math.max((oEnd - oStart + 1) * DAY_W, 4);
          barsStr += `<rect x="${x}" y="${barY}" width="${w}" height="${BAR_H}" rx="0"
                 fill="${blendBg}" stroke="${blendText}" stroke-width="1.5" stroke-opacity="0.5">
                 <title>${esc(A.phase)} + ${esc(B.phase)}: overlap</title>
               </rect>`;
        }
      }

      // Draw labels on top of everything (including blend overlays)
      const LABELED_PHASES = new Set(['Due Diligence', 'Design', 'Permitting', 'Bidding', 'Construction']);
      const PHASE_LABELS   = { 'Due Diligence': 'DD', 'Design': 'Design', 'Permitting': 'Permit', 'Bidding': 'Bid', 'Construction': 'Construction' };
      const labeledBars    = bars.filter(b => LABELED_PHASES.has(b.phase) && Math.max((b.endD - b.startD + 1) * DAY_W, 4) > 34);
      const labelY         = barY + BAR_H / 2 + 4;

      // Default label X to bar center; shift into non-overlapping region when two labeled bars overlap
      const labelXMap = new Map(labeledBars.map(b => [b.phase, b.startD * DAY_W + Math.max((b.endD - b.startD + 1) * DAY_W, 4) / 2]));
      for (let a = 0; a < labeledBars.length; a++) {
        for (let b = a + 1; b < labeledBars.length; b++) {
          const A = labeledBars[a], B = labeledBars[b];
          const oStart = Math.max(A.startD, B.startD);
          const oEnd   = Math.min(A.endD,   B.endD);
          if (oStart > oEnd) continue;
          // Earlier-starting bar → label in its left (pre-overlap) region
          // Later-starting bar  → label in its right (post-overlap) region
          const [first, second] = A.endD <= B.endD ? [A, B] : [B, A];
          if (first.startD < oStart)
            labelXMap.set(first.phase,  (first.startD + oStart) / 2 * DAY_W);
          if (second.endD > oEnd)
            labelXMap.set(second.phase, (oEnd + second.endD + 2) / 2 * DAY_W);
        }
      }

      labeledBars.forEach(({ phase, startD, endD, colors }) => {
        const barX   = startD * DAY_W;
        const barW   = Math.max((endD - startD + 1) * DAY_W, 4);
        const labelX = Math.max(barX + 6, Math.min(barX + barW - 6, labelXMap.get(phase)));
        barsStr += `<text x="${labelX}" y="${labelY}"
               class="cap-bar-label" text-anchor="middle" fill="${colors.text}" pointer-events="none"
               >${esc(PHASE_LABELS[phase])}</text>`;
      });
    });
    sChartBody += `<g clip-path="url(#capChartClip)">${barsStr}</g>`;

    // ── Assemble: single-scroll layout with sticky label column ────────────
    const lblHdrDiv = document.createElement('div');
    lblHdrDiv.className = 'cap-lbl-hdr';
    lblHdrDiv.appendChild(mkSvg(LABEL_W, HEADER_H, sLblHdr));

    const chartHdrDiv = document.createElement('div');
    chartHdrDiv.className = 'cap-chart-hdr-div';
    chartHdrDiv.appendChild(mkSvg(chartW, HEADER_H, sChartHdr));

    const hdrRow = document.createElement('div');
    hdrRow.className = 'cap-hdr-row';
    hdrRow.appendChild(lblHdrDiv);
    hdrRow.appendChild(chartHdrDiv);

    const lblCol = document.createElement('div');
    lblCol.className = 'cap-labels-col';
    lblCol.appendChild(mkSvg(LABEL_W, bodyH, sLblBody));

    const chartCol = document.createElement('div');
    chartCol.className = 'cap-chart-col';
    chartCol.appendChild(mkSvg(chartW, bodyH, sChartBody));

    const bodyRow = document.createElement('div');
    bodyRow.className = 'cap-body-row';
    bodyRow.appendChild(lblCol);
    bodyRow.appendChild(chartCol);

    const legendHtml = '<div class="gantt-legend-bar">' +
      PHASES.map(p => {
        const c        = PHASE_COLORS[p] || { bg: '#e2e8f0', text: '#475569' };
        const isActive = capacitySort.phase === p;
        const arrow    = isActive ? (capacitySort.dir === 'asc' ? ' \u2191' : ' \u2193') : '';
        const dotStyle = isActive
          ? `background:${c.bg};outline:2.5px solid ${c.text};`
          : `background:${c.bg};outline:1.5px solid ${c.text}60`;
        const title    = isActive
          ? (capacitySort.dir === 'asc' ? 'Sort latest first' : 'Clear sort')
          : `Sort by ${p} start`;
        return `<span class="legend-item cap-legend-sort${isActive ? ' cap-legend-sort-active' : ''}"
                      style="${isActive ? `font-weight:700;color:${c.text};` : ''}"
                      onclick="App.sortCapacity('${p.replace(/'/g, "\\'")}')"
                      title="${esc(title)}">
                  <span class="legend-dot" style="${dotStyle}"></span>${esc(p)}${arrow}
                </span>`;
      }).join('') + '</div>';

    const legendStrip = document.createElement('div');
    legendStrip.className = 'cap-legend-strip';
    legendStrip.style.marginLeft = LABEL_W + 'px';
    legendStrip.innerHTML = legendHtml;

    const inner = document.createElement('div');
    inner.className = 'cap-inner';
    inner.style.width = (LABEL_W + chartW) + 'px';
    inner.appendChild(hdrRow);
    inner.appendChild(bodyRow);

    const scrollCont = document.createElement('div');
    scrollCont.className = 'cap-scroll-container';
    scrollCont.appendChild(inner);

    container.innerHTML = filterBars;
    const wrap = document.createElement('div');
    wrap.className = 'capacity-chart-wrap';
    wrap.appendChild(legendStrip);
    wrap.appendChild(scrollCont);
    container.appendChild(wrap);
  }

  function filterCapacity(type, val) {
    capacityFilter[type] = val;
    renderCapacityView();
  }

  function sortCapacity(phase) {
    if (capacitySort.phase === phase) {
      if (capacitySort.dir === 'asc') { capacitySort.dir = 'desc'; }
      else { capacitySort.phase = ''; capacitySort.dir = 'asc'; }
    } else {
      capacitySort.phase = phase;
      capacitySort.dir = 'asc';
    }
    renderCapacityView();
  }

  function setPhaseAssignee(phase, name) {
    const proj = getActiveProject(); if (!proj) return;
    if (!proj.phaseAssignees) proj.phaseAssignees = {};
    const id = name.trim();
    proj.phaseAssignees[phase] = id;
    if (id) _grantProjectAccess(proj.id, id);
    save();
  }

  function navigateToProject(projId) {
    setActiveProject(projId);
    setTab('project');
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('sidebarList');
    if (!list) return;
    const isArchive = currentTab === 'archive';
    const activeId  = isArchive ? state.archiveActiveProjectId : state.activeProjectId;

    // Update sidebar header
    const labelEl   = document.getElementById('sidebarTopLabel');
    const addProgEl = document.getElementById('sidebarAddProgBtn');
    if (labelEl)   labelEl.textContent = isArchive ? 'Archived' : 'Programs';
    if (addProgEl) addProgEl.classList.toggle('hidden', isArchive);

    // Sync filter button (hidden on archive tab)
    const sfBtn = document.getElementById('sidebarFilterBtn');
    if (sfBtn) {
      sfBtn.classList.toggle('hidden', isArchive);
      sfBtn.textContent = summaryProjectFilter.charAt(0).toUpperCase() + summaryProjectFilter.slice(1);
    }

    const today = CPM.todayIso();
    list.innerHTML = [...state.programs].sort((a, b) => a.name.localeCompare(b.name)).map(prog => {
      const progVisible = Auth.canViewProgram(prog.id); // program_manager assigned to this program
      const filtered = prog.projects.filter(p =>
        (isArchive ? !!p.archived : !p.archived) &&
        (Auth.canViewProject(p.id) || progVisible) &&
        (isArchive || !myProjectsOnly || isMyProject(p)) &&
        (isArchive || summaryProjectFilter === 'all' ||
         (summaryProjectFilter === 'active'   && (p.tasks || []).length > 0) ||
         (summaryProjectFilter === 'pipeline' && (p.tasks || []).length === 0))
      ).sort((a, b) => a.name.localeCompare(b.name));
      if (!filtered.length && (isArchive || (!Auth.can('addProject') || (!Auth.can('viewAll') && !progVisible)))) return '';
      const isOpen = expanded.has(prog.id);
      const projHtml = isOpen ? filtered.map(proj => {
        const isActive = proj.id === activeId;
        const canAct   = Auth.can('archiveProject') && (Auth.can('viewAll') || progVisible || Auth.canViewProject(proj.id));
        const actionBtn = !canAct ? '' : isArchive
          ? `<div class="proj-action-group">
               <button class="proj-action-btn" onclick="event.stopPropagation();App.restoreProject('${proj.id}')" title="Restore to active">\u21A9 Restore</button>
               <button class="proj-action-btn proj-del-btn" onclick="event.stopPropagation();App.deleteProject('${proj.id}')" title="Delete permanently">&times;</button>
             </div>`
          : `<div class="proj-action-group">
               <button class="proj-action-btn" onclick="event.stopPropagation();App.archiveProject('${proj.id}')" title="Move to archive">Archive</button>
               <button class="proj-action-btn proj-del-btn" onclick="event.stopPropagation();App.deleteProject('${proj.id}')" title="Delete permanently">&times;</button>
             </div>`;
        return `<div class="proj-item ${isActive ? 'active' : ''}" onclick="App.setActiveProject('${proj.id}')">
          <span class="proj-name">${proj.number ? `<span class="proj-num">${esc(proj.number)}</span> ` : ''}${esc(proj.name)}</span>
          ${actionBtn}
        </div>`;
      }).join('') : '';
      // Add-project btn: visible when user can add AND is scoped to this program (or has global access)
      const canAddHere = !isArchive && Auth.can('addProject') && (Auth.can('viewAll') || progVisible || Auth.can('addProgram'));
      const addBtn = canAddHere ? `<button class="prog-add-btn" onclick="event.stopPropagation();App.addProject('${prog.id}')" title="Add project">+</button>` : '';
      // Delete-program btn: only users with addProgram permission (admin, user)
      const delBtn = (!isArchive && Auth.can('addProgram')) ? `<button class="prog-del-btn" onclick="event.stopPropagation();App.deleteProgram('${prog.id}')" title="Delete program">&times;</button>` : '';
      return `<div class="prog-group">
        <div class="prog-header" onclick="App.toggleProgram('${prog.id}')">
          <span class="prog-chevron ${isOpen ? 'open' : ''}">&#9654;</span>
          <span class="prog-name">${esc(prog.name)}</span>
          ${addBtn}${delBtn}
        </div>
        <div class="proj-list">${projHtml}</div>
      </div>`;
    }).join('');

    if (isArchive && !state.programs.some(p => p.projects.some(pr => pr.archived))) {
      list.innerHTML = '<div class="archive-empty-msg">No archived projects yet</div>';
    }
  }

  function toggleProgram(progId) {
    expanded.has(progId) ? expanded.delete(progId) : expanded.add(progId);
    renderSidebar();
  }

  function setActiveProject(projId) {
    if (currentTab === 'archive') state.archiveActiveProjectId = projId;
    else {
      state.activeProjectId = projId;
      expanded.clear();
      _expandActiveProgram();
    }
    Gantt.reset();
    save();
    if (currentTab === 'summary' || currentTab === 'capacity') {
      setTab('project'); // switches tab and handles all rendering
    } else {
      renderSidebar(); syncHeader(); recompute(); render();
    }
  }

  function addProgram() {
    const name = prompt('Program name:');
    if (!name || !name.trim()) return;
    const progId = genId('prog');
    expanded.add(progId);
    state.programs.push({ id: progId, name: name.trim(), projects: [] });
    save(); renderSidebar();
  }

  function deleteProgram(progId) {
    const prog = state.programs.find(p => p.id === progId);
    if (!prog) return;
    const projCount = prog.projects.length;
    const msg = projCount
      ? `Delete program "${prog.name}" and its ${projCount} project${projCount !== 1 ? 's' : ''}? This cannot be undone.`
      : `Delete program "${prog.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    const projIds = new Set(prog.projects.map(p => p.id));
    state.programs = state.programs.filter(p => p.id !== progId);
    if (projIds.has(state.activeProjectId))        state.activeProjectId        = _nextProjectId(false);
    if (projIds.has(state.archiveActiveProjectId)) state.archiveActiveProjectId = _nextProjectId(true);
    save(); renderSidebar(); syncHeader(); recompute(); render();
  }

  function addProject(progId) {
    const prog = state.programs.find(p => p.id === progId);
    if (!prog) return;
    const name = prompt(`New project under "${prog.name}":`);
    if (!name || !name.trim()) return;
    const projId = genId('proj');
    prog.projects.push({ id: projId, name: name.trim(), startDate: CPM.todayIso(), tasks: [], phaseAssignees: {}, phases: [] });
    expanded.add(progId);
    state.activeProjectId = projId;
    save(); renderSidebar(); syncHeader(); recompute(); render();
  }

  // ── Archive / Restore ──────────────────────────────────────────────────────
  function archiveProject(projId) {
    let proj = null;
    for (const prog of state.programs) {
      proj = prog.projects.find(p => p.id === projId);
      if (proj) break;
    }
    if (!proj || !confirm(`Move "${proj.name}" to archive?`)) return;
    proj.archived = true;
    state.archiveActiveProjectId = projId;
    if (state.activeProjectId === projId) {
      state.activeProjectId = _nextProjectId(false);
      syncHeader(); recompute(); render();
    }
    save(); renderSidebar();
  }

  function restoreProject(projId) {
    for (const prog of state.programs) {
      const proj = prog.projects.find(p => p.id === projId);
      if (proj) {
        proj.archived = false;
        state.activeProjectId = projId;
        state.archiveActiveProjectId = null;
        save();
        setTab('project');
        return;
      }
    }
  }

  function restoreCurrentProject() {
    const proj = getActiveProject();
    if (proj) restoreProject(proj.id);
  }

  function deleteProject(projId) {
    let proj = null, prog = null;
    for (const p of state.programs) {
      const found = p.projects.find(pr => pr.id === projId);
      if (found) { proj = found; prog = p; break; }
    }
    if (!proj || !confirm(`Permanently delete "${proj.name}"? This cannot be undone.`)) return;
    prog.projects = prog.projects.filter(p => p.id !== projId);
    if (state.activeProjectId === projId)        state.activeProjectId        = _nextProjectId(false);
    if (state.archiveActiveProjectId === projId) state.archiveActiveProjectId = _nextProjectId(true);
    save(); renderSidebar(); syncHeader(); recompute(); render();
  }

  // ── Template storage ───────────────────────────────────────────────────────
  function loadCustomTemplates() {
    try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); }
    catch(e) { return []; }
  }

  function saveCustomTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  // Serialize current tasks into slot-indexed format (IDs stripped, deps use slot index)
  function tasksToTemplateFormat(tasks) {
    const indexMap = new Map(tasks.map((t, i) => [t.id, i]));
    return tasks.map(t => ({
      name: t.name,
      phase: t.phase,
      duration: t.duration,
      dependencies: t.dependencies
        .filter(d => indexMap.has(d.taskId))
        .map(d => ({ slot: indexMap.get(d.taskId), type: d.type, lag: d.lag || 0 })),
    }));
  }

  // Apply an array of template task definitions to the active project
  function applyTemplateTasks(templateTasks) {
    const proj = getActiveProject(); if (!proj) return;
    if (proj.tasks.length > 0 && !confirm('Replace existing tasks with this template?')) return;
    const ids = templateTasks.map(() => genId('t'));
    proj.tasks = templateTasks.map((def, i) => ({
      id: ids[i],
      name: def.name,
      phase: def.phase,
      duration: def.duration,
      assignee: '',
      status: 'not_started',
      actualStart: null,
      actualEnd: null,
      plannedStart: null,
      plannedEnd: null,
      dependencies: (def.dependencies || [])
        .filter(d => d.slot != null && d.slot < ids.length)
        .map(d => ({ taskId: ids[d.slot], type: d.type, lag: d.lag || 0 })),
    }));
    const seenPhases = new Set(proj.tasks.map(t => t.phase).filter(Boolean));
    proj.phases = PHASES.filter(p => seenPhases.has(p));
    proj.tasks.forEach(t => { if (t.phase && !proj.phases.includes(t.phase)) proj.phases.push(t.phase); });
    recompute(); save(); render(); closeTemplateModal();
  }

  // ── Template loader ────────────────────────────────────────────────────────
  function saveAsTemplate() {
    const proj = getActiveProject();
    if (!proj || !proj.tasks.length) { alert('No tasks to save — add tasks first.'); return; }
    const name = prompt('Template name:');
    if (!name || !name.trim()) return;
    const templates = loadCustomTemplates();
    templates.push({
      id: genId('tmpl'),
      name: name.trim(),
      createdAt: CPM.todayIso(),
      tasks: tasksToTemplateFormat(proj.tasks),
    });
    saveCustomTemplates(templates);
    renderTemplateModal();
  }

  function updateTemplate(id) {
    const proj = getActiveProject();
    if (!proj || !proj.tasks.length) { alert('No tasks in current project to save.'); return; }
    const templates = loadCustomTemplates();
    const tmpl = templates.find(t => t.id === id);
    if (!tmpl || !confirm(`Overwrite "${tmpl.name}" with the current project's tasks?`)) return;
    tmpl.tasks = tasksToTemplateFormat(proj.tasks);
    tmpl.updatedAt = CPM.todayIso();
    saveCustomTemplates(templates);
    renderTemplateModal();
  }

  function applyCustomTemplate(id) {
    const tmpl = loadCustomTemplates().find(t => t.id === id);
    if (tmpl) applyTemplateTasks(tmpl.tasks);
  }

  function deleteCustomTemplate(id) {
    const templates = loadCustomTemplates();
    const tmpl = templates.find(t => t.id === id);
    if (!tmpl || !confirm(`Delete template "${tmpl.name}"?`)) return;
    saveCustomTemplates(templates.filter(t => t.id !== id));
    renderTemplateModal();
  }

  function openTemplateModal() {
    renderTemplateModal();
    document.getElementById('templateModal').classList.remove('hidden');
  }

  function closeTemplateModal() {
    document.getElementById('templateModal').classList.add('hidden');
  }

  function renderTemplateModal() {
    const templates = loadCustomTemplates();

    let html = `<div class="tmpl-section-label">My Templates</div>`;

    if (!templates.length) {
      html += `<div class="tmpl-empty">No custom templates yet &mdash; click <strong>Save Current Project as Template</strong> below to create one.</div>`;
    } else {
      templates.forEach(tmpl => {
        const metaDate = tmpl.updatedAt ? `updated ${tmpl.updatedAt}` : `saved ${tmpl.createdAt}`;
        html += `
          <div class="tmpl-item">
            <div class="tmpl-item-info">
              <div class="tmpl-item-name">${esc(tmpl.name)}</div>
              <div class="tmpl-item-meta">${tmpl.tasks.length} task${tmpl.tasks.length !== 1 ? 's' : ''} &bull; ${metaDate}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn btn-primary btn-sm" onclick="App.applyCustomTemplate('${tmpl.id}')">Load</button>
              <button class="btn btn-sm" onclick="App.updateTemplate('${tmpl.id}')" title="Overwrite with current project tasks">Update</button>
              <button class="btn btn-sm tmpl-del-btn" onclick="App.deleteCustomTemplate('${tmpl.id}')" title="Delete template">&times;</button>
            </div>
          </div>`;
      });
    }

    document.getElementById('templateModalBody').innerHTML = html;
  }

  // ── Export / Import ────────────────────────────────────────────────────────
  function printDoc() {
    const proj = getActiveProject();
    const originalTitle = document.title;
    const d = CPM.todayIso().replace(/-/g, '');
    if (currentTab === 'capacity') {
      document.title = d + ' CM Capacity';
    } else if (currentTab === 'summary') {
      const prog = summaryFilter ? state.programs.find(p => p.id === summaryFilter) : null;
      document.title = d + (prog ? ' ' + prog.name : '') + ' Program Summary';
    } else if ((currentTab === 'project' || currentTab === 'archive') && proj && proj.name) {
      document.title = proj.name + (currentView === 'gantt' ? ' Gantt' : ' Checklist');
    }

    // For Gantt: swap in a real <thead>/<tbody> table so the header repeats on every page
    const ganttCleanup = (currentView === 'gantt') ? _buildGanttPrintTable() : null;

    // Register BEFORE window.print() — Chrome fires afterprint synchronously during print()
    window.addEventListener('afterprint', function restore() {
      document.title = originalTitle;
      if (ganttCleanup) ganttCleanup();
      window.removeEventListener('afterprint', restore);
    });

    window.print();
  }

  function _buildGanttPrintTable() {
    const wrapper = document.getElementById('ganttWrapper');
    if (!wrapper) return null;
    const inner = wrapper.querySelector('.gantt-inner');
    if (!inner) return null;
    const cornerSvg  = inner.querySelector('.gantt-corner svg');
    const dateHdrSvg = inner.querySelector('.gantt-date-hdr-wrap svg');
    const labelSvg   = inner.querySelector('.gantt-label-col svg');
    const chartSvg   = inner.querySelector('.gantt-chart-body svg');
    if (!cornerSvg || !dateHdrSvg || !labelSvg || !chartSvg) return null;

    const bodyH = parseInt(labelSvg.getAttribute('height'));
    const lblW  = parseInt(labelSvg.getAttribute('width'));
    const cW    = parseInt(chartSvg.getAttribute('width'));
    const hdrH  = parseInt(dateHdrSvg.getAttribute('height')); // 48

    // Printable body height per page: 11in page at 96 CSS dpi, 0.5in margins each side, minus gantt header
    const PAGE_BODY_H = Math.round(11 * 96 - 2 * 0.5 * 96 - hdrH); // ~912

    // Snap page break points to row boundaries so no row is ever split
    const rowBreaks = Gantt.getRowBreaks(); // sorted array: [0, 26, 66, 106, ..., bodyH]
    const slices = []; // [{y, h}] one entry per printed page
    let pageStart = 0;
    while (pageStart < bodyH) {
      // Largest row boundary that fits within one page from pageStart
      let pageEnd = pageStart;
      for (const b of rowBreaks) {
        if (b > pageStart && b - pageStart <= PAGE_BODY_H) pageEnd = b;
      }
      // Safety: if a single row is taller than a full page, take it anyway
      if (pageEnd === pageStart) {
        const next = rowBreaks.find(b => b > pageStart) || bodyH;
        pageEnd = next;
      }
      slices.push({ y: pageStart, h: pageEnd - pageStart });
      pageStart = pageEnd;
    }

    // Return a clone of src showing only the vertical slice from y to y+h
    const mkSlice = (src, y, w, h) => {
      const s = src.cloneNode(true);
      s.setAttribute('viewBox', `0 ${y} ${w} ${h}`);
      s.setAttribute('height', String(h));
      s.setAttribute('width',  String(w));
      return s;
    };

    // One <table> per page — each has its own <thead> so the header is
    // guaranteed to appear at the top of every page. break-before:page on
    // tables 2+ forces Chrome to start a new page before the table.
    const container = document.createElement('div');
    container.id = 'gantt-print-container';

    for (let i = 0; i < slices.length; i++) {
      const { y, h: sliceH } = slices[i];

      const tbl = document.createElement('table');
      tbl.className = 'gantt-print-table';
      if (i > 0) tbl.style.breakBefore = 'page';

      // Own <thead> on every table — header appears on every page
      const thead = tbl.createTHead();
      const hdrRow = thead.insertRow();
      [cornerSvg, dateHdrSvg].forEach(svg => {
        const td = document.createElement('td');
        td.appendChild(svg.cloneNode(true));
        hdrRow.appendChild(td);
      });

      // Single <tbody> row with this page's vertical slice
      const tbody = tbl.createTBody();
      const row = tbody.insertRow();
      [[lblW, labelSvg], [cW, chartSvg]].forEach(([w, src]) => {
        const td = document.createElement('td');
        td.appendChild(mkSlice(src, y, w, sliceH));
        row.appendChild(td);
      });

      container.appendChild(tbl);
    }

    // Detach inner entirely so !important print CSS can't make it visible again
    wrapper.removeChild(inner);
    wrapper.appendChild(container);

    return () => { container.remove(); wrapper.insertBefore(inner, wrapper.firstChild); };
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'pm_workflow_' + CPM.todayIso() + '.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function saveDataFile() {
    const payload = { state, templates: loadCustomTemplates() };
    const content = 'window.__CDS_STATE__ = ' + JSON.stringify(payload.state, null, 2) + ';\n'
                  + 'window.__CDS_TEMPLATES__ = ' + JSON.stringify(payload.templates, null, 2) + ';\n';
    const blob = new Blob([content], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'data.js'; a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const imp = JSON.parse(ev.target.result);
          if (!Array.isArray(imp.programs)) throw new Error('Invalid format');
          state = imp;
          state.programs.forEach(prog => { prog.projects.forEach(proj => { proj.tasks = proj.tasks || []; proj.phaseAssignees = proj.phaseAssignees || {}; }); });
          _expandActiveProgram();
          if (!state.activeProjectId) state.activeProjectId = state.programs[0]?.projects[0]?.id;
          if (!('archiveActiveProjectId' in state)) state.archiveActiveProjectId = null;
          recompute(); save(); renderSidebar(); syncHeader(); render();
        } catch (err) { alert('Import failed: ' + err.message); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Summary bar ────────────────────────────────────────────────────────────
  function updateSummary() {
    const proj  = getActiveProject();
    const tasks = proj ? proj.tasks : [];
    const total = tasks.length;
    const today = CPM.todayIso();
    let complete = 0, inProg = 0, overdue = 0;
    for (const t of tasks) {
      if (t.status === 'complete') complete++;
      else if (t.status === 'in_progress') inProg++;
      if (t.status !== 'complete' && t.plannedEnd && t.plannedEnd < today) overdue++;
    }
    const pct = total ? Math.round((complete / total) * 100) : 0;
    document.getElementById('sumTotal').textContent    = `${total} task${total !== 1 ? 's' : ''}`;
    document.getElementById('sumComplete').textContent = `\u2713 ${complete} complete (${pct}%)`;
    document.getElementById('sumInProg').textContent   = `${inProg} in progress`;
    const od = document.getElementById('sumOverdue');
    od.textContent = overdue ? `\u26A0 ${overdue} overdue` : ''; od.className = overdue ? 'sum-item overdue-text' : 'sum-item';
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent  = pct + '%';
  }

  // ── Address bar ────────────────────────────────────────────────────────────
  function renderAddressBar() {
    const progNameEl   = document.getElementById('pmProgName');
    const projNumEl    = document.getElementById('pmProjNumInput');
    const projNameEl   = document.getElementById('pmProjNameInput');
    const addrInput    = document.getElementById('pmAddressInput');
    const mapBtn       = document.getElementById('pmMapBtn');
    const commentInput = document.getElementById('pmCommentInput');
    if (!progNameEl) return;

    const proj = getActiveProject();
    if (!proj) {
      progNameEl.textContent = '';
      if (projNumEl)  projNumEl.value  = '';
      projNameEl.value = '';
      addrInput.value  = '';
      mapBtn.classList.add('hidden');
      if (commentInput) commentInput.value = '';
      return;
    }

    progNameEl.textContent = getActiveProgramName();

    // Only overwrite inputs when switching to a different project
    // so we don't clobber text the user is actively editing
    if (projNameEl.dataset.pid !== proj.id) {
      if (projNumEl)  { projNumEl.value = proj.number || ''; projNumEl.dataset.pid = proj.id; }
      projNameEl.value       = proj.name;
      projNameEl.dataset.pid = proj.id;
      addrInput.value        = proj.address || '';
      addrInput.dataset.pid  = proj.id;
    }
    if (commentInput && document.activeElement !== commentInput) {
      commentInput.value = proj.comment || '';
    }

    const addr = proj.address || '';
    mapBtn.href = addr ? 'https://www.google.com/maps?q=' + encodeURIComponent(addr) : '#';
    mapBtn.classList.toggle('hidden', !addr);
  }

  function setProjectName(val) {
    const proj = getActiveProject(); if (!proj) return;
    proj.name = val;
    save(); renderSidebar();
  }

  function setProjectNumber(val) {
    const proj = getActiveProject(); if (!proj) return;
    proj.number = val.trim();
    save(); renderSidebar();
  }

  function setProjectAddress(value) {
    const proj = getActiveProject(); if (!proj) return;
    proj.address = value.trim();
    save();
    const btn = document.getElementById('pmMapBtn');
    if (btn) {
      btn.href = proj.address ? 'https://www.google.com/maps?q=' + encodeURIComponent(proj.address) : '#';
      btn.classList.toggle('hidden', !proj.address);
    }
    // Keep data-pid in sync so renderAddressBar doesn't overwrite while user is on this project
    const addrInput = document.getElementById('pmAddressInput');
    if (addrInput) addrInput.dataset.pid = proj.id;
  }

  // ── Sort + render ──────────────────────────────────────────────────────────
  function sortedByPhase(tasks, phases) {
    const phaseIdx = new Map((phases || []).map((p, i) => [p, i]));
    return [...tasks].sort((a, b) => (phaseIdx.get(a.phase) ?? 999) - (phaseIdx.get(b.phase) ?? 999));
  }

  // ── Auth / Login ───────────────────────────────────────────────────────────
  function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginError').classList.add('hidden');
    const u = document.getElementById('loginUser');
    const p = document.getElementById('loginPass');
    if (u) { u.value = ''; u.focus(); }
    if (p) p.value = '';
  }

  function hideLoginScreen() {
    document.getElementById('loginScreen').classList.add('hidden');
  }

  function attemptLogin() {
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    if (Auth.login(u, p, state.users)) {
      hideLoginScreen();
      postLoginSetup(true);
    } else {
      document.getElementById('loginError').classList.remove('hidden');
    }
  }

  function doLogout() {
    Auth.logout();
    document.body.removeAttribute('data-role');
    showLoginScreen();
  }

  function postLoginSetup(fromLogin = false) {
    applyPermissions();
    // Ensure the active project is one the user can see
    if (!Auth.can('viewAll')) {
      const activeOk = state.activeProjectId && (() => {
        for (const prog of state.programs) {
          const proj = prog.projects.find(p => p.id === state.activeProjectId);
          if (proj) return Auth.canViewProject(proj.id) || Auth.canViewProgram(prog.id);
        }
        return false;
      })();
      if (!activeOk) {
        state.activeProjectId = null;
        outer: for (const prog of state.programs) {
          for (const proj of prog.projects) {
            if (!proj.archived && (Auth.canViewProject(proj.id) || Auth.canViewProgram(prog.id))) {
              state.activeProjectId = proj.id;
              break outer;
            }
          }
        }
      }
    }
    // On fresh login, default PM team members to the Program Summary tab
    if (fromLogin) {
      const user = Auth.current();
      if (user) {
        const roles = _userRoles(user);
        const isPMTeam = roles.some(r => ['administrator', 'program_manager', 'construction_manager', 'project_manager'].includes(r));
        if (isPMTeam) setTab('summary');
      }
    }
    recompute(); syncHeader(); renderSidebar(); render();
  }

  // Maps a user's role set to the single CSS data-role that drives UI visibility rules.
  // The most-permissive role wins so elevated users never see incorrect restrictions.
  function _effectiveCssRole(roles) {
    if (roles.includes('administrator')) return 'administrator';
    if (roles.includes('program_developer')) return 'administrator';
    if (roles.includes('program_manager')) return 'program_manager';
    if (roles.some(r => ['construction_manager', 'project_manager', 'property_developer', 'consultant'].includes(r))) return 'consultant';
    if (roles.includes('client')) return 'client';
    return roles[0] || '';
  }

  function applyPermissions() {
    const user = Auth.current();
    if (!user) return;
    const roles = _userRoles(user);
    document.body.dataset.role = _effectiveCssRole(roles);
    const nameEl = document.getElementById('userDisplayName');
    if (nameEl) nameEl.textContent = user.name;
    const btn = document.getElementById('btnManageUsers');
    if (btn) btn.classList.toggle('hidden', !Auth.can('manageUsers'));
    const btnSave = document.getElementById('btnSaveData');
    if (btnSave) btnSave.classList.toggle('hidden', !Auth.can('manageUsers'));
    const canEdit = Auth.can('editTasks');
    ['addTaskBtn', 'addPhaseBtn', 'loadTemplateBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !canEdit);
    });

    // Division access: only administrators and property_developers can see the PD division
    const canSeePD = roles.includes('administrator') || roles.includes('program_developer') || roles.includes('property_developer');
    const divSwitch = document.querySelector('.div-switch');
    if (divSwitch) divSwitch.classList.toggle('hidden', !canSeePD);
    if (!canSeePD && currentDivision === 'pd') setDivision('pm');
  }

  // ── User management ────────────────────────────────────────────────────────
  function openUsersModal() {
    _usersEditingId = null;
    document.getElementById('usersModal').classList.remove('hidden');
    renderUsersModal();
  }

  function closeUsersModal() {
    document.getElementById('usersModal').classList.add('hidden');
    _usersEditingId = null;
  }

  function renderUsersModal() {
    const body   = document.getElementById('usersModalBody');
    const footer = document.getElementById('usersModalFooter');
    const title  = document.getElementById('usersModalTitle');
    if (!body || !footer) return;

    if (_usersEditingId === null) {
      title.textContent = 'Manage Users';
      _renderUsersList(body);
      footer.innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="App.openAddUser()">+ Add User</button>
        <button class="btn" onclick="App.closeUsersModal()">Close</button>`;
    } else {
      title.textContent = _usersEditingId === 'new' ? 'Add User' : 'Edit User';
      _renderUserEditForm(body);
      const showDelete = _usersEditingId !== 'new' && _usersEditingId !== Auth.current()?.id;
      footer.innerHTML = `
        ${showDelete ? `<button class="btn btn-danger btn-sm" onclick="App.deleteUser('${_usersEditingId}')">Delete User</button>` : '<div></div>'}
        <div class="footer-right">
          <button class="btn" onclick="App.openUsersBack()">Cancel</button>
          <button class="btn btn-primary" onclick="App.saveUser()">Save User</button>
        </div>`;
    }
  }

  function _renderUsersList(container) {
    if (!state.users || !state.users.length) {
      container.innerHTML = '<p style="padding:16px;color:#94a3b8">No users.</p>';
      return;
    }
    const ROLE_ORDER = ['administrator', 'program_developer', 'program_manager', 'project_manager', 'construction_manager', 'property_developer', 'consultant', 'client'];
    const sortedUsers = [...state.users].sort((a, b) => {
      const aRoles = _userRoles(a);
      const bRoles = _userRoles(b);
      const aOrd = Math.min(...aRoles.map(r => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? 999 : i; }));
      const bOrd = Math.min(...bRoles.map(r => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? 999 : i; }));
      if (aOrd !== bOrd) return aOrd - bOrd;
      return a.name.localeCompare(b.name);
    });

    const rows = sortedUsers.map(u => {
      const uRoles = _userRoles(u);
      let access;
      if (uRoles.some(r => Auth.PERMS[r]?.viewAll))                                                                    access = 'All';
      else if (uRoles.includes('program_manager') || uRoles.includes('client') || uRoles.includes('consultant'))  access = `${(u.assignedPrograms || []).length} program(s)`;
      else                                                                                                          access = `${(u.assignedProjects || []).length} project(s)`;
      const isSelf = u.id === Auth.current()?.id;
      const badges = uRoles.map(r => `<span class="role-badge role-${r}">${esc(Auth.ROLE_LABELS[r] || r)}</span>`).join(' ');
      return `<tr>
        <td>${esc(u.name)}${isSelf ? ' <span class="self-tag">(you)</span>' : ''}</td>
        <td>${esc(u.username)}</td>
        <td>${badges}</td>
        <td>${access}</td>
        <td><button class="btn btn-sm" onclick="App.openEditUser('${u.id}')">Edit</button></td>
      </tr>`;
    }).join('');
    container.innerHTML = `
      <table class="users-table">
        <thead><tr>
          <th>Name</th><th>Username</th><th>Role</th>
          <th>Access</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function _renderUserEditForm(container) {
    const isNew = _usersEditingId === 'new';
    const u = isNew ? null : state.users.find(u => u.id === _usersEditingId);
    const userRoles = new Set(u ? _userRoles(u) : []);
    const assignedProjs = new Set(u?.assignedProjects || []);
    const assignedProgs = new Set(u?.assignedPrograms || []);

    // Program checkboxes (for program_manager)
    const progBoxes = state.programs.map(prog => `
      <label class="proj-assign-check">
        <input type="checkbox" name="assignProg" value="${prog.id}" ${assignedProgs.has(prog.id) ? 'checked' : ''}>
        ${esc(prog.name)}
      </label>`).join('') || '<span class="form-hint">No programs exist yet.</span>';

    // Project checkboxes grouped by program (for user/consultant/client)
    const projGroups = state.programs.map(prog => {
      const projs = prog.projects.filter(p => !p.archived);
      if (!projs.length) return '';
      const boxes = projs.map(p => `
        <label class="proj-assign-check">
          <input type="checkbox" name="assignProj" value="${p.id}" ${assignedProjs.has(p.id) ? 'checked' : ''}>
          ${esc(p.name)}
        </label>`).join('');
      return `<div class="prog-assign-group">
        <div class="prog-assign-name">${esc(prog.name)}</div>
        <div class="prog-assign-boxes">${boxes}</div>
      </div>`;
    }).join('') || '<span class="form-hint">No active projects yet.</span>';

    const hasAdmin          = userRoles.has('administrator') || userRoles.has('program_developer');
    const hasPM             = userRoles.has('program_manager');
    const hasClientConsult  = userRoles.has('client') || userRoles.has('consultant');
    const usePrograms       = !hasAdmin && (hasPM || hasClientConsult);
    const hideProjs = hasAdmin || usePrograms;
    const hideProgs = !usePrograms;

    container.innerHTML = `
      <div class="form-row two-col">
        <div class="form-field">
          <label class="form-label" for="ufName">Name <span style="color:#ef4444">*</span></label>
          <input id="ufName" class="form-input" type="text" value="${esc(u?.name || '')}"
            oninput="App.onUserNameInput(this.value)">
        </div>
        <div class="form-field">
          <label class="form-label" for="ufUserId">User ID <span style="color:#ef4444">*</span></label>
          <input id="ufUserId" class="form-input" type="text" value="${esc(isNew ? '' : (u?.id || ''))}"
            placeholder="e.g. KQ" autocomplete="off" style="text-transform:uppercase"
            oninput="this.dataset.manualEdit='true'; this.value=this.value.toUpperCase()">
        </div>
      </div>
      <div class="form-row two-col">
        <div class="form-field">
          <label class="form-label" for="ufUsername">Username <span style="color:#ef4444">*</span></label>
          <input id="ufUsername" class="form-input" type="text" value="${esc(u?.username || '')}">
        </div>
        <div class="form-field">
          <label class="form-label" for="ufPassword">Password${isNew ? ' <span style="color:#ef4444">*</span>' : ''}</label>
          <input id="ufPassword" class="form-input" type="password" placeholder="${isNew ? '' : 'Leave blank to keep current'}">
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Roles <span style="color:#ef4444">*</span></label>
        <div class="proj-assign-list prog-assign-flat">
          ${Auth.ROLES.map(r => `
            <label class="proj-assign-check">
              <input type="checkbox" name="assignRole" value="${r}" ${userRoles.has(r) ? 'checked' : ''} onchange="App.onUserRoleChange()">
              ${esc(Auth.ROLE_LABELS[r])}
            </label>`).join('')}
        </div>
      </div>
      <div class="form-field" id="ufProgramsSection"${hideProgs ? ' style="display:none"' : ''}>
        <label class="form-label">Assigned Programs</label>
        <div class="proj-assign-list prog-assign-flat">${progBoxes}</div>
      </div>
      <div class="form-field" id="ufProjectsSection"${hideProjs ? ' style="display:none"' : ''}>
        <label class="form-label">Assigned Projects</label>
        <div class="proj-assign-list">${projGroups}</div>
      </div>`;
  }

  function onUserRoleChange() {
    const checked = Array.from(document.querySelectorAll('input[name="assignRole"]:checked')).map(c => c.value);
    const hasAdmin         = checked.includes('administrator') || checked.includes('program_developer');
    const hasPM            = checked.includes('program_manager');
    const hasClientConsult = checked.includes('client') || checked.includes('consultant');
    const usePrograms      = !hasAdmin && (hasPM || hasClientConsult);
    const projSec = document.getElementById('ufProjectsSection');
    const progSec = document.getElementById('ufProgramsSection');
    if (projSec) projSec.style.display = (hasAdmin || usePrograms) ? 'none' : '';
    if (progSec) progSec.style.display = usePrograms ? '' : 'none';
  }

  function openAddUser() {
    _usersEditingId = 'new';
    renderUsersModal();
  }

  function openEditUser(id) {
    _usersEditingId = id;
    renderUsersModal();
  }

  function openUsersBack() {
    _usersEditingId = null;
    renderUsersModal();
  }

  function saveUser() {
    const isNew   = _usersEditingId === 'new';
    const name     = (document.getElementById('ufName')?.value || '').trim();
    const username = (document.getElementById('ufUsername')?.value || '').trim();
    const password = document.getElementById('ufPassword')?.value || '';
    const userId   = ((document.getElementById('ufUserId')?.value || '').trim().toUpperCase()) || (isNew ? genId('u') : _usersEditingId);
    const roles    = Array.from(document.querySelectorAll('input[name="assignRole"]:checked')).map(c => c.value);

    if (!name)         { alert('Name is required.'); return; }
    if (!username)     { alert('Username is required.'); return; }
    if (!roles.length) { alert('At least one role is required.'); return; }
    if (isNew && !password) { alert('Password is required for new users.'); return; }

    const dupUser = (state.users || []).find(u =>
      u.username.toLowerCase() === username.toLowerCase() && (isNew || u.id !== _usersEditingId)
    );
    if (dupUser) { alert('Username already in use.'); return; }

    const dupId = (state.users || []).find(u =>
      u.id === userId && (isNew || u.id !== _usersEditingId)
    );
    if (dupId) { alert('User ID "' + userId + '" is already in use.'); return; }

    const hasAdmin         = roles.includes('administrator') || roles.includes('program_developer');
    const hasPM            = roles.includes('program_manager');
    const hasClientConsult = roles.includes('client') || roles.includes('consultant');
    const usePrograms      = !hasAdmin && (hasPM || hasClientConsult);
    const projCbs = document.querySelectorAll('input[name="assignProj"]');
    const progCbs = document.querySelectorAll('input[name="assignProg"]');
    const assignedProjects = (!hasAdmin && !usePrograms) ? Array.from(projCbs).filter(c => c.checked).map(c => c.value) : [];
    const assignedPrograms = usePrograms ? Array.from(progCbs).filter(c => c.checked).map(c => c.value) : [];

    if (isNew) {
      state.users.push({ id: userId, name, username, password, roles, assignedProjects, assignedPrograms });
    } else {
      const idx = state.users.findIndex(u => u.id === _usersEditingId);
      if (idx < 0) return;
      const oldId = _usersEditingId;
      if (userId !== oldId) _renameUserId(oldId, userId);
      const updated = { ...state.users[idx], id: userId, name, username, roles, assignedProjects, assignedPrograms };
      if (password) updated.password = password;
      state.users[idx] = updated;
      const wasCurrent = Auth.current()?.id === oldId;
      if (wasCurrent) { Auth.forceRefreshCurrent(updated); applyPermissions(); }
      else Auth.refreshCurrent(updated);
    }

    save();
    _usersEditingId = null;
    renderUsersModal();
    // Re-apply sidebar filter in case project assignments changed
    renderSidebar();
    // Refresh checklist so phase-assignee dropdowns include the new/updated user
    render();
  }

  function deleteUser(id) {
    const u = (state.users || []).find(u => u.id === id);
    if (!u) return;
    if (u.id === Auth.current()?.id) { alert('You cannot delete your own account.'); return; }
    const uRoles = _userRoles(u);
    const lastAdmin = uRoles.includes('administrator') &&
      state.users.filter(su => _userRoles(su).includes('administrator')).length === 1;
    if (lastAdmin) { alert('Cannot delete the last administrator.'); return; }
    if (!confirm(`Delete user "${u.name}"?`)) return;
    state.users = state.users.filter(u => u.id !== id);
    save();
    _usersEditingId = null;
    renderUsersModal();
  }

  function render() {
    updateSummary();
    renderAddressBar();
    const proj   = getActiveProject();
    const phases = proj ? (proj.phases || []) : [];
    const tasks  = proj ? sortedByPhase(proj.tasks, phases) : [];
    const map    = new Map((proj ? proj.tasks : []).map(t => [t.id, t]));
    // Contextual empty state
    const emptyEl = document.getElementById('checklistEmpty');
    if (emptyEl) {
      emptyEl.innerHTML = currentTab === 'archive'
        ? '<p>No archived projects yet &mdash; click <strong>Archive</strong> next to any project in the sidebar to move it here.</p>'
        : '<p>No tasks yet &mdash; click <strong>+ Add Phase</strong> to add a phase, or click <strong>Templates</strong> to pre-load all standard phases.</p>';
    }
    if (currentView === 'checklist') Checklist.render(tasks, map, proj ? (proj.phaseAssignees || {}) : {}, proj ? proj.startDate : '', phases);
    else Gantt.render(tasks, proj ? proj.startDate : CPM.todayIso(), 'ganttWrapper');
  }

  function setView(view) {
    currentView = view;
    document.getElementById('checklistView').classList.toggle('hidden', view !== 'checklist');
    document.getElementById('ganttView').classList.toggle('hidden', view !== 'gantt');
    document.getElementById('btnChecklist').classList.toggle('active', view === 'checklist');
    document.getElementById('btnGantt').classList.toggle('active', view === 'gantt');
    render();
  }

  // ── Task actions ───────────────────────────────────────────────────────────
  function toggleComplete(id, checked) {
    const proj = getActiveProject(); if (!proj) return;
    const t = proj.tasks.find(t => t.id === id); if (!t) return;
    t.status = checked ? 'complete' : 'not_started';
    if (checked && !t.actualEnd) t.actualEnd = CPM.todayIso();
    if (!checked) t.actualEnd = null;
    recompute(); save(); render(); renderSidebar();
  }

  function setActualEnd(id, val) {
    const proj = getActiveProject(); if (!proj) return;
    const t = proj.tasks.find(t => t.id === id); if (!t) return;
    t.actualEnd = val || null; if (val) t.status = 'complete';
    recompute(); save(); render(); renderSidebar();
  }

  function setDuration(id, val) {
    const proj = getActiveProject(); if (!proj) return;
    const t = proj.tasks.find(t => t.id === id); if (!t) return;
    const n = parseInt(val, 10);
    if (!n || n < 1) return;
    t.duration = n;
    recompute(); save(); render(); renderSidebar();
  }

  function setActualStart(id, val) {
    const proj = getActiveProject(); if (!proj) return;
    const t = proj.tasks.find(t => t.id === id); if (!t) return;
    t.actualStart = val || null;
    if (val && t.status === 'not_started') t.status = 'in_progress';
    recompute(); save(); render(); renderSidebar();
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function _populatePhaseSelect(selectedPhase) {
    const proj = getActiveProject();
    const phases = proj ? (proj.phases || []) : PHASES;
    const sel = document.getElementById('fPhase');
    sel.innerHTML = phases.map(p =>
      `<option value="${esc(p)}" ${p === selectedPhase ? 'selected' : ''}>${esc(p)}</option>`
    ).join('');
  }

  function _populateAssigneeSelect(selectedId) {
    const sel = document.getElementById('fAssignee');
    if (!sel) return;
    const users = (state.users || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">\u2014 Unassigned \u2014</option>' +
      users.map(u => `<option value="${esc(u.id)}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  }

  function openAddTask() {
    editingId = null;
    document.getElementById('modalTitle').textContent = 'Add Task';
    document.getElementById('fName').value      = '';
    _populatePhaseSelect(null);
    document.getElementById('fDuration').value  = '5';
    _populateAssigneeSelect(null);
    document.getElementById('fStatus').value      = 'not_started';
    document.getElementById('fActualStart').value = '';
    document.getElementById('fActualEnd').value   = '';
    document.getElementById('depsContainer').innerHTML = '';
    document.getElementById('btnDeleteTask').classList.add('hidden');
    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('fName').focus();
  }

  function openEditTask(id) {
    const proj = getActiveProject(); if (!proj) return;
    const t = proj.tasks.find(t => t.id === id); if (!t) return;
    editingId = id;
    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('fName').value      = t.name;
    _populatePhaseSelect(t.phase);
    document.getElementById('fDuration').value  = t.duration;
    _populateAssigneeSelect(t.assignee || null);
    document.getElementById('fStatus').value      = t.status;
    document.getElementById('fActualStart').value = t.actualStart || '';
    document.getElementById('fActualEnd').value   = t.actualEnd || '';
    document.getElementById('btnDeleteTask').classList.remove('hidden');
    const container = document.getElementById('depsContainer');
    container.innerHTML = '';
    t.dependencies.forEach(dep => _addDepRow(dep));
    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('fName').focus();
  }

  function closeModal() {
    document.getElementById('taskModal').classList.add('hidden'); editingId = null;
  }

  function addDepRowPublic() { _addDepRow(null); }

  function _addDepRow(dep) {
    const proj    = getActiveProject();
    const choices = proj ? proj.tasks.filter(t => t.id !== editingId) : [];
    const container = document.getElementById('depsContainer');
    const row     = document.createElement('div');
    row.className = 'dep-row';
    if (!choices.length) {
      row.innerHTML = '<em class="dep-empty-msg">No other tasks available.</em>';
      container.appendChild(row); return;
    }
    const taskOpts = choices.map(t =>
      `<option value="${t.id}" ${dep && dep.taskId === t.id ? 'selected' : ''}>${esc(t.name)}${t.phase ? ' [' + t.phase + ']' : ''}</option>`
    ).join('');
    const typeOpts = ['FS','SS','FF','SF'].map(tp =>
      `<option value="${tp}" ${dep && dep.type === tp ? 'selected' : ''}>${tp}</option>`
    ).join('');
    row.innerHTML = `
      <select class="dep-task-sel">${taskOpts}</select>
      <select class="dep-type-sel">${typeOpts}</select>
      <label class="dep-lag-label">Lag <input type="number" class="dep-lag-inp" value="${dep ? (dep.lag||0) : 0}" min="-999" max="999" style="width:52px">d</label>
      <button type="button" class="btn-remove" onclick="this.closest('.dep-row').remove()">&times;</button>`;
    container.appendChild(row);
  }

  function saveTask() {
    const name = document.getElementById('fName').value.trim();
    if (!name) { document.getElementById('fName').classList.add('input-error'); document.getElementById('fName').focus(); return; }
    document.getElementById('fName').classList.remove('input-error');
    const phase     = document.getElementById('fPhase').value;
    const duration  = Math.max(0, parseInt(document.getElementById('fDuration').value) || 0);
    const assignee  = document.getElementById('fAssignee').value.trim();
    let status      = document.getElementById('fStatus').value;
    const actualStart = document.getElementById('fActualStart').value || null;
    const actualEnd   = document.getElementById('fActualEnd').value || null;
    if (actualStart && status === 'not_started') status = 'in_progress';
    const deps = [];
    document.querySelectorAll('#depsContainer .dep-row').forEach(row => {
      const sel = row.querySelector('.dep-task-sel'), typ = row.querySelector('.dep-type-sel'), lag = row.querySelector('.dep-lag-inp');
      if (sel && typ) deps.push({ taskId: sel.value, type: typ.value, lag: parseInt(lag?.value) || 0 });
    });
    const proj = getActiveProject(); if (!proj) return;
    if (editingId) {
      const t = proj.tasks.find(t => t.id === editingId);
      Object.assign(t, { name, phase, duration, assignee, status, actualStart, actualEnd, dependencies: deps });
    } else {
      const newTask = { id: genId('t'), name, phase, duration, assignee, status, actualStart, actualEnd, dependencies: deps, plannedStart: null, plannedEnd: null };
      if (deps.length) {
        const depIds = new Set(deps.map(d => d.taskId));
        let insertAfter = -1;
        proj.tasks.forEach((t, i) => { if (depIds.has(t.id)) insertAfter = i; });
        if (insertAfter >= 0) {
          proj.tasks.splice(insertAfter + 1, 0, newTask);
        } else {
          proj.tasks.push(newTask);
        }
      } else {
        proj.tasks.push(newTask);
      }
    }
    if (assignee) _grantProjectAccess(proj.id, assignee);
    recompute(); save(); render(); renderSidebar(); closeModal();
  }

  // When a task is assigned to someone, add the project to their assignedProjects if not already there.
  // Skips administrators only — they have global access via viewAll.
  function _grantProjectAccess(projectId, assigneeId) {
    if (!assigneeId || !Array.isArray(state.users)) return;
    const user = state.users.find(u => u.id === assigneeId);
    if (!user) return;
    const userRoles = _userRoles(user);
    if (userRoles.includes('administrator')) return;
    if (!Array.isArray(user.assignedProjects)) user.assignedProjects = [];
    if (!user.assignedProjects.includes(projectId)) {
      user.assignedProjects.push(projectId);
      Auth.refreshCurrent(user); // update session if it's the logged-in user
    }
  }

  function getUserName(id) {
    if (!id) return '';
    const user = (state.users || []).find(u => u.id === id);
    return user ? user.name : id; // fall back to raw string for unmigrated data
  }

  function getUsers() {
    return state.users || [];
  }

  function _nameToInitials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Called from the name field oninput in the user edit form; auto-fills User ID with initials
  // unless the user has already manually edited the ID field.
  function onUserNameInput(val) {
    const idField = document.getElementById('ufUserId');
    if (!idField || idField.dataset.manualEdit === 'true') return;
    idField.value = _nameToInitials(val);
  }

  // Rename a user ID everywhere it appears (task assignees, phase assignees).
  function _renameUserId(oldId, newId) {
    for (const prog of state.programs)
      for (const proj of prog.projects) {
        for (const task of proj.tasks)
          if (task.assignee === oldId) task.assignee = newId;
        const pa = proj.phaseAssignees || {};
        for (const phase of Object.keys(pa))
          if (pa[phase] === oldId) pa[phase] = newId;
      }
  }

  function moveTask(draggedId, targetId, before) {
    const proj = getActiveProject(); if (!proj) return;
    const tasks = proj.tasks;
    const fromIdx = tasks.findIndex(t => t.id === draggedId);
    if (fromIdx === -1) return;
    const targetTask = tasks.find(t => t.id === targetId);
    if (!targetTask) return;
    const [task] = tasks.splice(fromIdx, 1);
    task.phase = targetTask.phase;          // adopt phase of drop target
    const toIdx = tasks.findIndex(t => t.id === targetId);
    if (toIdx === -1) { tasks.splice(fromIdx, 0, task); return; }
    tasks.splice(before ? toIdx : toIdx + 1, 0, task);
    recompute(); save(); render();
  }

  function removePhase(phase) {
    const proj = getActiveProject(); if (!proj) return;
    const count = proj.tasks.filter(t => t.phase === phase).length;
    const msg = count
      ? `Remove "${phase}" and its ${count} task${count !== 1 ? 's' : ''}? This cannot be undone.`
      : `Remove phase "${phase}"?`;
    if (!confirm(msg)) return;
    const removedIds = new Set(proj.tasks.filter(t => t.phase === phase).map(t => t.id));
    proj.tasks = proj.tasks.filter(t => t.phase !== phase);
    proj.tasks.forEach(t => { t.dependencies = t.dependencies.filter(d => !removedIds.has(d.taskId)); });
    proj.phases = (proj.phases || []).filter(p => p !== phase);
    recompute(); save(); render(); renderSidebar();
  }

  function movePhase(draggedPhase, targetPhase, before) {
    const proj = getActiveProject(); if (!proj) return;
    const phases = proj.phases || [];
    const fromIdx = phases.indexOf(draggedPhase);
    if (fromIdx === -1) return;
    phases.splice(fromIdx, 1);
    const toIdx = phases.indexOf(targetPhase);
    if (toIdx === -1) { phases.splice(fromIdx, 0, draggedPhase); return; }
    phases.splice(before ? toIdx : toIdx + 1, 0, draggedPhase);
    save(); render();
  }

  function openAddPhase() {
    const proj = getActiveProject(); if (!proj) return;
    const existing = new Set(proj.phases || []);
    const dl = document.getElementById('addPhaseDatalist');
    dl.innerHTML = PHASES.filter(p => !existing.has(p)).map(p => `<option value="${esc(p)}">`).join('');
    document.getElementById('fNewPhaseName').value = '';
    document.getElementById('fNewPhaseName').classList.remove('input-error');
    document.getElementById('addPhaseModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('fNewPhaseName').focus(), 50);
  }

  function closeAddPhaseModal() {
    document.getElementById('addPhaseModal').classList.add('hidden');
  }

  function savePhase() {
    const name = document.getElementById('fNewPhaseName').value.trim();
    if (!name) {
      document.getElementById('fNewPhaseName').classList.add('input-error');
      document.getElementById('fNewPhaseName').focus();
      return;
    }
    document.getElementById('fNewPhaseName').classList.remove('input-error');
    const proj = getActiveProject(); if (!proj) return;
    if (!proj.phases) proj.phases = [];
    if (proj.phases.includes(name)) { alert(`"${name}" is already a phase in this project.`); return; }
    proj.phases.push(name);
    save(); render(); closeAddPhaseModal();
  }

  function deleteTask() {
    if (!editingId) return;
    if (!confirm('Delete this task?')) return;
    const proj = getActiveProject(); if (!proj) return;
    proj.tasks = proj.tasks.filter(t => t.id !== editingId);
    proj.tasks.forEach(t => { t.dependencies = t.dependencies.filter(d => d.taskId !== editingId); });
    recompute(); save(); render(); renderSidebar(); closeModal();
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  function syncHeader() { /* program/project name now rendered in renderAddressBar */ }

  function initHeader() {}

  function setProjectStart(val) {
    const proj = getActiveProject();
    if (proj) { proj.startDate = val; recompute(); save(); render(); }
  }

  // ── Sidebar resize ─────────────────────────────────────────────────────────
  function initSidebarResize(handleId, sidebarId, storageKey) {
    const handle  = document.getElementById(handleId);
    const sidebar = document.getElementById(sidebarId);
    if (!handle || !sidebar) return;

    const saved = localStorage.getItem(storageKey);
    if (saved) sidebar.style.width = saved + 'px';

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('dragging');
      const startX     = e.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;

      function onMove(e) {
        const newWidth = Math.min(420, Math.max(120, startWidth + e.clientX - startX));
        sidebar.style.width = newWidth + 'px';
      }
      function onUp() {
        handle.classList.remove('dragging');
        localStorage.setItem(storageKey, parseInt(sidebar.style.width));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    UtilityTracker.init();
    load(); migrateAddPhases(); migrateUsers();
    try {
      const hc = JSON.parse(localStorage.getItem('cds_summaryHiddenCols') || '[]');
      summaryHiddenCols = new Set(hc);
    } catch(e) { summaryHiddenCols = new Set(); }
    initHeader(); // one-time event-listener setup
    initSidebarResize('pmSidebarHandle', 'pmSidebar', 'cds_pmSidebarWidth');
    initSidebarResize('pdSidebarHandle', 'pdSidebar', 'cds_pdSidebarWidth');
    // Close the columns dropdown when clicking elsewhere
    document.addEventListener('click', () => {
      const menu = document.getElementById('summaryColMenu');
      if (menu) menu.classList.remove('open');
    });

    // Modal backdrop / keyboard listeners (work regardless of auth state)
    document.getElementById('taskModal').addEventListener('click', e => {
      if (e.target === document.getElementById('taskModal')) closeModal();
    });
    document.getElementById('templateModal').addEventListener('click', e => {
      if (e.target === document.getElementById('templateModal')) closeTemplateModal();
    });
    document.getElementById('addPhaseModal').addEventListener('click', e => {
      if (e.target === document.getElementById('addPhaseModal')) closeAddPhaseModal();
    });
    document.getElementById('usersModal').addEventListener('click', e => {
      if (e.target === document.getElementById('usersModal')) closeUsersModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModal(); closeTemplateModal(); closeAddPhaseModal(); closeUsersModal(); }
      // Enter on the login screen submits the form
      if (e.key === 'Enter' && !document.getElementById('loginScreen').classList.contains('hidden')) {
        attemptLogin();
      }
    });

    if (!Auth.init(state.users)) {
      showLoginScreen();
      return;
    }

    postLoginSetup();
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setDivision(div) {
    // Guard: only administrators and property_developers can switch to PD
    if (div === 'pd') {
      const user = Auth.current();
      const roles = user ? _userRoles(user) : [];
      if (!roles.includes('administrator') && !roles.includes('program_developer') && !roles.includes('property_developer')) return;
    }
    currentDivision = div;
    document.getElementById('divPM').classList.toggle('active', div === 'pm');
    document.getElementById('divPD').classList.toggle('active', div === 'pd');
    document.body.classList.toggle('pm-mode', div === 'pm');
    document.body.classList.toggle('pd-mode', div === 'pd');
    if (div === 'pd') UtilityTracker.activate();
  }

  return {
    init, render, setTab, setView, setProjectStart, setProjectAddress, setProjectName, setProjectNumber, sortSummary, filterSummary, cycleSummaryProjectFilter, toggleMyProjects, toggleSummaryColMenu, toggleSummaryCol, setProjectComment, setActiveProjectComment, filterCapacity, sortCapacity, navigateToProject, setPhaseAssignee,
    toggleProgram, setActiveProject, addProgram, addProject, deleteProgram,
    openAddTask, openEditTask, closeModal, removePhase, movePhase, openAddPhase, closeAddPhaseModal, savePhase,
    addDepRow: addDepRowPublic, saveTask, deleteTask, moveTask,
    toggleComplete, setActualEnd, setActualStart, setDuration,
    openTemplateModal, closeTemplateModal, saveAsTemplate, applyCustomTemplate, updateTemplate, deleteCustomTemplate,
    printDoc, exportJSON, importJSON, saveDataFile,
    archiveProject, restoreProject, restoreCurrentProject, deleteProject,
    setDivision,
    attemptLogin, doLogout, getUserName, getUsers,
    openUsersModal, closeUsersModal, openAddUser, openEditUser, openUsersBack, saveUser, deleteUser, onUserRoleChange, onUserNameInput,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
