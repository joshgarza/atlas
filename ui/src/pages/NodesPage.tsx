import { useEffect, useState } from 'react';
import { listNodes } from '../api/client';
import type { Node } from '../api/types';

export default function NodesPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listNodes({ limit: 50 })
      .then(setNodes)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading nodes...</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Nodes</h1>
      {nodes.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No nodes yet.</p>
      ) : (
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
      )}
    </div>
  );
}
