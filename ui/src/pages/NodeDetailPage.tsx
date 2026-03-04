import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getNode, getNodeHistory, getNodeEdges, ApiError } from '../api/client';
import type { Node, NodeHistory, Edge } from '../api/types';

interface EdgeWithNode extends Edge {
  otherNode: { id: string; title: string } | null;
}

export default function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<Node | null>(null);
  const [history, setHistory] = useState<NodeHistory[]>([]);
  const [edges, setEdges] = useState<EdgeWithNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);
    setNotFound(false);

    Promise.all([getNode(id), getNodeHistory(id), getNodeEdges(id)])
      .then(async ([nodeData, historyData, edgesData]) => {
        setNode(nodeData);
        setHistory(historyData);

        const edgesWithNodes: EdgeWithNode[] = await Promise.all(
          edgesData.map(async (edge) => {
            const otherId = edge.source_id === id ? edge.target_id : edge.source_id;
            try {
              const otherNode = await getNode(otherId, true);
              return { ...edge, otherNode: { id: otherNode.id, title: otherNode.title } };
            } catch {
              return { ...edge, otherNode: null };
            }
          }),
        );
        setEdges(edgesWithNodes);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError((err as Error).message);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Loading node...</p>;
  if (notFound) return <p style={{ color: '#f87171' }}>Node not found.</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;
  if (!node) return null;

  return (
    <div>
      <Link to="/" style={{ fontSize: '0.85rem', marginBottom: '1rem', display: 'inline-block' }}>
        &larr; Back to nodes
      </Link>

      <h1 style={{ marginBottom: '0.5rem' }}>{node.title}</h1>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        <span>Type: {node.type}</span>
        <span>Status: {node.status}</span>
        <span>Granularity: {node.granularity}</span>
        <span>Activation: <span style={{ fontFamily: 'monospace' }}>{node.activation.toFixed(2)}</span></span>
        <span>Accessed: {node.access_count} times</span>
      </div>

      {node.tags && node.tags.length > 0 && (
        <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {node.tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: '0.15rem 0.5rem',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                fontSize: '0.8rem',
                color: 'var(--color-text-muted)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Content</h2>
        <div
          style={{
            padding: '1rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            whiteSpace: 'pre-wrap',
            fontSize: '0.9rem',
            lineHeight: 1.6,
          }}
        >
          {node.content || <span style={{ color: 'var(--color-text-muted)' }}>No content.</span>}
        </div>
      </section>

      <section style={{ marginBottom: '2rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        <div>Created: {new Date(node.created_at).toLocaleString()}</div>
        <div>Updated: {new Date(node.updated_at).toLocaleString()}</div>
        <div>Last accessed: {node.last_accessed_at ? new Date(node.last_accessed_at).toLocaleString() : 'Never'}</div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Connected Edges ({edges.length})</h2>
        {edges.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No connected edges.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>Node</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Type</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <tr key={edge.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    {edge.otherNode ? (
                      <Link to={`/nodes/${edge.otherNode.id}`}>{edge.otherNode.title}</Link>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Unknown node</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)' }}>
                    {edge.type}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>
                    {edge.weight.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Version History ({history.length})</h2>
        {history.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No version history.</p>
        ) : (
          <ul style={{ listStyle: 'none' }}>
            {history.map((entry) => (
              <li
                key={entry.id}
                style={{
                  padding: '0.75rem',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 500 }}>v{entry.version}</span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: '0.9rem' }}>{entry.title}</div>
                {entry.content && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.85rem',
                    }}
                  >
                    {entry.content}
                  </div>
                )}
                {(entry.change_reason || entry.changed_by) && (
                  <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {entry.change_reason && <span>Reason: {entry.change_reason}</span>}
                    {entry.change_reason && entry.changed_by && <span> &middot; </span>}
                    {entry.changed_by && <span>By: {entry.changed_by}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
