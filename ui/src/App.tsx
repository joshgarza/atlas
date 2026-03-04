import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import NodesPage from './pages/NodesPage';
import NodeDetailPage from './pages/NodeDetailPage';
import SearchPage from './pages/SearchPage';
import GraphPage from './pages/GraphPage';
import ArchivistPage from './pages/ArchivistPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<NodesPage />} />
          <Route path="nodes/:id" element={<NodeDetailPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="archivist" element={<ArchivistPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
