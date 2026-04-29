// gantt.js — SVG Gantt Chart Renderer (phase-grouped, collapsible)

'use strict';

const Gantt = (function () {
  const LABEL_W   = 200;
  const HEADER_H  = 48;
  const ROW_H     = 40;
  const BAR_H     = 24;
  const BAR_PAD_Y = (ROW_H - BAR_H) / 2;
  const PHASE_H   = 26;
  const WEEK_W    = 30;
  const DAY_W     = WEEK_W / 7;

  const BAR_COLORS = {
    complete:    '#22c55e',
    in_progress: '#3b82f6',
    overdue:     '#ef4444',
    not_started: '#94a3b8',
  };

  const collapsedPhases = new Set();
  let _initialized = false;
  let _rowBreaks = []; // Y positions of every row boundary, including 0 and bodyH

  function reset() {
    collapsedPhases.clear();
    _initialized = false;
  }

  function barStatus(task, today) {
    if (task.status === 'complete')    return 'complete';
    if (task.status === 'in_progress') return 'in_progress';
    if (task.plannedEnd && task.plannedEnd < today) return 'overdue';
    return 'not_started';
  }

  function mkSvg(w, h, inner) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('width', w);
    el.setAttribute('height', h);
    el.style.display = 'block';
    el.innerHTML = inner;
    return el;
  }

  function render(tasks, projectStartDate, wrapperId) {
    const wrapper = document.getElementById(wrapperId);

    if (!tasks.length) {
      wrapper.innerHTML = '<p class="gantt-empty">No tasks to display. Add tasks to see the chart.</p>';
      const legend = document.getElementById('ganttLegend');
      if (legend) legend.innerHTML = '';
      return;
    }

    // Collapse all phases by default on first render for this project
    if (!_initialized) {
      tasks.forEach(t => { if (t.phase) collapsedPhases.add(t.phase); });
      _initialized = true;
    }

    const today = CPM.todayIso();

    // O(1) task lookup by id — used for dependency arrows
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Pre-group tasks by phase — used for rollup counts
    const tasksByPhase = new Map();
    tasks.forEach(t => {
      const p = t.phase || '';
      if (!tasksByPhase.has(p)) tasksByPhase.set(p, []);
      tasksByPhase.get(p).push(t);
    });

    // ── Build display list ─────────────────────────────────────────────────
    const displayItems = [];
    let currentPhase = null;
    let taskIndex = 0;
    tasks.forEach(task => {
      const p = task.phase || '';
      if (p !== currentPhase) {
        const isCollapsed = collapsedPhases.has(p);
        displayItems.push({ type: 'phase', name: p || 'Unassigned', collapsed: isCollapsed });
        if (isCollapsed) displayItems.push({ type: 'rollup', phase: p });
        currentPhase = p;
      }
      if (!collapsedPhases.has(p)) displayItems.push({ type: 'task', task, taskIndex: taskIndex++ });
    });

    // Y positions (body-relative — no header offset)
    let y = 0;
    displayItems.forEach(item => {
      item.y = y;
      y += item.type === 'phase' ? PHASE_H : ROW_H;
    });
    const bodyH = y;

    // Record row boundaries so _buildGanttPrintTable can snap page breaks between rows
    _rowBreaks = displayItems.map(i => i.y);
    _rowBreaks.push(bodyH);

    // ── Date range ─────────────────────────────────────────────────────────
    const allIso = tasks.flatMap(t => [t.plannedStart, t.plannedEnd]).filter(Boolean);
    allIso.push(today);
    const rawMin    = allIso.reduce((a, b) => a < b ? a : b);
    const rawMax    = allIso.reduce((a, b) => a > b ? a : b);
    const rawMinDay = CPM.isoToDay(CPM.addDays(rawMin, -7));
    const rawMinDow = new Date(CPM.dayToIso(rawMinDay) + 'T12:00:00Z').getUTCDay();
    const minDay    = rawMinDay - (rawMinDow === 0 ? 6 : rawMinDow - 1);
    const maxDay    = CPM.isoToDay(CPM.addDays(rawMax, 14));
    const totalWeeks = Math.ceil((maxDay - minDay) / 7) + 1;
    const cW        = totalWeeks * WEEK_W;

    const todayX = (CPM.isoToDay(today) - minDay) * DAY_W;

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const taskItems = displayItems.filter(i => i.type === 'task');

    // ── Corner SVG (sticky top-left) ───────────────────────────────────────
    let sCorner = '';
    sCorner += `<rect width="${LABEL_W}" height="${HEADER_H}" fill="#f1f5f9"/>`;
    sCorner += `<line x1="0" y1="${HEADER_H - 1}" x2="${LABEL_W}" y2="${HEADER_H - 1}" stroke="#cbd5e1" stroke-width="1.5"/>`;
    sCorner += `<text x="10" y="17" class="g-label-hdr">Task</text>`;
    sCorner += `<text x="${LABEL_W - 8}" y="17" class="g-label-hdr" text-anchor="end">Assigned</text>`;

    // ── Date header SVG (sticky top, scrolls horizontally) ─────────────────
    let sDateHdr = '';
    sDateHdr += `<rect width="${cW}" height="${HEADER_H}" fill="#f8fafc"/>`;
    sDateHdr += `<line x1="0" y1="${HEADER_H - 1}" x2="${cW}" y2="${HEADER_H - 1}" stroke="#cbd5e1" stroke-width="1.5"/>`;
    let prevMonth = -1;
    for (let w = 0; w < totalWeeks; w++) {
      const wDayNum = minDay + w * 7;
      const iso = CPM.dayToIso(wDayNum);
      const [yr, mo, dy] = iso.split('-').map(Number);
      const x = w * WEEK_W;
      if (mo !== prevMonth) {
        if (w > 0) sDateHdr += `<line x1="${x}" y1="0" x2="${x}" y2="${HEADER_H}" stroke="#e2e8f0" stroke-width="1"/>`;
        let monthEndW = w + 1;
        while (monthEndW < totalWeeks && parseInt(CPM.dayToIso(minDay + monthEndW * 7).split('-')[1]) === mo) monthEndW++;
        if ((monthEndW - w) * WEEK_W > 44)
          sDateHdr += `<text x="${x + 4}" y="17" class="g-month">${MONTHS[mo - 1]} ${yr}</text>`;
        prevMonth = mo;
      }
      sDateHdr += `<text x="${x + WEEK_W / 2}" y="37" class="g-day" text-anchor="middle">${dy}</text>`;
      if (w > 0) sDateHdr += `<line x1="${x}" y1="${HEADER_H - 8}" x2="${x}" y2="${HEADER_H - 1}" stroke="#e2e8f0" stroke-width="1"/>`;
    }
    if (todayX >= 0 && todayX < cW) {
      sDateHdr += `<line x1="${todayX}" y1="0" x2="${todayX}" y2="${HEADER_H}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.65"/>`;
      sDateHdr += `<text x="${todayX + 3}" y="${HEADER_H - 10}" class="g-today-label">Today</text>`;
    }

    // ── Label body SVG (sticky left, scrolls vertically) ───────────────────
    let sLabels = '';
    sLabels += `<defs><clipPath id="lblClip"><rect x="0" y="0" width="${LABEL_W - 8}" height="${bodyH}"/></clipPath></defs>`;
    sLabels += `<rect width="${LABEL_W}" height="${bodyH}" fill="#fff"/>`;

    // Phase backgrounds
    displayItems.forEach(item => {
      if (item.type !== 'phase') return;
      const colors = PHASE_COLORS[item.name] || { bg: '#f8fafc', text: '#475569' };
      sLabels += `<rect x="0" y="${item.y}" width="${LABEL_W}" height="${PHASE_H}" fill="${colors.bg}"/>`;
    });

    // Task row stripes + dividers
    taskItems.forEach((item, ti) => {
      if (ti % 2 === 1)
        sLabels += `<rect x="0" y="${item.y}" width="${LABEL_W}" height="${ROW_H}" fill="#fafbfc"/>`;
      sLabels += `<line x1="0" y1="${item.y + ROW_H}" x2="${LABEL_W}" y2="${item.y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
    });
    displayItems.filter(i => i.type === 'rollup').forEach(item => {
      sLabels += `<line x1="0" y1="${item.y + ROW_H}" x2="${LABEL_W}" y2="${item.y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
    });

    // Phase labels + chevrons
    displayItems.forEach(item => {
      if (item.type !== 'phase') return;
      const colors  = PHASE_COLORS[item.name] || { bg: '#f8fafc', text: '#475569' };
      const chevron = item.collapsed ? '\u25B6' : '\u25BC';
      sLabels += `<text x="10" y="${item.y + PHASE_H / 2 + 5}" class="g-phase-label" fill="${colors.text}"
        clip-path="url(#lblClip)" pointer-events="none">${chevron} ${esc(item.name)}</text>`;
    });

    // Task + rollup labels
    displayItems.forEach(item => {
      if (item.type === 'rollup') {
        const midY   = item.y + ROW_H / 2;
        const colors = PHASE_COLORS[item.phase] || { bg: '#e2e8f0', text: '#475569' };
        const pt     = tasksByPhase.get(item.phase) || [];
        const done   = pt.filter(t => t.status === 'complete').length;
        sLabels += `<text x="10" y="${midY - 4}" class="g-label-name" fill="${colors.text}"
          clip-path="url(#lblClip)">${esc(item.phase)}</text>`;
        sLabels += `<text x="10" y="${midY + 11}" class="g-label-sub" clip-path="url(#lblClip)"
          >${done}/${pt.length} complete</text>`;
        return;
      }
      if (item.type !== 'task') return;
      const task = item.task;
      const midY = item.y + ROW_H / 2;
      const done = task.status === 'complete';
      sLabels += `<text x="10" y="${midY - 4}" class="g-label-name" fill="${done ? '#9ca3af' : '#1e293b'}"
        style="text-decoration:${done ? 'line-through' : 'none'}" clip-path="url(#lblClip)"
        >${esc(truncate(task.name, 22))}</text>`;
      sLabels += `<text x="10" y="${midY + 11}" class="g-label-sub" clip-path="url(#lblClip)"
        >${esc(App.getUserName(task.assignee) || '')}</text>`;
    });

    // Right border
    sLabels += `<line x1="${LABEL_W - 1}" y1="0" x2="${LABEL_W - 1}" y2="${bodyH}" stroke="#e2e8f0" stroke-width="1.5"/>`;

    // Phase click-capture rects
    displayItems.forEach(item => {
      if (item.type !== 'phase') return;
      sLabels += `<rect x="0" y="${item.y}" width="${LABEL_W}" height="${PHASE_H}"
        fill="transparent" data-phase-toggle="${esc(item.name)}" style="cursor:pointer"/>`;
    });

    // ── Chart body SVG (scrolls both directions) ────────────────────────────
    let sChart = `<defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af"/>
      </marker>
    </defs>`;
    sChart += `<rect width="${cW}" height="${bodyH}" fill="#fff"/>`;

    // Alternating week shading
    for (let w = 0; w < totalWeeks; w++) {
      if (w % 2 === 1)
        sChart += `<rect x="${w * WEEK_W}" y="0" width="${WEEK_W}" height="${bodyH}" fill="#f9fafb"/>`;
    }

    // Phase bands + row stripes
    displayItems.forEach(item => {
      if (item.type === 'phase') {
        const colors = PHASE_COLORS[item.name] || { bg: '#f8fafc', text: '#475569' };
        sChart += `<rect x="0" y="${item.y}" width="${cW}" height="${PHASE_H}" fill="${colors.bg}"/>`;
        sChart += `<text x="6" y="${item.y + PHASE_H / 2 + 5}" class="g-phase-chart-label"
          fill="${colors.text}" pointer-events="none">${esc(item.name)}</text>`;
      } else if (item.type === 'task') {
        if (item.taskIndex % 2 === 1)
          sChart += `<rect x="0" y="${item.y}" width="${cW}" height="${ROW_H}" fill="#fafbfc"/>`;
        sChart += `<line x1="0" y1="${item.y + ROW_H}" x2="${cW}" y2="${item.y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
      } else if (item.type === 'rollup') {
        sChart += `<line x1="0" y1="${item.y + ROW_H}" x2="${cW}" y2="${item.y + ROW_H}" stroke="#f0f2f5" stroke-width="1"/>`;
      }
    });

    // Week grid lines
    for (let w = 1; w < totalWeeks; w++)
      sChart += `<line x1="${w * WEEK_W}" y1="0" x2="${w * WEEK_W}" y2="${bodyH}" stroke="#f0f2f5" stroke-width="1"/>`;

    // Today line
    if (todayX >= 0 && todayX < cW)
      sChart += `<line x1="${todayX}" y1="0" x2="${todayX}" y2="${bodyH}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.65"/>`;

    // Dependency arrows
    const visibleTaskIds = new Set(displayItems.filter(i => i.type === 'task').map(i => i.task.id));
    const taskYMid = new Map();
    displayItems.forEach(item => { if (item.type === 'task') taskYMid.set(item.task.id, item.y + ROW_H / 2); });

    sChart += `<g pointer-events="none">`;
    displayItems.forEach(item => {
      if (item.type !== 'task' || !item.task.plannedStart) return;
      const task  = item.task;
      const sMidY = taskYMid.get(task.id);
      task.dependencies.forEach(dep => {
        if (!visibleTaskIds.has(dep.taskId)) return;
        const pred = taskMap.get(dep.taskId);
        if (!pred || !pred.plannedStart) return;
        const pMidY = taskYMid.get(pred.id);
        if (pMidY === undefined) return;
        const pStartX = (CPM.isoToDay(pred.plannedStart) - minDay) * DAY_W;
        const pEndX   = (CPM.isoToDay(pred.plannedEnd)   - minDay + 1) * DAY_W;
        const sStartX = (CPM.isoToDay(task.plannedStart) - minDay) * DAY_W;
        const sEndX   = (CPM.isoToDay(task.plannedEnd)   - minDay + 1) * DAY_W;
        let x1, x2;
        switch (dep.type) {
          case 'FS': x1 = pEndX;   x2 = sStartX; break;
          case 'SS': x1 = pStartX; x2 = sStartX; break;
          case 'FF': x1 = pEndX;   x2 = sEndX;   break;
          case 'SF': x1 = pStartX; x2 = sEndX;   break;
          default:   x1 = pEndX;   x2 = sStartX;
        }
        sChart += `<path d="M ${x1} ${pMidY} H ${(x1 + x2) / 2} V ${sMidY} H ${x2}"
          fill="none" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#arr)"/>`;
      });
    });
    sChart += `</g>`;

    // Bars
    displayItems.forEach(item => {
      if (item.type === 'rollup') {
        const pt = tasks.filter(t => t.phase === item.phase && t.plannedStart && t.plannedEnd);
        if (!pt.length) return;
        const start  = pt.reduce((m, t) => t.plannedStart < m ? t.plannedStart : m, pt[0].plannedStart);
        const end    = pt.reduce((m, t) => t.plannedEnd   > m ? t.plannedEnd   : m, pt[0].plannedEnd);
        const total  = pt.length, done = pt.filter(t => t.status === 'complete').length;
        const pct    = total ? Math.round(done / total * 100) : 0;
        const colors = PHASE_COLORS[item.phase] || { bg: '#e2e8f0', text: '#475569' };
        const barX   = (CPM.isoToDay(start) - minDay) * DAY_W + 3;
        const barW   = Math.max((CPM.isoToDay(end) - CPM.isoToDay(start) + 1) * DAY_W - 6, 6);
        const barY   = item.y + BAR_PAD_Y;
        sChart += `<rect x="${barX}" y="${barY}" width="${barW}" height="${BAR_H}" rx="4"
               fill="${colors.bg}" stroke="${colors.text}" stroke-width="1.5" stroke-opacity="0.7">
               <title>${esc(item.phase)}: ${start} \u2192 ${end} | ${done}/${total} (${pct}%)</title></rect>`;
        if (pct > 0 && pct < 100)
          sChart += `<rect x="${barX}" y="${barY}" width="${Math.round(barW * pct / 100)}" height="${BAR_H}" rx="4"
                 fill="${colors.text}" opacity="0.2" pointer-events="none"/>`;
        if (barW > 40)
          sChart += `<text x="${barX + barW / 2}" y="${barY + BAR_H / 2 + 4}"
                 class="g-bar-label" text-anchor="middle" pointer-events="none" style="fill:${colors.text}">${pct}%</text>`;
        return;
      }
      if (item.type !== 'task') return;
      const task = item.task;
      if (!task.plannedStart || !task.plannedEnd) return;
      const barX  = (CPM.isoToDay(task.plannedStart) - minDay) * DAY_W + 3;
      const barW  = Math.max((CPM.isoToDay(task.plannedEnd) - CPM.isoToDay(task.plannedStart) + 1) * DAY_W - 6, 6);
      const barY  = item.y + BAR_PAD_Y;
      const color = BAR_COLORS[barStatus(task, today)];
      sChart += `<rect x="${barX}" y="${barY}" width="${barW}" height="${BAR_H}" rx="4"
              fill="${color}" class="g-bar" data-id="${task.id}" style="cursor:pointer">
              <title>${esc(task.name)} | ${task.plannedStart} \u2192 ${task.plannedEnd} | ${task.duration}d${task.assignee ? ' | ' + App.getUserName(task.assignee) : ''}</title></rect>`;
      if (barW > 28)
        sChart += `<text x="${barX + barW / 2}" y="${barY + BAR_H / 2 + 4}"
          class="g-bar-label" text-anchor="middle" pointer-events="none">${task.duration}d</text>`;
    });

    // ── Assemble 4-panel layout ────────────────────────────────────────────
    const cornerSvg  = mkSvg(LABEL_W, HEADER_H, sCorner);
    const dateHdrSvg = mkSvg(cW,      HEADER_H, sDateHdr);
    const labelSvg   = mkSvg(LABEL_W, bodyH,    sLabels);
    const chartSvg   = mkSvg(cW,      bodyH,    sChart);

    // Phase toggle on label SVG
    labelSvg.addEventListener('click', e => {
      const el = e.target.closest('[data-phase-toggle]');
      if (!el) return;
      const phase = el.getAttribute('data-phase-toggle');
      collapsedPhases.has(phase) ? collapsedPhases.delete(phase) : collapsedPhases.add(phase);
      render(tasks, projectStartDate, wrapperId);
    });

    // Bar click on chart SVG
    chartSvg.addEventListener('click', e => {
      const bar = e.target.closest('.g-bar');
      if (bar) App.openEditTask(bar.dataset.id);
    });

    // Header row: corner (sticky top+left) + date header (sticky top)
    const hdrRow     = document.createElement('div');
    hdrRow.className = 'gantt-hdr-row';
    const cornerDiv  = document.createElement('div');
    cornerDiv.className = 'gantt-corner';
    cornerDiv.appendChild(cornerSvg);
    const dateDiv    = document.createElement('div');
    dateDiv.className = 'gantt-date-hdr-wrap';
    dateDiv.appendChild(dateHdrSvg);
    hdrRow.appendChild(cornerDiv);
    hdrRow.appendChild(dateDiv);

    // Body row: labels (sticky left) + chart
    const bodyRow    = document.createElement('div');
    bodyRow.className = 'gantt-body-row';
    const labelDiv   = document.createElement('div');
    labelDiv.className = 'gantt-label-col';
    labelDiv.appendChild(labelSvg);
    const chartDiv   = document.createElement('div');
    chartDiv.className = 'gantt-chart-body';
    chartDiv.appendChild(chartSvg);
    bodyRow.appendChild(labelDiv);
    bodyRow.appendChild(chartDiv);

    const inner      = document.createElement('div');
    inner.className  = 'gantt-inner';
    inner.appendChild(hdrRow);
    inner.appendChild(bodyRow);

    wrapper.innerHTML = '';
    wrapper.appendChild(inner);

    // Legend
    const legend = document.getElementById('ganttLegend');
    if (legend) {
      legend.innerHTML = Object.entries({
        'Not Started': BAR_COLORS.not_started,
        'In Progress': BAR_COLORS.in_progress,
        'Complete':    BAR_COLORS.complete,
        'Overdue':     BAR_COLORS.overdue,
      }).map(([label, color]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${label}</span>`
      ).join('');
    }
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n - 1) + '\u2026' : str;
  }

  function getRowBreaks() { return _rowBreaks; }

  return { render, reset, getRowBreaks };
})();
