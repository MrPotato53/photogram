import React from 'react';
import ReactDOM from 'react-dom/client';
import Konva from 'konva';
import App from './App';
import './index.css';

// Restrict Konva-native drags to the left mouse button. Middle-click is
// reserved for canvas panning; right-click is for context menus.
Konva.dragButtons = [0];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
