import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Nodes' },
  { to: '/search', label: 'Search' },
  { to: '/archivist', label: 'Archivist' },
];

export default function Layout() {
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav
        style={{
          width: 'var(--sidebar-width)',
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          padding: '1.5rem 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '0 1.25rem 1.25rem',
            borderBottom: '1px solid var(--color-border)',
            marginBottom: '0.75rem',
            fontSize: '1.125rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          Atlas
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'block',
              padding: '0.5rem 1.25rem',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              fontWeight: isActive ? 500 : 400,
              borderLeft: isActive ? '3px solid var(--color-accent)' : '3px solid transparent',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem 2rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
