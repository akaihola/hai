import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { localBackend } from './adapters/local';
import { createTasksBackend, createAllTasksBackend } from './adapters/tasks';
import './styles.css';

let sourcePath: string | undefined;
let allProjects = false;
try { sourcePath = localStorage.getItem('hai:tasks-source') || undefined; allProjects = localStorage.getItem('hai:tasks-all-projects') === 'true'; } catch { /* Source preferences are optional. */ }
const backend = new URLSearchParams(location.search).get('backend') === 'local' ? localBackend : (allProjects ? createAllTasksBackend : createTasksBackend)('/api', sourcePath);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App backend={backend} /></React.StrictMode>,
);
