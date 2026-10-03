import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { localBackend } from './adapters/local';
import { createTasksBackend } from './adapters/tasks';
import './styles.css';

let sourcePath: string | undefined;
try { sourcePath = localStorage.getItem('hai:tasks-source') || undefined; } catch { /* Source preferences are optional. */ }
const backend = new URLSearchParams(location.search).get('backend') === 'local' ? localBackend : createTasksBackend('/api', sourcePath);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App backend={backend} /></React.StrictMode>,
);
