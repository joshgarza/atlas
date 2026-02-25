import { Hono } from 'hono';
import { html } from 'hono/html';

const app = new Hono();

const EDGE_STYLES: Record<string, { color: string; dash: string; label: string }> = {
  supports: { color: '#22c55e', dash: 'none', label: 'Supports' },
  contradicts: { color: '#ef4444', dash: '8,4', label: 'Contradicts' },
  derived_from: { color: '#3b82f6', dash: '4,4', label: 'Derived From' },
  related_to: { color: '#a855f7', dash: '2,4', label: 'Related To' },
  supersedes: { color: '#f97316', dash: '12,4,2,4', label: 'Supersedes' },
  part_of: { color: '#06b6d4', dash: '6,2', label: 'Part Of' },
};

app.get('/ui/edges', (c) => {
  const edgeStylesJson = JSON.stringify(EDGE_STYLES);

  return c.html(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Atlas — Edge Management</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.5;
    }

    .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }

    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; color: #f8fafc; }
    h2 { font-size: 1.125rem; font-weight: 600; margin-bottom: 16px; color: #f1f5f9; }

    /* Edge type legend */
    .legend {
      display: flex; flex-wrap: wrap; gap: 12px;
      margin-bottom: 24px; padding: 16px;
      background: #1e293b; border-radius: 8px;
    }
    .legend-item {
      display: flex; align-items: center; gap: 8px; font-size: 0.875rem;
    }
    .legend-line {
      width: 32px; height: 3px; border-radius: 2px;
    }

    /* Create form */
    .card {
      background: #1e293b; border-radius: 8px;
      padding: 20px; margin-bottom: 24px;
    }

    .form-row {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;
    }

    .field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 180px; }
    .field label { font-size: 0.75rem; font-weight: 500; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }

    select, input[type="number"] {
      background: #0f172a; border: 1px solid #334155; border-radius: 6px;
      color: #e2e8f0; padding: 8px 12px; font-size: 0.875rem;
      width: 100%;
    }
    select:focus, input:focus { outline: none; border-color: #6366f1; }

    .btn {
      padding: 8px 20px; border: none; border-radius: 6px;
      font-size: 0.875rem; font-weight: 500; cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
    .btn-danger { background: #dc2626; color: #fff; padding: 4px 12px; font-size: 0.75rem; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-sm { padding: 4px 12px; font-size: 0.75rem; }

    /* Edge table */
    .edge-table {
      width: 100%; border-collapse: collapse; font-size: 0.875rem;
    }
    .edge-table th {
      text-align: left; padding: 10px 12px;
      font-size: 0.75rem; font-weight: 500; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.05em;
      border-bottom: 1px solid #334155;
    }
    .edge-table td {
      padding: 10px 12px; border-bottom: 1px solid #1e293b;
      vertical-align: middle;
    }
    .edge-table tr:hover td { background: #1e293b; }

    .type-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 500;
      border: 1px solid;
    }
    .type-line {
      display: inline-block; width: 20px; height: 2px;
    }

    .node-label {
      font-size: 0.8125rem; color: #cbd5e1;
      max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .node-id { font-size: 0.6875rem; color: #64748b; font-family: monospace; }

    .actions { display: flex; gap: 6px; }

    .empty-state {
      text-align: center; padding: 48px 16px; color: #64748b;
    }

    /* Edit modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.6); z-index: 100;
      align-items: center; justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #1e293b; border-radius: 12px; padding: 24px;
      width: 100%; max-width: 420px;
    }
    .modal h2 { margin-bottom: 16px; }
    .modal .field { margin-bottom: 12px; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
    .btn-secondary { background: #334155; color: #e2e8f0; }
    .btn-secondary:hover { background: #475569; }

    .toast {
      position: fixed; bottom: 20px; right: 20px;
      padding: 12px 20px; border-radius: 8px;
      font-size: 0.875rem; z-index: 200;
      transition: opacity 0.3s;
    }
    .toast-success { background: #166534; color: #bbf7d0; }
    .toast-error { background: #991b1b; color: #fecaca; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Edge Management</h1>

    <!-- Legend -->
    <div class="legend" id="legend"></div>

    <!-- Create edge form -->
    <div class="card">
      <h2>Create Edge</h2>
      <form id="create-form">
        <div class="form-row">
          <div class="field">
            <label for="source">Source Node</label>
            <select id="source" required><option value="">Loading…</option></select>
          </div>
          <div class="field">
            <label for="target">Target Node</label>
            <select id="target" required><option value="">Loading…</option></select>
          </div>
          <div class="field" style="min-width:140px;flex:0.5">
            <label for="edge-type">Type</label>
            <select id="edge-type" required></select>
          </div>
          <div class="field" style="min-width:80px;flex:0.3">
            <label for="weight">Weight</label>
            <input type="number" id="weight" value="1.0" step="0.1" min="0" />
          </div>
          <div style="display:flex;align-items:flex-end">
            <button type="submit" class="btn btn-primary" id="create-btn">Create</button>
          </div>
        </div>
      </form>
    </div>

    <!-- Filter -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <h2 style="margin-bottom:0">Edges</h2>
      <select id="filter-type" style="width:auto">
        <option value="">All types</option>
      </select>
    </div>

    <!-- Edge list -->
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="edge-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Source</th>
            <th>Target</th>
            <th>Weight</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="edge-list"></tbody>
      </table>
      <div class="empty-state" id="empty-state" style="display:none">No edges found.</div>
    </div>
  </div>

  <!-- Edit modal -->
  <div class="modal-overlay" id="edit-modal">
    <div class="modal">
      <h2>Edit Edge</h2>
      <input type="hidden" id="edit-id" />
      <div class="field">
        <label for="edit-type">Type</label>
        <select id="edit-type"></select>
      </div>
      <div class="field">
        <label for="edit-weight">Weight</label>
        <input type="number" id="edit-weight" step="0.1" min="0" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="edit-cancel">Cancel</button>
        <button class="btn btn-primary" id="edit-save">Save</button>
      </div>
    </div>
  </div>

  <script>
    const STYLES = ${edgeStylesJson};
    const nodeCache = {};

    // Build legend
    const legend = document.getElementById('legend');
    for (const [type, s] of Object.entries(STYLES)) {
      const svg = type === 'supports' || type === 'part_of' || type === 'supersedes'
        ? '<svg width="32" height="6"><line x1="0" y1="3" x2="32" y2="3" stroke="' + s.color + '" stroke-width="3" /></svg>'
        : '<svg width="32" height="6"><line x1="0" y1="3" x2="32" y2="3" stroke="' + s.color + '" stroke-width="3" stroke-dasharray="' + s.dash + '" /></svg>';
      legend.insertAdjacentHTML('beforeend',
        '<div class="legend-item">' + svg + '<span>' + s.label + '</span></div>');
    }

    // Populate type selects
    function populateTypeSelect(el) {
      el.innerHTML = '';
      for (const [type, s] of Object.entries(STYLES)) {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = s.label;
        el.appendChild(opt);
      }
    }
    populateTypeSelect(document.getElementById('edge-type'));
    populateTypeSelect(document.getElementById('edit-type'));

    // Filter type dropdown
    const filterType = document.getElementById('filter-type');
    for (const [type, s] of Object.entries(STYLES)) {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = s.label;
      filterType.appendChild(opt);
    }
    filterType.addEventListener('change', loadEdges);

    // Load nodes into selects
    async function loadNodes() {
      try {
        const res = await fetch('/nodes?limit=500');
        const nodes = await res.json();
        const sourceEl = document.getElementById('source');
        const targetEl = document.getElementById('target');
        sourceEl.innerHTML = '<option value="">Select source…</option>';
        targetEl.innerHTML = '<option value="">Select target…</option>';
        for (const n of nodes) {
          nodeCache[n.id] = n;
          const opt = (el) => {
            const o = document.createElement('option');
            o.value = n.id;
            o.textContent = n.title + ' (' + n.type + ')';
            el.appendChild(o);
          };
          opt(sourceEl);
          opt(targetEl);
        }
      } catch (e) {
        showToast('Failed to load nodes', true);
      }
    }

    function nodeName(id) {
      const n = nodeCache[id];
      return n ? n.title : id.slice(0, 8) + '…';
    }

    function typeBadge(type) {
      const s = STYLES[type] || { color: '#94a3b8', dash: 'none', label: type };
      const dashStyle = s.dash === 'none'
        ? 'background:' + s.color
        : 'background:repeating-linear-gradient(90deg,' + s.color + ' 0,' + s.color + ' 4px,transparent 4px,transparent 8px)';
      return '<span class="type-badge" style="border-color:' + s.color + ';color:' + s.color + '">'
        + '<span class="type-line" style="' + dashStyle + '"></span>'
        + s.label + '</span>';
    }

    function formatDate(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Load edges
    async function loadEdges() {
      try {
        const typeParam = filterType.value ? '?type=' + filterType.value : '';
        const res = await fetch('/edges' + typeParam);
        const edges = await res.json();
        const tbody = document.getElementById('edge-list');
        const empty = document.getElementById('empty-state');

        if (edges.length === 0) {
          tbody.innerHTML = '';
          empty.style.display = 'block';
          return;
        }

        empty.style.display = 'none';
        tbody.innerHTML = edges.map(e =>
          '<tr data-id="' + e.id + '">'
          + '<td>' + typeBadge(e.type) + '</td>'
          + '<td><div class="node-label">' + esc(nodeName(e.source_id)) + '</div><div class="node-id">' + e.source_id + '</div></td>'
          + '<td><div class="node-label">' + esc(nodeName(e.target_id)) + '</div><div class="node-id">' + e.target_id + '</div></td>'
          + '<td>' + e.weight + '</td>'
          + '<td>' + formatDate(e.created_at) + '</td>'
          + '<td class="actions">'
            + '<button class="btn btn-secondary btn-sm" onclick="openEdit(\'' + e.id + '\',\'' + e.type + '\',' + e.weight + ')">Edit</button>'
            + '<button class="btn btn-danger btn-sm" onclick="confirmDelete(\'' + e.id + '\')">Delete</button>'
          + '</td>'
          + '</tr>'
        ).join('');
      } catch (e) {
        showToast('Failed to load edges', true);
      }
    }

    function esc(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // Create edge
    document.getElementById('create-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = document.getElementById('create-btn');
      btn.disabled = true;
      try {
        const body = {
          source_id: document.getElementById('source').value,
          target_id: document.getElementById('target').value,
          type: document.getElementById('edge-type').value,
          weight: parseFloat(document.getElementById('weight').value) || 1.0,
        };
        const res = await fetch('/edges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Create failed');
        }
        showToast('Edge created');
        loadEdges();
      } catch (e) {
        showToast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    // Edit modal
    function openEdit(id, type, weight) {
      document.getElementById('edit-id').value = id;
      document.getElementById('edit-type').value = type;
      document.getElementById('edit-weight').value = weight;
      document.getElementById('edit-modal').classList.add('active');
    }

    document.getElementById('edit-cancel').addEventListener('click', () => {
      document.getElementById('edit-modal').classList.remove('active');
    });

    document.getElementById('edit-save').addEventListener('click', async () => {
      const id = document.getElementById('edit-id').value;
      try {
        const res = await fetch('/edges/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: document.getElementById('edit-type').value,
            weight: parseFloat(document.getElementById('edit-weight').value) || 1.0,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Update failed');
        }
        document.getElementById('edit-modal').classList.remove('active');
        showToast('Edge updated');
        loadEdges();
      } catch (e) {
        showToast(e.message, true);
      }
    });

    // Delete
    async function confirmDelete(id) {
      if (!confirm('Delete this edge?')) return;
      try {
        const res = await fetch('/edges/' + id, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Delete failed');
        }
        showToast('Edge deleted');
        loadEdges();
      } catch (e) {
        showToast(e.message, true);
      }
    }

    // Toast
    function showToast(msg, isError) {
      const el = document.createElement('div');
      el.className = 'toast ' + (isError ? 'toast-error' : 'toast-success');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; }, 2500);
      setTimeout(() => el.remove(), 3000);
    }

    // Init
    loadNodes().then(loadEdges);
  </script>
</body>
</html>`);
});

export default app;
