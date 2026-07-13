/// <reference path="./renderer.d.ts" />
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(React.createElement(App));
}
