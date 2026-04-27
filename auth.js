// auth.js — Authentication & Role-Based Permission Module
'use strict';

const Auth = (function () {

  const ROLES = ['administrator', 'program_manager', 'construction_manager', 'project_manager', 'property_developer', 'consultant', 'client'];

  const ROLE_LABELS = {
    administrator:        'Administrator',
    program_manager:      'Program Manager',
    construction_manager: 'Construction Manager',
    project_manager:      'Project Manager',
    property_developer:   'Property Developer',
    consultant:           'Consultant',
    client:               'Client',
  };

  // Capabilities per role — permissions are the union of all roles a user holds
  const PERMS = {
    //                             addProg  addProj  editTasks  users    archive  viewAll
    administrator:        { addProgram: true,  addProject: true,  editTasks: true,  manageUsers: true,  archiveProject: true,  viewAll: true  },
    program_manager:      { addProgram: false, addProject: true,  editTasks: true,  manageUsers: false, archiveProject: true,  viewAll: false },
    construction_manager: { addProgram: false, addProject: false, editTasks: true,  manageUsers: false, archiveProject: false, viewAll: false },
    project_manager:      { addProgram: false, addProject: false, editTasks: true,  manageUsers: false, archiveProject: false, viewAll: false },
    property_developer:   { addProgram: false, addProject: false, editTasks: true,  manageUsers: false, archiveProject: false, viewAll: false },
    consultant:           { addProgram: false, addProject: false, editTasks: false, manageUsers: false, archiveProject: false, viewAll: false },
    client:               { addProgram: false, addProject: false, editTasks: false, manageUsers: false, archiveProject: false, viewAll: false },
  };

  let _current = null;

  // Restore session from sessionStorage. Returns true if a valid session exists.
  function init(users) {
    const uid = sessionStorage.getItem('cds_uid');
    if (uid) {
      const u = (users || []).find(u => u.id === uid);
      if (u) { _current = u; return true; }
    }
    return false;
  }

  function login(username, password, users) {
    const u = (users || []).find(u =>
      u.username.toLowerCase() === (username || '').trim().toLowerCase() &&
      u.password === password
    );
    if (!u) return false;
    _current = u;
    sessionStorage.setItem('cds_uid', u.id);
    return true;
  }

  function logout() {
    _current = null;
    sessionStorage.removeItem('cds_uid');
  }

  function current() { return _current; }

  // Sync _current reference after editing your own profile in the users modal.
  function refreshCurrent(updatedUser) {
    if (_current && _current.id === updatedUser.id) _current = updatedUser;
  }

  // Force-sync _current when the user's own ID has changed (ID rename scenario).
  function forceRefreshCurrent(updatedUser) {
    if (_current) { _current = updatedUser; sessionStorage.setItem('cds_uid', updatedUser.id); }
  }

  function can(action) {
    if (!_current) return false;
    const roles = Array.isArray(_current.roles) ? _current.roles : [_current.role].filter(Boolean);
    return roles.some(r => !!(PERMS[r] || {})[action]);
  }

  function canViewProject(projectId) {
    if (!_current) return false;
    if (can('viewAll')) return true;
    return (_current.assignedProjects || []).includes(projectId);
  }

  // True when the user is assigned to the program itself (program_manager role).
  function canViewProgram(programId) {
    if (!_current) return false;
    if (can('viewAll')) return true;
    return (_current.assignedPrograms || []).includes(programId);
  }

  return { ROLES, ROLE_LABELS, PERMS, init, login, logout, current, refreshCurrent, forceRefreshCurrent, can, canViewProject, canViewProgram };
})();
