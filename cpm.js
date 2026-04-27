// cpm.js — CPM Scheduling Engine
// Handles all date math and forward-pass scheduling for all 4 dependency types.

'use strict';

const CPM = (function () {
  const MS = 86400000; // ms per day

  // ── Date helpers (timezone-safe, always work in UTC day numbers) ───────────
  function isoToDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / MS);
  }

  function dayToIso(n) {
    const d = new Date(n * MS);
    return [
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  function addDays(iso, n) {
    return dayToIso(isoToDay(iso) + n);
  }

  function todayIso() {
    return dayToIso(Math.floor(Date.now() / MS));
  }

  // Return the later of two ISO date strings (null-safe)
  function maxIso(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return a >= b ? a : b;
  }

  /**
   * Compute plannedStart / plannedEnd for every task using a CPM forward pass.
   * Mutates task objects in place.
   *
   * Dependency types (standard PM semantics):
   *   FS (Finish→Start):   successor starts the day AFTER predecessor finishes + lag
   *   SS (Start→Start):    successor starts on the same day predecessor starts + lag
   *   FF (Finish→Finish):  successor finishes on the same day predecessor finishes + lag
   *   SF (Start→Finish):   successor finishes on the same day predecessor starts + lag
   *
   * Lag is in calendar days; negative lag = lead time.
   *
   * When a task has actualStart set, plannedEnd shifts to actualStart + duration so
   * downstream tasks recalculate accordingly. plannedStart remains the CPM-computed date.
   * When a task has actualEnd set (and is complete), that date is used as its effective finish.
   *
   * Returns { ok: true } or { ok: false, error: string }
   */
  function compute(tasks, projectStartDate) {
    if (!tasks.length) return { ok: true };

    const map       = new Map(tasks.map(t => [t.id, t]));
    const inDeg     = new Map(tasks.map(t => [t.id, 0]));
    const successors = new Map(tasks.map(t => [t.id, []]));

    // Build graph
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (!map.has(dep.taskId)) continue;
        inDeg.set(task.id, inDeg.get(task.id) + 1);
        successors.get(dep.taskId).push(task.id);
      }
    }

    // Working variables: earliest constrained start/end imposed by predecessors
    const cs = new Map(tasks.map(t => [t.id, { start: null, end: null }]));

    // Queue: tasks with no predecessors
    const queue = [];
    for (const task of tasks) {
      if (inDeg.get(task.id) === 0) {
        task.plannedStart = projectStartDate;
        task.plannedEnd   = _effectiveEnd(task, projectStartDate);
        queue.push(task.id);
      }
    }

    let processed = 0;

    while (queue.length) {
      const curId = queue.shift();
      const cur   = map.get(curId);
      processed++;

      for (const succId of successors.get(curId)) {
        const succ = map.get(succId);
        const dep  = succ.dependencies.find(d => d.taskId === curId);
        const lag  = dep.lag || 0;
        const c    = cs.get(succId);

        switch (dep.type) {
          case 'FS': // successor starts day after predecessor ends + lag
            c.start = maxIso(c.start, addDays(cur.plannedEnd, lag + 1));
            break;
          case 'SS': // successor starts same day as predecessor starts + lag
            c.start = maxIso(c.start, addDays(cur.plannedStart, lag));
            break;
          case 'FF': // successor ends same day as predecessor ends + lag
            c.end = maxIso(c.end, addDays(cur.plannedEnd, lag));
            break;
          case 'SF': // successor ends same day as predecessor starts + lag
            c.end = maxIso(c.end, addDays(cur.plannedStart, lag));
            break;
        }

        inDeg.set(succId, inDeg.get(succId) - 1);

        if (inDeg.get(succId) === 0) {
          // Resolve start from constraints
          let ps = c.start || projectStartDate;

          if (c.end != null) {
            // FF or SF imposed a constraint on the end → derive start from that
            const startFromEnd = addDays(c.end, -(Math.max(0, succ.duration - 1)));
            ps = maxIso(ps, startFromEnd);
          }

          succ.plannedStart = ps;
          succ.plannedEnd   = _effectiveEnd(succ, ps);
          queue.push(succId);
        }
      }
    }

    // Cycle detection: any task not processed has a cycle
    if (processed < tasks.length) {
      // Assign project start to unscheduled tasks as a fallback
      for (const task of tasks) {
        if (!task.plannedStart) {
          task.plannedStart = projectStartDate;
          task.plannedEnd   = _effectiveEnd(task, projectStartDate);
        }
      }
      return { ok: false, error: 'Cycle detected in dependencies — some dates may be inaccurate.' };
    }

    return { ok: true };
  }

  // Effective end: use actualEnd if complete, else base duration on actualStart if set
  function _effectiveEnd(task, start) {
    if (task.actualEnd && task.status === 'complete') return task.actualEnd;
    const effectiveStart = task.actualStart || start;
    return addDays(effectiveStart, Math.max(0, task.duration - 1));
  }

  return { compute, addDays, isoToDay, dayToIso, todayIso, maxIso };
})();
