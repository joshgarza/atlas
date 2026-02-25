import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import NodesPage from './pages/NodesPage';
import SearchPage from './pages/SearchPage';
import ArchivistPage from './pages/ArchivistPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<NodesPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="archivist" element={<ArchivistPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
