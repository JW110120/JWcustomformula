import React from 'react';
import { createRoot } from 'react-dom/client';
import MainPanel from './ui/MainPanel';

import { initializeTheme } from './styles/theme';
import './styles/styles.css';

// 初始化主题（含 UXP 兼容 polyfill）
initializeTheme();

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);

  const App = () => {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', overflow: 'hidden' }}>
        <MainPanel />
      </div>
    );
  };

  root.render(<App />);
}