import { useEffect, useState } from 'react';
import { getArchivistStatus, runArchivist } from '../api/client';
import type { ArchivistStatus } from '../api/types';

export default function ArchivistPage() {
  const [status, setStatus] = useState<ArchivistStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchStatus() {
    setLoading(true);
    getArchivistStatus()
      .then(setStatus)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      await runArchivist();
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <p>Loading archivist status...</p>;
  if (error && !status) return <p style={{ color: '#f87171' }}>Error: {error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Archivist</h1>
      <button
        onClick={handleRun}
        disabled={running}
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.9rem',
          marginBottom: '1.5rem',
        }}
      >
        {running ? 'Running...' : 'Run Archivist'}
      </button>
      {error && <p style={{ color: '#f87171', marginBottom: '1rem' }}>Error: {error}</p>}
      {status && (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: '0.5rem 1.5rem',
          }}
        >
          <dt style={{ color: 'var(--color-text-muted)' }}>Last run</dt>
          <dd>{status.lastRun ?? 'Never'}</dd>

          <dt style={{ color: 'var(--color-text-muted)' }}>Events processed</dt>
          <dd>{status.eventsProcessed}</dd>

          <dt style={{ color: 'var(--color-text-muted)' }}>Nodes created</dt>
          <dd>{status.nodesCreated}</dd>

          <dt style={{ color: 'var(--color-text-muted)' }}>Nodes updated</dt>
          <dd>{status.nodesUpdated}</dd>

          <dt style={{ color: 'var(--color-text-muted)' }}>Unprocessed events</dt>
          <dd>{status.unprocessedEvents}</dd>

          <dt style={{ color: 'var(--color-text-muted)' }}>Scheduler</dt>
          <dd>{status.schedule.running ? 'Running' : 'Stopped'}</dd>
        </dl>
      )}
    </div>
  );
}
