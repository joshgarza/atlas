import { useEffect, useState } from 'react';
import { listNodes } from '../api/client';
import type { Node } from '../api/types';

const PAGE_SIZE = 50;

export default function NodesPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const offset = (page - 1) * PAGE_SIZE;
    listNodes({ limit: PAGE_SIZE, offset })
      .then((res) => {
        setNodes(res.nodes);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading) return <p>Loading nodes...</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Nodes</h1>
      {nodes.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No nodes yet.</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>Title</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Type</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Status</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Activation</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{node.title}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)' }}>
                    {node.type}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)' }}>
                    {node.status}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>
                    {node.activation.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              marginTop: '1rem',
              padding: '0.5rem 0',
            }}
          >
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              style={{
                padding: '0.4rem 0.75rem',
                background: page <= 1 ? 'var(--color-bg-secondary, #1e1e1e)' : 'var(--color-bg-tertiary, #2a2a2a)',
                color: page <= 1 ? 'var(--color-text-muted)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Prev
            </button>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              style={{
                padding: '0.4rem 0.75rem',
                background: page >= totalPages ? 'var(--color-bg-secondary, #1e1e1e)' : 'var(--color-bg-tertiary, #2a2a2a)',
                color: page >= totalPages ? 'var(--color-text-muted)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
