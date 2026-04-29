// checklist.js — Task Table Renderer (phase-grouped)

'use strict';

const Checklist = (function () {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let _draggingId    = null;
  let _draggingPhase = null;
  const collapsedPhases = new Set();

  function togglePhase(phase) {
    collapsedPhases.has(phase) ? collapsedPhases.delete(phase) : collapsedPhases.add(phase);
    App.render();
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m-1]} ${d}, ${y}`;
  }

  function fmtStatus(s) {
    return { not_started: 'Not Started', in_progress: 'In Progress', complete: 'Complete' }[s] || s;
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  function onDragStart(e, id) {
    _draggingId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('row-dragging');
  }

  function onDragOver(e, id) {
    if (!_draggingId || _draggingId === id || _draggingPhase) return;
    e.preventDefault();
    _clearDropIndicators();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.classList.add(e.clientY < rect.top + rect.height / 2 ? 'row-drop-above' : 'row-drop-below');
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('row-drop-above', 'row-drop-below');
  }

  function onDragEnd(e) {
    _draggingId = null;
    _clearDropIndicators();
    e.currentTarget.classList.remove('row-dragging');
  }

  function onDrop(e, targetId) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    e.currentTarget.classList.remove('row-drop-above', 'row-drop-below');
    if (_draggingId && _draggingId !== targetId) {
      App.moveTask(_draggingId, targetId, before);
    }
    _draggingId = null;
  }

  // ── Phase drag-and-drop ────────────────────────────────────────────────────
  function onPhaseDragStart(e, phase) {
    _draggingPhase = phase;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('phase-dragging');
    e.stopPropagation();
  }

  function onPhaseDragOver(e, phase) {
    if (!_draggingPhase || _draggingPhase === phase) return;
    e.preventDefault();
    e.stopPropagation();
    _clearPhaseDropIndicators();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.classList.add(e.clientY < rect.top + rect.height / 2 ? 'phase-drop-above' : 'phase-drop-below');
  }

  function onPhaseDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('phase-drop-above', 'phase-drop-below');
    }
  }

  function onPhaseDrop(e, targetPhase) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    e.currentTarget.classList.remove('phase-drop-above', 'phase-drop-below');
    if (_draggingPhase && _draggingPhase !== targetPhase) {
      App.movePhase(_draggingPhase, targetPhase, before);
    }
    _draggingPhase = null;
  }

  function onPhaseDragEnd(e) {
    _draggingPhase = null;
    _clearPhaseDropIndicators();
    e.currentTarget.classList.remove('phase-dragging');
  }

  function _clearPhaseDropIndicators() {
    document.querySelectorAll('.phase-drop-above, .phase-drop-below').forEach(el =>
      el.classList.remove('phase-drop-above', 'phase-drop-below')
    );
  }

  function _clearDropIndicators() {
    document.querySelectorAll('.row-drop-above, .row-drop-below').forEach(el =>
      el.classList.remove('row-drop-above', 'row-drop-below')
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render(tasks, taskMap, phaseAssignees, startDate, phases) {
    phaseAssignees = phaseAssignees || {};
    phases = phases || [];
    const canEdit = Auth.can('editTasks');
    const tbody = document.getElementById('taskListBody');
    const empty = document.getElementById('checklistEmpty');

    if (!tasks.length && !phases.length) {
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const today = CPM.todayIso();
    const firstPipelineTask = tasks.find(t => t.phase === 'Pipeline');

    // Group tasks by phase
    const tasksByPhase = {};
    tasks.forEach(task => {
      const p = task.phase || '\u2014';
      if (!tasksByPhase[p]) tasksByPhase[p] = [];
      tasksByPhase[p].push(task);
    });

    // ── Phase header row ─────────────────────────────────────────────────────
    function phaseHeader(phase, phaseTasks) {
      const colors = PHASE_COLORS[phase] || { bg: '#f8fafc', text: '#334155' };
      const phaseOwner = phaseAssignees[phase] || '';

      // Calculate phase calendar span (min plannedStart → max plannedEnd, lag-inclusive)
      let phaseDurStr = '';
      const datedTasks = phaseTasks.filter(t => t.plannedStart && t.plannedEnd);
      if (datedTasks.length) {
        const starts = datedTasks.map(t => CPM.isoToDay(t.plannedStart));
        const ends   = datedTasks.map(t => CPM.isoToDay(t.plannedEnd));
        const dur = Math.max(...ends) - Math.min(...starts) + 1;
        phaseDurStr = `<span class="phase-hdr-dur">${dur}d</span>`;
      }

      return `
        <tr class="phase-hdr-row" draggable="true"
            ondragstart="Checklist.onPhaseDragStart(event,'${esc(phase)}')"
            ondragover="Checklist.onPhaseDragOver(event,'${esc(phase)}')"
            ondragleave="Checklist.onPhaseDragLeave(event)"
            ondrop="Checklist.onPhaseDrop(event,'${esc(phase)}')"
            ondragend="Checklist.onPhaseDragEnd(event)">
          <td style="background:${colors.bg}; color:${colors.text}">
            ${canEdit ? `<span class="phase-drag-handle" title="Drag to reorder">&#8942;</span>` : ''}
          </td>
          <td style="background:${colors.bg}; color:${colors.text}">
            <button class="phase-collapse-btn" onclick="Checklist.togglePhase('${esc(phase)}'); event.stopPropagation()" title="Collapse/expand phase">${collapsedPhases.has(phase) ? '&#9654;' : '&#9660;'}</button>
            <span class="phase-hdr-label">${esc(phase)}</span>
            ${canEdit ? `<button class="phase-remove-btn" onclick="App.removePhase('${esc(phase)}')" title="Remove phase">&times;</button>` : ''}
          </td>
          <td class="center" style="background:${colors.bg}; color:${colors.text}">
            ${phaseDurStr}
          </td>
          <td style="background:${colors.bg}; color:${colors.text}; padding:4px 8px;">
            ${ canEdit && ['Due Diligence','Permitting','Construction','Design'].includes(phase) ? (() => {
              const PHASE_ROLE = { 'Due Diligence': 'project_manager', 'Permitting': 'property_developer', 'Construction': 'construction_manager', 'Design': 'consultant' };
              const allowedRole = PHASE_ROLE[phase];
              const roleUsers = (App.getUsers() || []).filter(u => {
                const roles = Array.isArray(u.roles) ? u.roles : [u.role].filter(Boolean);
                return roles.includes(allowedRole);
              });
              return `
            <select class="phase-assignee-select"
              onchange="App.setPhaseAssignee('${esc(phase)}', this.value)"
              onclick="event.stopPropagation()"
              style="color:${colors.text}; border-color:${colors.text}40">
              <option value="">&#8212; Assign &#8212;</option>
              ${roleUsers.map(u => `<option value="${esc(u.id)}" ${u.id === phaseOwner ? 'selected' : ''}>${esc(u.id)}</option>`).join('')}
            </select>`;
            })() : '' }
          </td>
          <td colspan="7" style="background:${colors.bg}"></td>
        </tr>`;
    }

    // ── Task row ─────────────────────────────────────────────────────────────
    function taskRow(task) {
      const effectiveStart = task.actualStart || task.plannedStart;
      const plannedEnd = effectiveStart ? CPM.addDays(effectiveStart, Math.max(0, task.duration - 1)) : null;
      const isOverdue     = task.status !== 'complete' && task.plannedEnd && task.plannedEnd < today;
      const isLate        = task.status === 'complete' && task.actualEnd && plannedEnd && task.actualEnd > plannedEnd;
      const isEarly       = task.status === 'complete' && task.actualEnd && plannedEnd && task.actualEnd < plannedEnd;
      const isStartLate   = task.actualStart && task.plannedStart && task.actualStart > task.plannedStart;
      const isStartEarly  = task.actualStart && task.plannedStart && task.actualStart < task.plannedStart;

      const depHtml = task.dependencies.map(d => {
        const p = taskMap.get(d.taskId);
        if (!p) return '';
        const lagStr = d.lag ? ` ${d.lag > 0 ? '+' : ''}${d.lag}d` : '';
        return `<span class="dep-chip">${esc(p.name)} <em>${d.type}${lagStr}</em></span>`;
      }).filter(Boolean).join(' ') || '\u2014';

      const displayStatus = task.status === 'complete' ? 'complete'
        : task.actualStart ? 'in_progress'
        : 'not_started';
      const badgeClass = {
        not_started: 'badge-not-started',
        in_progress: 'badge-in-progress',
        complete:    'badge-complete',
      }[displayStatus] || '';

      return `
        <tr class="${isOverdue ? 'row-overdue' : ''}"
            ${canEdit ? `draggable="true"
            ondragstart="Checklist.onDragStart(event,'${task.id}')"
            ondragover="Checklist.onDragOver(event,'${task.id}')"
            ondragleave="Checklist.onDragLeave(event)"
            ondrop="Checklist.onDrop(event,'${task.id}')"
            ondragend="Checklist.onDragEnd(event)"` : ''}>
          <td class="drag-td">
            ${canEdit ? `<span class="drag-handle" title="Drag to reorder">&#8942;</span>` : ''}
            <input type="checkbox" class="task-check"
              ${task.status === 'complete' ? 'checked' : ''}
              ${!canEdit ? 'disabled' : ''}
              onchange="App.toggleComplete('${task.id}', this.checked)">
          </td>
          <td class="task-name-cell ${task.status === 'complete' ? 'done' : ''}">${esc(task.name)}</td>
          <td class="center">
            <input type="number" class="inline-duration" min="1" value="${task.duration}"
              ${!canEdit ? 'disabled' : ''}
              onchange="App.setDuration('${task.id}', this.value)"
              onclick="event.stopPropagation()">
          </td>
          <td>${esc(App.getUserName(task.assignee) || '\u2014')}</td>
          <td class="deps-cell">${depHtml}</td>
          <td class="center">${task === firstPipelineTask && canEdit
            ? `<input type="date" class="inline-date start-date-input" value="${startDate || ''}" title="Project start date" onchange="App.setProjectStart(this.value)" onclick="event.stopPropagation()">`
            : fmtDate(task.plannedStart)}</td>
          <td class="center">
            <input type="date" class="inline-date ${isStartLate ? 'late' : isStartEarly ? 'early' : ''}"
              value="${task.actualStart || ''}"
              ${!canEdit ? 'disabled' : ''}
              onchange="App.setActualStart('${task.id}', this.value)">
          </td>
          <td class="center">${fmtDate(plannedEnd)}</td>
          <td class="center">
            <input type="date" class="inline-date ${isLate ? 'late' : isEarly ? 'early' : ''}"
              value="${task.actualEnd || ''}"
              ${!canEdit ? 'disabled' : ''}
              onchange="App.setActualEnd('${task.id}', this.value)">
          </td>
          <td class="center">
            <span class="badge ${badgeClass}">${fmtStatus(displayStatus)}</span>
          </td>
          <td>
            ${canEdit ? `<button class="btn-edit" onclick="App.openEditTask('${task.id}')">Edit</button>` : ''}
          </td>
        </tr>`;
    }

    let html = '';
    const renderedPhases = new Set();

    // Render phases in project order (including empty phases)
    phases.forEach(phase => {
      renderedPhases.add(phase);
      const phaseTasks = tasksByPhase[phase] || [];
      html += phaseHeader(phase, phaseTasks);
      if (!collapsedPhases.has(phase))
        phaseTasks.forEach(task => { html += taskRow(task); });
    });

    // Render any orphaned tasks whose phase isn't in proj.phases
    Object.entries(tasksByPhase).forEach(([phase, phaseTasks]) => {
      if (renderedPhases.has(phase)) return;
      html += phaseHeader(phase, phaseTasks);
      if (!collapsedPhases.has(phase))
        phaseTasks.forEach(task => { html += taskRow(task); });
    });

    tbody.innerHTML = html;
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, togglePhase, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
           onPhaseDragStart, onPhaseDragOver, onPhaseDragLeave, onPhaseDrop, onPhaseDragEnd };
})();
