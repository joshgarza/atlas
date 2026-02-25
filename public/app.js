/* Atlas — Knowledge Graph UI */

const NODE_COLORS = {
  concept: '#58a6ff',
  entity: '#3fb950',
  preference: '#d29922',
  goal: '#f85149',
  habit: '#bc8cff',
  observation: '#79c0ff',
};

// ── State ────────────────────────────────────────────

let allNodes = [];
let allEdges = [];
let nodeMap = {};          // id → node
let simulation = null;
let selectedNodeId = null;
let highlightedIds = new Set();
let searchTimeout = null;

// ── DOM refs ─────────────────────────────────────────

const svg = d3.select('#graph');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const detailClose = document.getElementById('detail-close');

// ── Bootstrap ────────────────────────────────────────

async function init() {
  const [nodesRes, edgesRes] = await Promise.all([
    fetch('/nodes?limit=2000').then(r => r.json()),
    fetch('/edges').then(r => r.json()),
  ]);

  allNodes = nodesRes;
  allEdges = edgesRes;
  nodeMap = {};
  allNodes.forEach(n => { nodeMap[n.id] = n; });

  if (allNodes.length === 0) {
    document.body.insertAdjacentHTML('beforeend',
      '<div class="empty-state">No nodes yet<p>Create nodes via the API to see the graph.</p></div>'
    );
    return;
  }

  buildGraph();
}

// ── Graph ────────────────────────────────────────────

function buildGraph() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  svg.attr('width', width).attr('height', height);

  // Clear previous
  svg.selectAll('*').remove();

  const g = svg.append('g');

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);

  // Build D3 data — clone so D3 can mutate
  const nodes = allNodes.map(n => ({
    ...n,
    radius: nodeRadius(n),
  }));
  const nodeIndex = {};
  nodes.forEach((n, i) => { nodeIndex[n.id] = i; });

  const links = allEdges
    .filter(e => nodeIndex[e.source_id] !== undefined && nodeIndex[e.target_id] !== undefined)
    .map(e => ({
      source: e.source_id,
      target: e.target_id,
      type: e.type,
      id: e.id,
    }));

  // Links
  const linkSel = g.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'edge-line');

  // Nodes
  const nodeSel = g.append('g')
    .selectAll('circle')
    .data(nodes, d => d.id)
    .join('circle')
    .attr('class', 'node-circle')
    .attr('r', d => d.radius)
    .attr('fill', d => NODE_COLORS[d.type] || '#8b949e')
    .on('click', (e, d) => {
      e.stopPropagation();
      selectNode(d.id);
    })
    .call(drag());

  // Labels
  const labelSel = g.append('g')
    .selectAll('text')
    .data(nodes, d => d.id)
    .join('text')
    .attr('class', 'node-label')
    .text(d => truncate(d.title, 24))
    .attr('dy', d => d.radius + 14);

  // Simulation
  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.radius + 4))
    .on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
      nodeSel
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
      labelSel
        .attr('x', d => d.x)
        .attr('y', d => d.y);
    });

  // Store selections for later updates
  svg._nodeSel = nodeSel;
  svg._linkSel = linkSel;
  svg._labelSel = labelSel;

  // Click background to deselect
  svg.on('click', () => {
    clearSelection();
    closeDetail();
  });
}

function nodeRadius(n) {
  return Math.max(6, Math.min(20, 4 + Math.sqrt(n.activation) * 4));
}

function drag() {
  return d3.drag()
    .on('start', (e, d) => {
      if (!e.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (e, d) => {
      d.fx = e.x;
      d.fy = e.y;
    })
    .on('end', (e, d) => {
      if (!e.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

// ── Selection & Highlighting ─────────────────────────

function applyVisualState() {
  const nodeSel = svg._nodeSel;
  const linkSel = svg._linkSel;
  const labelSel = svg._labelSel;
  if (!nodeSel) return;

  const hasHighlight = highlightedIds.size > 0;
  const hasSelection = selectedNodeId != null;

  // Get IDs connected to selected node
  const connectedIds = new Set();
  if (hasSelection) {
    connectedIds.add(selectedNodeId);
    allEdges.forEach(e => {
      if (e.source_id === selectedNodeId) connectedIds.add(e.target_id);
      if (e.target_id === selectedNodeId) connectedIds.add(e.source_id);
    });
  }

  nodeSel
    .classed('highlighted', d => highlightedIds.has(d.id))
    .classed('selected', d => d.id === selectedNodeId)
    .classed('dimmed', d => {
      if (hasHighlight && !highlightedIds.has(d.id) && !hasSelection) return true;
      if (hasSelection && !connectedIds.has(d.id) && !highlightedIds.has(d.id)) return true;
      return false;
    });

  labelSel
    .classed('dimmed', d => {
      if (hasHighlight && !highlightedIds.has(d.id) && !hasSelection) return true;
      if (hasSelection && !connectedIds.has(d.id) && !highlightedIds.has(d.id)) return true;
      return false;
    });

  linkSel
    .classed('highlighted', d => {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      return hasSelection && (sid === selectedNodeId || tid === selectedNodeId);
    })
    .classed('dimmed', d => {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      if (hasSelection && sid !== selectedNodeId && tid !== selectedNodeId) return true;
      return false;
    });
}

function selectNode(id) {
  selectedNodeId = id;
  applyVisualState();
  showDetail(id);
}

function clearSelection() {
  selectedNodeId = null;
  applyVisualState();
}

// ── Detail Panel ─────────────────────────────────────

async function showDetail(id) {
  detailPanel.classList.remove('hidden');

  // Fetch full node data (bumps activation), history, and edges in parallel
  const [node, history, edges] = await Promise.all([
    fetch(`/nodes/${id}`).then(r => r.json()),
    fetch(`/nodes/${id}/history`).then(r => r.json()),
    fetch(`/nodes/${id}/edges`).then(r => r.json()),
  ]);

  if (node.error) {
    detailContent.innerHTML = `<p style="color:#f85149">Node not found</p>`;
    return;
  }

  const tags = node.tags || [];
  const statusClass = `badge-status-${node.status}`;

  let html = `
    <h2 class="detail-title">${esc(node.title)}</h2>
    <div class="detail-badges">
      <span class="badge badge-type">${node.type}</span>
      <span class="badge ${statusClass}">${node.status}</span>
      <span class="badge badge-granularity">${node.granularity}</span>
      ${tags.map(t => `<span class="badge badge-tag">${esc(t)}</span>`).join('')}
    </div>
  `;

  // Content
  if (node.content) {
    html += `
      <div class="detail-section">
        <h3>Content</h3>
        <div class="detail-content-body">${esc(node.content)}</div>
      </div>
    `;
  }

  // Metadata grid
  html += `
    <div class="detail-section">
      <h3>Metadata</h3>
      <dl class="detail-meta-grid">
        <dt>Activation</dt><dd>${node.activation.toFixed(2)}</dd>
        <dt>Version</dt><dd>${node.version}</dd>
        <dt>Access count</dt><dd>${node.access_count}</dd>
        <dt>Created</dt><dd>${fmtDate(node.created_at)}</dd>
        <dt>Updated</dt><dd>${fmtDate(node.updated_at)}</dd>
        <dt>Last accessed</dt><dd>${node.last_accessed_at ? fmtDate(node.last_accessed_at) : '—'}</dd>
        ${node.superseded_by ? `<dt>Superseded by</dt><dd>${node.superseded_by}</dd>` : ''}
      </dl>
    </div>
  `;

  // Edges
  if (edges.length > 0) {
    html += `<div class="detail-section"><h3>Connections (${edges.length})</h3>`;
    for (const edge of edges) {
      const isSource = edge.source_id === id;
      const otherId = isSource ? edge.target_id : edge.source_id;
      const otherNode = nodeMap[otherId];
      const otherTitle = otherNode ? otherNode.title : otherId.slice(0, 8) + '…';
      const arrow = isSource ? '→' : '←';
      html += `
        <div class="edge-item" data-node-id="${otherId}">
          <span class="edge-type">${edge.type}</span>
          <span class="edge-direction">${arrow}</span>
          <span class="edge-node-title">${esc(otherTitle)}</span>
        </div>
      `;
    }
    html += `</div>`;
  }

  // History
  if (history.length > 0) {
    html += `<div class="detail-section"><h3>History (${history.length})</h3>`;
    for (const h of history) {
      html += `
        <div class="history-item">
          <span class="history-version">v${h.version}</span>
          <span class="history-date">${fmtDate(h.created_at)}</span>
          ${h.change_reason ? `<div class="history-reason">${esc(h.change_reason)}</div>` : ''}
        </div>
      `;
    }
    html += `</div>`;
  }

  // Metadata JSON
  if (node.metadata && Object.keys(node.metadata).length > 0) {
    html += `
      <div class="detail-section">
        <h3>Raw Metadata</h3>
        <div class="detail-content-body">${esc(JSON.stringify(node.metadata, null, 2))}</div>
      </div>
    `;
  }

  detailContent.innerHTML = html;

  // Make edge items clickable
  detailContent.querySelectorAll('.edge-item').forEach(el => {
    el.addEventListener('click', () => {
      const nid = el.dataset.nodeId;
      if (nodeMap[nid]) selectNode(nid);
    });
  });
}

function closeDetail() {
  detailPanel.classList.add('hidden');
}

detailClose.addEventListener('click', (e) => {
  e.stopPropagation();
  clearSelection();
  closeDetail();
});

// ── Search ───────────────────────────────────────────

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();

  if (!q) {
    closeSearch();
    highlightedIds.clear();
    applyVisualState();
    return;
  }

  searchTimeout = setTimeout(() => performSearch(q), 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    closeSearch();
    highlightedIds.clear();
    applyVisualState();
    searchInput.blur();
  }
});

// Close search results when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-bar')) {
    closeSearch();
  }
});

async function performSearch(q) {
  try {
    const results = await fetch(`/search?q=${encodeURIComponent(q)}`).then(r => r.json());

    // Update highlighted nodes
    highlightedIds.clear();
    results.forEach(n => highlightedIds.add(n.id));
    applyVisualState();

    // Render results dropdown
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-item"><span class="title" style="color:#8b949e">No results</span></div>';
    } else {
      searchResults.innerHTML = results.map(n => `
        <div class="search-item" data-node-id="${n.id}">
          <span class="type-badge type-${n.type}">${n.type}</span>
          <span class="title">${esc(n.title)}</span>
        </div>
      `).join('');
    }

    searchResults.classList.add('open');

    // Click handler for results
    searchResults.querySelectorAll('.search-item[data-node-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.nodeId;
        selectNode(id);
        closeSearch();
      });
    });
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function closeSearch() {
  searchResults.classList.remove('open');
}

// ── Helpers ──────────────────────────────────────────

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ── Resize ───────────────────────────────────────────

window.addEventListener('resize', () => {
  if (!simulation) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  svg.attr('width', w).attr('height', h);
  simulation.force('center', d3.forceCenter(w / 2, h / 2));
  simulation.alpha(0.3).restart();
});

// ── Keyboard shortcut ────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Focus search on Ctrl/Cmd+K or /
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && document.activeElement !== searchInput)) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  // Escape closes detail panel
  if (e.key === 'Escape' && document.activeElement !== searchInput) {
    clearSelection();
    closeDetail();
    highlightedIds.clear();
    applyVisualState();
  }
});

// ── Start ────────────────────────────────────────────

init();
