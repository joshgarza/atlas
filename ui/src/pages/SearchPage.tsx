import { useState } from 'react';
import { searchNodes } from '../api/client';
import type { Node } from '../api/types';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Node[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const nodes = await searchNodes(query.trim());
      setResults(nodes);
      setSearched(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Search</h1>
      <form onSubmit={handleSearch} style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes..."
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            color: 'var(--color-text)',
            fontSize: '0.9rem',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      {error && <p style={{ color: '#f87171' }}>Error: {error}</p>}
      {searched && results.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>No results found.</p>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: 'none' }}>
          {results.map((node) => (
            <li
              key={node.id}
              style={{
                padding: '0.75rem',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div style={{ fontWeight: 500 }}>{node.title}</div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {node.type} &middot; {node.status} &middot; activation {node.activation.toFixed(2)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
