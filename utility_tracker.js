// utility_tracker.js — Property Development Utility Tracker
'use strict';

const UtilityTracker = (function () {
  const STORAGE_KEY = 'pdUtility_v2';

  let state        = { programs: [] };
  let activeProjId = null;
  let pdCurrentTab = 'summary';
  let _seq         = 0;
  const pdExpanded = new Set();

  // ── ID / Storage ─────────────────────────────────────────────────────────
  function genId() { return 'u_' + Date.now().toString(36) + '_' + (++_seq); }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { alert('Storage quota exceeded — export your data to preserve your work.'); }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        state.programs.forEach(p => pdExpanded.add(p.id));
      } else {
        // Migrate from v1 flat structure if it exists
        const old = localStorage.getItem('pdUtility_v1');
        if (old) {
          const parsed = JSON.parse(old);
          if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
            const id = genId();
            state.programs = [{ id, name: 'General', projects: parsed.projects }];
            pdExpanded.add(id);
            save();
          }
        }
      }
    } catch (e) { state = { programs: [] }; }
  }

  // ── Data helpers ──────────────────────────────────────────────────────────
  function emptyUtil() {
    return { account_setup: null, effective_start: null,
             address_transferred: null, first_bill_received: null };
  }

  function utilStatus(util) {
    if (!util) return 'not_started';
    const n = [util.account_setup, util.effective_start,
               util.address_transferred, util.first_bill_received].filter(Boolean).length;
    if (n === 4) return 'complete';
    if (n > 0)  return 'in_progress';
    return 'not_started';
  }

  function overallStatus(p) {
    const ss = ['electric', 'water', 'gas'].map(k => utilStatus(p[k]));
    if (ss.every(s => s === 'complete'))    return 'complete';
    if (ss.every(s => s === 'not_started')) return 'not_started';
    return 'in_progress';
  }

  function findProject(id) {
    for (const prog of state.programs) {
      const p = prog.projects.find(x => x.id === id);
      if (p) return { prog, proj: p };
    }
    return null;
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                          .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T12:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }

  function statusBadge(status) {
    const map = {
      complete:    ['badge-complete',  'Complete'],
      in_progress: ['badge-inprocess', 'In Progress'],
      not_started: ['badge-none',      'Not Started'],
    };
    const [cls, lbl] = map[status] || map.not_started;
    return `<span class="badge ${cls}">${lbl}</span>`;
  }

  function catBadge(cat) {
    const cls = cat === 'Ground Up' ? 'cat-groundup' :
                cat === 'Conversion' ? 'cat-conversion' : 'cat-tfo';
    return `<span class="cat-badge ${cls}">${esc(cat || '—')}</span>`;
  }

  function progressDots(util) {
    const fields = ['account_setup','effective_start','address_transferred','first_bill_received'];
    return fields.map(f =>
      `<span class="prog-dot${util?.[f] ? ' filled' : ''}" title="${f.replace(/_/g,' ')}"></span>`
    ).join('');
  }

  function statusDot(status) {
    const cls = status === 'complete' ? 'sdot-complete' :
                status === 'in_progress' ? 'sdot-progress' : 'sdot-none';
    return `<span class="sdot ${cls}"></span>`;
  }

  // ── Tab buttons + breadcrumb sync ─────────────────────────────────────────
  function syncTabs() {
    const tp = document.getElementById('pdTabProject');
    const ts = document.getElementById('pdTabSummary');
    if (tp) tp.classList.toggle('active', pdCurrentTab === 'project');
    if (ts) ts.classList.toggle('active', pdCurrentTab === 'summary');
  }

  function syncBreadcrumb() {
    const el = document.getElementById('pdBreadcrumb');
    if (!el) return;
    if (pdCurrentTab === 'summary' || !activeProjId) {
      el.innerHTML = 'Utility Tracker';
      return;
    }
    const found = findProject(activeProjId);
    if (!found) { el.innerHTML = 'Utility Tracker'; return; }
    el.innerHTML =
      `<span class="pd-bc-link" onclick="UtilityTracker.setTab('summary')">Utility Tracker</span>` +
      `<span class="breadcrumb-sep">/</span>` +
      `<span>${esc(found.prog.name)}</span>` +
      `<span class="breadcrumb-sep">/</span>` +
      `<span>${esc(found.proj.name)}</span>`;
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function renderSidebar() {
    const el = document.getElementById('pdSidebarList');
    if (!el) return;

    let html = '';

    for (const prog of state.programs) {
      const isOpen = pdExpanded.has(prog.id);
      let projHtml = '';
      if (isOpen) {
        projHtml = prog.projects.length
          ? prog.projects.map(proj => {
              const s = overallStatus(proj);
              const isActive = proj.id === activeProjId && pdCurrentTab === 'project';
              return `<div class="proj-item ${isActive ? 'active' : ''}"
                           onclick="UtilityTracker.showProject('${proj.id}')">
                ${statusDot(s)}<span class="proj-name">${esc(proj.name)}</span>
              </div>`;
            }).join('')
          : `<div class="proj-item-empty">No projects yet</div>`;
      }
      html += `
        <div class="prog-group">
          <div class="prog-header" onclick="UtilityTracker.toggleProgram('${prog.id}')">
            <span class="prog-chevron ${isOpen ? 'open' : ''}">&#9654;</span>
            <span class="prog-name">${esc(prog.name)}</span>
            <button class="prog-add-btn" title="Add project"
                    onclick="event.stopPropagation();UtilityTracker.openAddModal('${prog.id}')">+</button>
            <button class="prog-del-btn" title="Remove program"
                    onclick="event.stopPropagation();UtilityTracker.deleteProgram('${prog.id}')">&times;</button>
          </div>
          <div class="proj-list">${projHtml}</div>
        </div>`;
    }

    el.innerHTML = html;
  }

  // ── Summary view ──────────────────────────────────────────────────────────
  function renderSummary() {
    const rows = [];
    for (const prog of state.programs)
      for (const proj of prog.projects)
        rows.push({ prog, proj });

    const tbody = rows.length
      ? rows.map(({ prog, proj }) => `
          <tr class="pd-sum-row" onclick="UtilityTracker.showProject('${proj.id}')">
            <td class="pd-sum-prog"><span class="prog-pill">${esc(prog.name)}</span></td>
            <td class="pd-sum-name">${esc(proj.name)}</td>
            <td>${catBadge(proj.category)}</td>
            ${['electric','water','gas'].map(k => {
              const s = utilStatus(proj[k]);
              const eff = proj[k]?.effective_start;
              return `<td class="pd-util-cell">
                ${statusBadge(s)}
                <div class="prog-dots">${progressDots(proj[k])}</div>
                ${eff ? `<div class="pd-eff-date">${fmtDate(eff)}</div>` : ''}
              </td>`;
            }).join('')}
          </tr>`).join('')
      : `<tr><td colspan="6" class="pd-empty-td">
           No projects yet — add a program from the sidebar, then add projects to it.
         </td></tr>`;

    document.getElementById('pdMainContent').innerHTML = `
      <div class="pd-page-title">Utility Tracker — Summary</div>
      <div class="pd-table-wrap">
        <table class="pd-summary-table">
          <thead><tr>
            <th>Program</th><th>Project</th><th>Category</th>
            <th>Electric</th><th>Water</th><th>Gas</th>
          </tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;
  }

  // ── Contact card helper ───────────────────────────────────────────────────
  const CLIENT_FIELDS    = [
    { key: 'name',  label: 'Name',         type: 'text'  },
    { key: 'title', label: 'Title',        type: 'text'  },
    { key: 'email', label: 'Email',        type: 'email' },
    { key: 'phone', label: 'Phone',        type: 'tel'   },
  ];
  const DEVELOPER_FIELDS = [
    { key: 'name',  label: 'Name',         type: 'text'  },
    { key: 'email', label: 'Email',        type: 'email' },
    { key: 'phone', label: 'Phone',        type: 'tel'   },
  ];

  function renderContactCard(pid, party, fields, data) {
    const rows = fields.map(f => `
      <div class="pd-contact-row">
        <label class="pd-contact-lbl">${esc(f.label)}</label>
        <input type="${f.type}" class="pd-contact-input"
               value="${esc(data[f.key] || '')}"
               placeholder="—"
               data-pid="${esc(pid)}" data-party="${esc(party)}" data-field="${esc(f.key)}"
               onchange="UtilityTracker.saveContact(this)">
      </div>`).join('');
    const title = party === 'client' ? 'Client' : 'Property Developer';
    return `
      <div class="pd-contact-card">
        <div class="pd-contact-hdr">${title}</div>
        <div class="pd-contact-body">${rows}</div>
      </div>`;
  }

  // ── Project detail view ───────────────────────────────────────────────────
  const UTIL_META = [
    { key: 'electric', label: 'Electric', accentCls: 'ua-elec'  },
    { key: 'water',    label: 'Water',    accentCls: 'ua-water' },
    { key: 'gas',      label: 'Gas',      accentCls: 'ua-gas'   },
  ];
  const DATE_FIELDS = [
    { key: 'account_setup',       label: 'Account Set Up'      },
    { key: 'effective_start',     label: 'Effective Start Date' },
    { key: 'address_transferred', label: 'Address Transferred'  },
    { key: 'first_bill_received', label: 'First Bill Received'  },
  ];

  function renderProject(id) {
    const found = findProject(id);
    if (!found) { renderSummary(); return; }
    const { proj } = found;

    const cards = UTIL_META.map(({ key, label, accentCls }) => {
      const util = proj[key] || emptyUtil();
      const rows = DATE_FIELDS.map(f => `
        <div class="util-field-row">
          <label class="util-field-lbl">${esc(f.label)}</label>
          <input type="date" class="util-date-input"
                 value="${esc(util[f.key] || '')}"
                 data-pid="${esc(proj.id)}" data-ukey="${esc(key)}" data-fkey="${esc(f.key)}"
                 onchange="UtilityTracker.saveDate(this)">
        </div>`).join('');

      const photos      = util.photos      || [null, null];
      const photoLabels = util.photoLabels || ['', ''];
      const photoSlots = [0, 1].map(idx => {
        const src   = photos[idx];
        const label = photoLabels[idx] || '';
        const inner = src
          ? `<img src="${src}" class="util-photo-img">
             <button class="util-photo-del" title="Remove photo"
                     onclick="event.stopPropagation();UtilityTracker.removePhoto('${esc(proj.id)}','${esc(key)}',${idx})">&times;</button>`
          : `<span class="util-photo-add">+</span>`;
        return `
          <div class="util-photo-wrap">
            <div class="util-photo-slot" id="uphoto-${proj.id}-${key}-${idx}"
                 onclick="UtilityTracker.uploadPhoto('${esc(proj.id)}','${esc(key)}',${idx})"
                 title="${src ? 'Click to replace photo' : 'Click to add photo'}">${inner}</div>
            <input type="text" class="util-photo-label"
                   value="${esc(label)}" placeholder="Add label…"
                   data-pid="${esc(proj.id)}" data-ukey="${esc(key)}" data-idx="${idx}"
                   onchange="UtilityTracker.savePhotoLabel(this)">
          </div>`;
      }).join('');

      return `
        <div class="util-card ${accentCls}">
          <div class="util-card-hdr">
            <span class="util-card-title">${esc(label)}</span>
            <span id="ubadge-${proj.id}-${key}">${statusBadge(utilStatus(util))}</span>
          </div>
          <div class="util-card-body">
            ${rows}
            <div class="util-photos">${photoSlots}</div>
          </div>
        </div>`;
    }).join('');

    const client    = proj.client    || {};
    const developer = proj.developer || {};
    const addr      = proj.address   || '';
    const svHref    = addr ? 'https://www.google.com/maps?q=' + encodeURIComponent(addr) : '#';

    const addressBar = `
      <div class="pd-address-bar">
        <label class="pd-address-lbl">Project Address</label>
        <input type="text" class="pd-address-input"
               value="${esc(addr)}" placeholder="Enter project address…"
               data-pid="${esc(proj.id)}"
               onchange="UtilityTracker.saveAddress(this)">
        <a id="pdSvBtn-${proj.id}"
           class="btn btn-sm pd-sv-btn${addr ? '' : ' hidden'}"
           href="${esc(svHref)}" target="_blank" rel="noopener">Map &nearr;</a>
      </div>`;

    const contactSection = `
      <div class="pd-contacts-grid">
        ${renderContactCard(proj.id, 'client',    CLIENT_FIELDS,    client)}
        ${renderContactCard(proj.id, 'developer', DEVELOPER_FIELDS, developer)}
      </div>`;

    document.getElementById('pdMainContent').innerHTML = `
      <div class="pd-proj-header">
        <div>
          <h1 class="pd-proj-title">${esc(proj.name)}</h1>
          <div class="pd-proj-meta">${catBadge(proj.category)}</div>
        </div>
        <button class="btn btn-danger btn-sm"
                onclick="UtilityTracker.deleteProject('${proj.id}')">Delete</button>
      </div>
      ${addressBar}
      ${contactSection}
      <div class="util-cards-grid">${cards}</div>`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {

    init() { load(); },

    // Called each time the user switches to the PD division
    activate() {
      renderSidebar();
      syncTabs();
      syncBreadcrumb();
      if (pdCurrentTab === 'project' && activeProjId) renderProject(activeProjId);
      else { pdCurrentTab = 'summary'; syncTabs(); renderSummary(); }
    },

    setTab(tab) {
      pdCurrentTab = tab;
      syncTabs();
      syncBreadcrumb();
      renderSidebar();
      if (tab === 'summary') {
        renderSummary();
      } else {
        if (activeProjId) renderProject(activeProjId);
        else document.getElementById('pdMainContent').innerHTML =
          '<div class="empty-state">Select a project from the sidebar.</div>';
      }
    },

    showProject(id) {
      activeProjId = id;
      pdCurrentTab = 'project';
      syncTabs();
      syncBreadcrumb();
      renderSidebar();
      renderProject(id);
    },

    toggleProgram(progId) {
      pdExpanded.has(progId) ? pdExpanded.delete(progId) : pdExpanded.add(progId);
      renderSidebar();
    },

    addProgram() {
      const name = prompt('Program name:');
      if (!name || !name.trim()) return;
      const id = genId();
      pdExpanded.add(id);
      state.programs.push({ id, name: name.trim(), projects: [] });
      save();
      renderSidebar();
    },

    deleteProgram(progId) {
      const prog = state.programs.find(p => p.id === progId);
      if (!prog) return;
      const msg = prog.projects.length
        ? `Delete program "${prog.name}" and all ${prog.projects.length} project(s) inside it? This cannot be undone.`
        : `Delete program "${prog.name}"? This cannot be undone.`;
      if (!confirm(msg)) return;
      // If active project is inside this program, clear it
      if (activeProjId && prog.projects.some(p => p.id === activeProjId))
        activeProjId = null;
      state.programs = state.programs.filter(p => p.id !== progId);
      pdExpanded.delete(progId);
      save();
      this.setTab('summary');
    },

    uploadPhoto(pid, ukey, idx) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          const found = findProject(pid);
          if (!found) return;
          const { proj } = found;
          if (!proj[ukey]) proj[ukey] = emptyUtil();
          if (!proj[ukey].photos) proj[ukey].photos = [null, null];
          proj[ukey].photos[idx] = ev.target.result;
          save();
          const slot = document.getElementById(`uphoto-${pid}-${ukey}-${idx}`);
          if (slot) {
            slot.title = 'Click to replace photo';
            slot.innerHTML = `
              <img src="${ev.target.result}" class="util-photo-img">
              <button class="util-photo-del" title="Remove photo"
                      onclick="event.stopPropagation();UtilityTracker.removePhoto('${pid}','${ukey}',${idx})">&times;</button>`;
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },

    savePhotoLabel(input) {
      const { pid, ukey, idx } = input.dataset;
      const found = findProject(pid);
      if (!found) return;
      const { proj } = found;
      if (!proj[ukey]) proj[ukey] = emptyUtil();
      if (!proj[ukey].photoLabels) proj[ukey].photoLabels = ['', ''];
      proj[ukey].photoLabels[parseInt(idx)] = input.value;
      save();
    },

    removePhoto(pid, ukey, idx) {
      const found = findProject(pid);
      if (!found) return;
      const { proj } = found;
      if (proj[ukey]?.photos) proj[ukey].photos[idx] = null;
      save();
      const slot = document.getElementById(`uphoto-${pid}-${ukey}-${idx}`);
      if (slot) {
        slot.title = 'Click to add photo';
        slot.innerHTML = `<span class="util-photo-add">+</span>`;
      }
    },

    saveAddress(input) {
      const { pid } = input.dataset;
      const found = findProject(pid);
      if (!found) return;
      const { proj } = found;
      proj.address = input.value.trim();
      save();
      const btn = document.getElementById(`pdSvBtn-${pid}`);
      if (btn) {
        if (proj.address) {
          btn.href = 'https://www.google.com/maps?q=' + encodeURIComponent(proj.address);
          btn.classList.remove('hidden');
        } else {
          btn.classList.add('hidden');
        }
      }
    },

    saveContact(input) {
      const { pid, party, field } = input.dataset;
      const found = findProject(pid);
      if (!found) return;
      const { proj } = found;
      if (!proj[party]) proj[party] = {};
      proj[party][field] = input.value.trim();
      save();
    },

    saveDate(input) {
      const { pid, ukey, fkey } = input.dataset;
      const found = findProject(pid);
      if (!found) return;
      const { proj } = found;
      if (!proj[ukey]) proj[ukey] = emptyUtil();
      proj[ukey][fkey] = input.value || null;
      save();
      const badge = document.getElementById(`ubadge-${pid}-${ukey}`);
      if (badge) badge.innerHTML = statusBadge(utilStatus(proj[ukey]));
      input.classList.add('date-saved');
      setTimeout(() => input.classList.remove('date-saved'), 800);
    },

    openAddModal(progId) {
      document.getElementById('pdAddModal')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pdAddModal';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Add Utility Project</h2>
            <button class="btn-close" onclick="document.getElementById('pdAddModal').remove()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-field">
                <label class="form-label">Project Name <span style="color:#ef4444">*</span></label>
                <input id="pdModalName" class="form-input" type="text"
                       placeholder="e.g. Fogo Nashville TN"
                       onkeydown="if(event.key==='Enter')UtilityTracker.saveNewProject()">
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label">Category</label>
                <select id="pdModalCat" class="form-select">
                  <option>Ground Up</option>
                  <option>Conversion</option>
                  <option>Tenant Finish Out</option>
                </select>
              </div>
            </div>
            <input type="hidden" id="pdModalProgId" value="${esc(progId || '')}">
          </div>
          <div class="modal-footer">
            <div class="footer-right">
              <button class="btn" onclick="document.getElementById('pdAddModal').remove()">Cancel</button>
              <button class="btn btn-primary" onclick="UtilityTracker.saveNewProject()">Add Project</button>
            </div>
          </div>
        </div>`;
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      setTimeout(() => document.getElementById('pdModalName')?.focus(), 40);
    },

    saveNewProject() {
      const name = document.getElementById('pdModalName')?.value.trim();
      if (!name) { document.getElementById('pdModalName')?.focus(); return; }
      const cat    = document.getElementById('pdModalCat')?.value || 'Ground Up';
      const progId = document.getElementById('pdModalProgId')?.value;
      let prog = state.programs.find(p => p.id === progId);
      if (!prog) {
        if (!state.programs.length) {
          const id = genId();
          prog = { id, name: 'General', projects: [] };
          state.programs.push(prog);
          pdExpanded.add(id);
        } else {
          prog = state.programs[0];
        }
      }
      const p = { id: genId(), name, category: cat,
                  electric: emptyUtil(), water: emptyUtil(), gas: emptyUtil() };
      prog.projects.push(p);
      pdExpanded.add(prog.id);
      save();
      document.getElementById('pdAddModal')?.remove();
      this.showProject(p.id);
    },

    deleteProject(id) {
      if (!confirm('Delete this project? This cannot be undone.')) return;
      for (const prog of state.programs) {
        const idx = prog.projects.findIndex(p => p.id === id);
        if (idx !== -1) { prog.projects.splice(idx, 1); break; }
      }
      if (activeProjId === id) activeProjId = null;
      save();
      this.setTab('summary');
    },
  };
})();
