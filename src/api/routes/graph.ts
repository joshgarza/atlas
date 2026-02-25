import { Hono } from 'hono';
import { listNodes } from '../../graph/nodes.js';
import { listEdges } from '../../graph/edges.js';

const app = new Hono();

// Graph data endpoint — returns all nodes and edges for visualization
app.get('/graph/data', (c) => {
  try {
    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 500;
    const nodes = listNodes({ limit });
    const edges = listEdges();
    return c.json({ nodes, edges });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Serve the graph visualization page
app.get('/graph', (c) => {
  return c.html(graphHtml);
});

const graphHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas — Knowledge Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      overflow: hidden;
      height: 100vh;
    }

    svg { display: block; width: 100%; height: 100%; }

    .node { cursor: pointer; stroke-width: 1.5; transition: stroke-width 0.15s; }
    .node:hover { stroke-width: 3; }
    .node.selected { stroke: #f8fafc !important; stroke-width: 3; }

    .node-label {
      font-size: 11px;
      fill: #cbd5e1;
      pointer-events: none;
      text-anchor: middle;
    }

    .edge { stroke-opacity: 0.4; }
    .edge-label {
      font-size: 9px;
      fill: #64748b;
      pointer-events: none;
      text-anchor: middle;
    }

    .legend {
      position: fixed;
      top: 16px;
      left: 16px;
      background: rgba(30, 41, 59, 0.95);
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
      font-size: 13px;
      z-index: 10;
    }
    .legend h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 10px;
      color: #f1f5f9;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .legend-section {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid #334155;
    }

    .detail-panel {
      position: fixed;
      top: 0;
      right: -400px;
      width: 400px;
      height: 100vh;
      background: rgba(30, 41, 59, 0.98);
      border-left: 1px solid #334155;
      padding: 24px;
      transition: right 0.3s ease;
      overflow-y: auto;
      z-index: 20;
    }
    .detail-panel.open { right: 0; }

    .detail-close {
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
    }
    .detail-close:hover { color: #f1f5f9; }

    .detail-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #f8fafc;
      padding-right: 32px;
    }
    .detail-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .detail-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .detail-section {
      margin-bottom: 16px;
    }
    .detail-section h4 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .detail-section p {
      font-size: 14px;
      line-height: 1.6;
      color: #cbd5e1;
    }
    .detail-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .detail-tag {
      background: #334155;
      color: #94a3b8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .detail-connection {
      font-size: 13px;
      margin-bottom: 4px;
      color: #cbd5e1;
    }

    .loading {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px;
      color: #64748b;
    }

    .empty {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #64748b;
    }
    .empty h2 { font-size: 24px; margin-bottom: 8px; color: #94a3b8; }
    .empty p { font-size: 14px; }
  </style>
</head>
<body>
  <div id="loading" class="loading">Loading graph\u2026</div>

  <div class="legend" id="legend" style="display: none;"></div>

  <div class="detail-panel" id="detail">
    <button class="detail-close" id="detail-close">&times;</button>
    <div id="detail-content"></div>
  </div>

  <svg id="graph"></svg>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script>
    var NODE_COLORS = {
      concept: '#6366f1',
      entity: '#06b6d4',
      preference: '#f59e0b',
      goal: '#10b981',
      habit: '#8b5cf6',
      observation: '#64748b'
    };

    var NODE_SHAPES = {
      concept: d3.symbolCircle,
      entity: d3.symbolSquare,
      preference: d3.symbolDiamond,
      goal: d3.symbolStar,
      habit: d3.symbolTriangle2,
      observation: d3.symbolWye
    };

    var EDGE_COLORS = {
      supports: '#22c55e',
      contradicts: '#ef4444',
      derived_from: '#3b82f6',
      related_to: '#64748b',
      supersedes: '#f97316',
      part_of: '#a855f7'
    };

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function makeDrag(simulation) {
      return d3.drag()
        .on('start', function(event, d) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', function(event, d) {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', function(event, d) {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });
    }

    function selectNode(node, allEdges) {
      d3.selectAll('.node').classed('selected', function(d) { return d.id === node.id; });

      var connected = allEdges.filter(function(e) {
        return e.source.id === node.id || e.target.id === node.id;
      });

      var panel = document.getElementById('detail');
      var content = document.getElementById('detail-content');
      var color = NODE_COLORS[node.type] || '#64748b';

      var html = '<div class="detail-title">' + escapeHtml(node.title) + '</div>';
      html += '<div class="detail-meta">';
      html += '<span class="detail-badge" style="background:' + color + '33;color:' + color + ';">' + node.type + '</span>';
      html += '<span class="detail-badge" style="background:#334155;color:#94a3b8;">' + node.status + '</span>';
      html += '<span class="detail-badge" style="background:#334155;color:#94a3b8;">' + node.granularity + '</span>';
      html += '</div>';

      html += '<div class="detail-section"><h4>Activation</h4>';
      html += '<p>' + node.activation.toFixed(3) + ' (accessed ' + node.access_count + ' times)</p></div>';

      if (node.tags && node.tags.length) {
        html += '<div class="detail-section"><h4>Tags</h4><div class="detail-tags">';
        node.tags.forEach(function(t) {
          html += '<span class="detail-tag">' + escapeHtml(t) + '</span>';
        });
        html += '</div></div>';
      }

      html += '<div class="detail-section"><h4>Content</h4>';
      var contentText = node.content.length > 500 ? node.content.substring(0, 497) + '...' : node.content;
      html += '<p>' + escapeHtml(contentText) + '</p></div>';

      if (connected.length) {
        html += '<div class="detail-section"><h4>Connections (' + connected.length + ')</h4>';
        connected.forEach(function(e) {
          var other = e.source.id === node.id ? e.target : e.source;
          var dir = e.source.id === node.id ? '\\u2192' : '\\u2190';
          var edgeColor = EDGE_COLORS[e.type] || '#64748b';
          html += '<div class="detail-connection">' + dir + ' <strong style="color:' + edgeColor + ';">' + e.type.replace(/_/g, ' ') + '</strong> ' + escapeHtml(other.title || other.id) + '</div>';
        });
        html += '</div>';
      }

      html += '<div class="detail-section"><h4>Metadata</h4>';
      html += '<p style="font-size:12px;color:#64748b;">Version ' + node.version;
      html += ' \\u00b7 Created ' + new Date(node.created_at).toLocaleDateString();
      if (node.last_accessed_at) {
        html += ' \\u00b7 Last accessed ' + new Date(node.last_accessed_at).toLocaleDateString();
      }
      html += '</p></div>';

      content.innerHTML = html;
      panel.classList.add('open');
    }

    function deselectNode() {
      d3.selectAll('.node').classed('selected', false);
      document.getElementById('detail').classList.remove('open');
    }

    function buildLegend(nodes, edges) {
      var nodeTypes = [];
      var seen = {};
      nodes.forEach(function(n) {
        if (!seen[n.type]) { seen[n.type] = true; nodeTypes.push(n.type); }
      });

      var edgeTypes = [];
      var seenEdge = {};
      edges.forEach(function(e) {
        if (!seenEdge[e.type]) { seenEdge[e.type] = true; edgeTypes.push(e.type); }
      });

      if (!nodeTypes.length) return;

      var legend = document.getElementById('legend');
      legend.style.display = 'block';

      var html = '<h3>Node Types</h3>';
      nodeTypes.forEach(function(type) {
        var color = NODE_COLORS[type] || '#64748b';
        var shape = NODE_SHAPES[type] || d3.symbolCircle;
        var path = d3.symbol().type(shape).size(80)();
        html += '<div class="legend-item">';
        html += '<svg width="14" height="14"><path d="' + path + '" transform="translate(7,7)" fill="' + color + '"/></svg>';
        html += '<span>' + type + '</span></div>';
      });

      if (edgeTypes.length) {
        html += '<div class="legend-section"><h3>Edge Types</h3>';
        edgeTypes.forEach(function(type) {
          var color = EDGE_COLORS[type] || '#64748b';
          html += '<div class="legend-item">';
          html += '<svg width="14" height="3"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke="' + color + '" stroke-width="2"/></svg>';
          html += '<span>' + type.replace(/_/g, ' ') + '</span></div>';
        });
        html += '</div>';
      }

      legend.innerHTML = html;
    }

    function render(nodes, edges) {
      var width = window.innerWidth;
      var height = window.innerHeight;

      var svg = d3.select('#graph')
        .attr('width', width)
        .attr('height', height);

      var g = svg.append('g');

      svg.call(d3.zoom()
        .scaleExtent([0.1, 8])
        .on('zoom', function(event) {
          g.attr('transform', event.transform);
        })
      );

      var activationExtent = d3.extent(nodes, function(d) { return d.activation; });
      var minAct = activationExtent[0] || 0.01;
      var maxAct = activationExtent[1] || 1;
      if (maxAct <= minAct) maxAct = minAct + 0.1;

      var sizeScale = d3.scaleSqrt()
        .domain([minAct, maxAct])
        .range([60, 500]);

      var simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(function(d) { return d.id; }).distance(180))
        .force('charge', d3.forceManyBody().strength(-400))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide().radius(function(d) {
          return Math.sqrt(sizeScale(d.activation)) + 10;
        }));

      var linkGroup = g.append('g').attr('class', 'edges');

      var link = linkGroup.selectAll('line')
        .data(edges)
        .join('line')
        .attr('class', 'edge')
        .attr('stroke', function(d) { return EDGE_COLORS[d.type] || '#64748b'; })
        .attr('stroke-width', function(d) { return Math.max(1, d.weight * 1.5); });

      var linkLabel = linkGroup.selectAll('text')
        .data(edges)
        .join('text')
        .attr('class', 'edge-label')
        .text(function(d) { return d.type.replace(/_/g, ' '); });

      var nodeGroup = g.append('g').attr('class', 'nodes');

      var nodeElements = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'node-group')
        .call(makeDrag(simulation));

      nodeElements.append('path')
        .attr('class', 'node')
        .attr('d', function(d) {
          var shape = NODE_SHAPES[d.type] || d3.symbolCircle;
          return d3.symbol().type(shape).size(sizeScale(d.activation))();
        })
        .attr('fill', function(d) { return NODE_COLORS[d.type] || '#64748b'; })
        .attr('stroke', function(d) {
          return d3.color(NODE_COLORS[d.type] || '#64748b').brighter(0.5);
        })
        .on('click', function(event, d) {
          event.stopPropagation();
          selectNode(d, edges);
        });

      nodeElements.append('text')
        .attr('class', 'node-label')
        .attr('dy', function(d) {
          return Math.sqrt(sizeScale(d.activation)) / 2 + 14;
        })
        .text(function(d) {
          return d.title.length > 30 ? d.title.substring(0, 27) + '...' : d.title;
        });

      svg.on('click', deselectNode);

      simulation.on('tick', function() {
        link
          .attr('x1', function(d) { return d.source.x; })
          .attr('y1', function(d) { return d.source.y; })
          .attr('x2', function(d) { return d.target.x; })
          .attr('y2', function(d) { return d.target.y; });

        linkLabel
          .attr('x', function(d) { return (d.source.x + d.target.x) / 2; })
          .attr('y', function(d) { return (d.source.y + d.target.y) / 2 - 4; });

        nodeElements.attr('transform', function(d) {
          return 'translate(' + d.x + ',' + d.y + ')';
        });
      });

      window.addEventListener('resize', function() {
        var w = window.innerWidth;
        var h = window.innerHeight;
        svg.attr('width', w).attr('height', h);
        simulation.force('center', d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.1).restart();
      });
    }

    async function init() {
      var res = await fetch('/graph/data');
      var data = await res.json();

      document.getElementById('loading').style.display = 'none';

      if (!data.nodes.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = '<h2>No nodes yet</h2><p>Create some nodes via the API to see the graph.</p>';
        document.body.appendChild(empty);
        return;
      }

      var nodeIds = new Set(data.nodes.map(function(n) { return n.id; }));
      var edges = data.edges
        .filter(function(e) { return nodeIds.has(e.source_id) && nodeIds.has(e.target_id); })
        .map(function(e) { return Object.assign({}, e, { source: e.source_id, target: e.target_id }); });

      render(data.nodes, edges);
      buildLegend(data.nodes, data.edges);
    }

    document.getElementById('detail-close').addEventListener('click', deselectNode);

    init().catch(function(err) {
      document.getElementById('loading').textContent = 'Error loading graph: ' + err.message;
    });
  </script>
</body>
</html>`;

export default app;
