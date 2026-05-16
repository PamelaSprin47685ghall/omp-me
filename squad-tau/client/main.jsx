import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import App from './App.jsx';

// Register <stream-sink> custom element before React renders
import './components/stream-sink.js';

const root = createRoot(document.getElementById('root'));
root.render(
  <ChakraProvider value={defaultSystem}>
    <App />
  </ChakraProvider>
);

// Physical readiness signal for Puppeteer tests
if (typeof window !== 'undefined') window.__SQUAD_APP_MOUNTED = true;