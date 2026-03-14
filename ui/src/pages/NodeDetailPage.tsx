import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getNode, getNodeHistory, getNodeEdges, updateNode, ApiError } from '../api/client';
import { NODE_STATUSES, NODE_TYPES } from '../api/types';
import type { Node, NodeHistory, Edge, NodeStatus, NodeType } from '../api/types';

interface EdgeWithNode extends Edge {
  otherNode: { id: string; title: string } | null;
}

interface EditFormState {
  title: string;
  content: string;
  type: NodeType;
  status: NodeStatus;
}

function getInitialEditForm(node: Node): EditFormState {
  return {
    title: node.title,
    content: node.content,
    type: node.type,
    status: node.status,
  };
}

export default function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<Node | null>(null);
  const [history, setHistory] = useState<NodeHistory[]>([]);
  const [edges, setEdges] = useState<EdgeWithNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSaveError(null);
    setIsEditing(false);
    setEditForm(null);
    setNotFound(false);

    Promise.all([getNode(id), getNodeHistory(id), getNodeEdges(id)])
      .then(async ([nodeData, historyData, edgesData]) => {
        setNode(nodeData);
        setHistory(historyData);

        const otherIds = [...new Set(edgesData.map((edge) =>
          edge.source_id === id ? edge.target_id : edge.source_id
        ))];
        const results = await Promise.allSettled(otherIds.map((nid) => getNode(nid, true)));
        const nodeMap = new Map<string, { id: string; title: string }>();
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            nodeMap.set(otherIds[i], { id: result.value.id, title: result.value.title });
          }
        });
        const edgesWithNodes: EdgeWithNode[] = edgesData.map((edge) => {
          const otherId = edge.source_id === id ? edge.target_id : edge.source_id;
          return { ...edge, otherNode: nodeMap.get(otherId) ?? null };
        });
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

  function startEditing() {
    if (!node) return;
    setEditForm(getInitialEditForm(node));
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setSaveError(null);
    setEditForm(node ? getInitialEditForm(node) : null);
    setIsEditing(false);
  }

  function updateEditForm<K extends keyof EditFormState>(field: K, value: EditFormState[K]) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !editForm) return;

    setSaving(true);
    setSaveError(null);

    try {
      const updatedNode = await updateNode(id, {
        title: editForm.title,
        content: editForm.content,
        type: editForm.type,
        status: editForm.status,
      });
      setNode(updatedNode);
      setIsEditing(false);
      setEditForm(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        setIsEditing(false);
      } else {
        setSaveError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading node...</p>;
  if (notFound) return <p style={{ color: '#f87171' }}>Node not found.</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;
  if (!node) return null;

  return (
    <div>
      <Link to="/" style={{ fontSize: '0.85rem', marginBottom: '1rem', display: 'inline-block' }}>
        &larr; Back to nodes
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>{node.title}</h1>
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              fontSize: '0.85rem',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>Type: {node.type}</span>
            <span>Status: {node.status}</span>
            <span>Granularity: {node.granularity}</span>
            <span>
              Activation: <span style={{ fontFamily: 'monospace' }}>{node.activation.toFixed(2)}</span>
            </span>
            <span>Accessed: {node.access_count} times</span>
          </div>
        </div>
        {!isEditing && (
          <button
            type="button"
            onClick={startEditing}
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
            Edit
          </button>
        )}
      </div>

      {isEditing && editForm ? (
        <section
          style={{
            marginBottom: '2rem',
            padding: '1rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
          }}
        >
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Edit Node</h2>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.9rem' }}>
                <span>Title</span>
                <input
                  id="node-title"
                  type="text"
                  value={editForm.title}
                  onChange={(event) => updateEditForm('title', event.target.value)}
                  disabled={saving}
                  style={{
                    padding: '0.65rem 0.75rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.9rem' }}>
                <span>Content</span>
                <textarea
                  id="node-content"
                  value={editForm.content}
                  onChange={(event) => updateEditForm('content', event.target.value)}
                  disabled={saving}
                  rows={8}
                  style={{
                    padding: '0.65rem 0.75rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    resize: 'vertical',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.9rem' }}>
                  <span>Type</span>
                  <select
                    id="node-type"
                    value={editForm.type}
                    onChange={(event) => updateEditForm('type', event.target.value as NodeType)}
                    disabled={saving}
                    style={{
                      padding: '0.65rem 0.75rem',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      color: 'var(--color-text)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {NODE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.9rem' }}>
                  <span>Status</span>
                  <select
                    id="node-status"
                    value={editForm.status}
                    onChange={(event) => updateEditForm('status', event.target.value as NodeStatus)}
                    disabled={saving}
                    style={{
                      padding: '0.65rem 0.75rem',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      color: 'var(--color-text)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {NODE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {saveError && (
                <p role="alert" style={{ color: '#f87171', fontSize: '0.9rem' }}>
                  Error: {saveError}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                    opacity: saving ? 0.75 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'transparent',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                    opacity: saving ? 0.75 : 1,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <>
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
        </>
      )}

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
