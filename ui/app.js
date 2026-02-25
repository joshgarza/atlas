const API = '/api';
const LIMIT = 25;

let currentOffset = 0;
let currentType = '';
let currentQuery = '';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- API helpers ---

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// --- Node list ---

async function loadNodes(append = false) {
  if (!append) {
    currentOffset = 0;
    $('#nodes').innerHTML = '';
  }

  try {
    let data;
    if (currentQuery) {
      data = await api(`/search?q=${encodeURIComponent(currentQuery)}`);
    } else {
      const params = new URLSearchParams({ limit: LIMIT, offset: currentOffset });
      if (currentType) params.set('type', currentType);
      data = await api(`/nodes?${params}`);
    }

    const nodes = Array.isArray(data) ? data : data.nodes || [];
    if (nodes.length === 0 && !append) {
      $('#nodes').innerHTML = '<li class="empty-state">No nodes found</li>';
      $('#load-more').hidden = true;
      return;
    }

    for (const node of nodes) {
      $('#nodes').appendChild(renderNodeItem(node));
    }

    currentOffset += nodes.length;
    $('#load-more').hidden = currentQuery !== '' || nodes.length < LIMIT;
    updateStatus(`${currentOffset} nodes loaded`);
  } catch (err) {
    updateStatus(`Error: ${err.message}`);
  }
}

function renderNodeItem(node) {
  const li = document.createElement('li');
  li.className = 'node-item';
  li.onclick = () => showNode(node.id);

  const activationPct = Math.min(100, Math.round((node.activation || 0) * 100));

  li.innerHTML = `
    <div class="node-title">${esc(node.title)}</div>
    <div class="node-meta">
      <span class="node-type">${esc(node.type || 'unknown')}</span>
      <span>
        <span class="activation-bar"><span class="activation-fill" style="width:${activationPct}%"></span></span>
        ${(node.activation || 0).toFixed(2)}
      </span>
      <span>${timeAgo(node.updated_at || node.created_at)}</span>
    </div>
  `;
  return li;
}

// --- Node detail ---

async function showNode(id) {
  try {
    const [node, edgesData, historyData] = await Promise.all([
      api(`/nodes/${id}`),
      api(`/nodes/${id}/edges`).catch(() => []),
      api(`/nodes/${id}/history`).catch(() => []),
    ]);

    const edges = Array.isArray(edgesData) ? edgesData : edgesData.edges || [];
    const history = Array.isArray(historyData) ? historyData : historyData.history || [];

    $('#detail-content').innerHTML = `
      <h2>${esc(node.title)}</h2>
      <div class="detail-meta">
        <span class="node-type">${esc(node.type || 'unknown')}</span>
        <span>Activation: ${(node.activation || 0).toFixed(2)}</span>
        <span>Status: ${esc(node.status || 'active')}</span>
        <span>Created: ${formatDate(node.created_at)}</span>
      </div>
      ${node.content ? `<div class="detail-body">${esc(node.content)}</div>` : ''}
    `;

    const edgesList = $('#edges-list');
    edgesList.innerHTML = '';
    if (edges.length === 0) {
      edgesList.innerHTML = '<li class="empty-state">No connections</li>';
    } else {
      for (const edge of edges) {
        const otherId = edge.source_id === id ? edge.target_id : edge.source_id;
        const li = document.createElement('li');
        li.className = 'edge-item';
        li.onclick = () => showNode(otherId);
        li.innerHTML = `
          <span>${esc(edge.source_title || edge.source_id)} &rarr; ${esc(edge.target_title || edge.target_id)}</span>
          <span class="edge-type">${esc(edge.relation_type || '')}</span>
        `;
        edgesList.appendChild(li);
      }
    }

    const historyList = $('#history-list');
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<li class="empty-state">No history</li>';
    } else {
      for (const entry of history) {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
          <span class="history-date">${formatDate(entry.changed_at || entry.created_at)}</span>
          <span>${esc(entry.title || '')}</span>
        `;
        historyList.appendChild(li);
      }
    }

    $('#node-list').hidden = true;
    $('#node-detail').hidden = false;
  } catch (err) {
    updateStatus(`Error loading node: ${err.message}`);
  }
}

function goBack() {
  $('#node-detail').hidden = true;
  $('#node-list').hidden = false;
}

// --- Utilities ---

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function updateStatus(msg) {
  $('#status').textContent = msg;
}

// --- Event listeners ---

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  currentQuery = $('#search-input').value.trim();
  loadNodes();
});

$('#search-input').addEventListener('input', (e) => {
  if (!e.target.value.trim()) {
    currentQuery = '';
    loadNodes();
  }
});

$('#type-filter').addEventListener('change', (e) => {
  currentType = e.target.value;
  currentQuery = '';
  $('#search-input').value = '';
  loadNodes();
});

$('#load-more').addEventListener('click', () => loadNodes(true));
$('#back-btn').addEventListener('click', goBack);

// --- Init ---

loadNodes();
