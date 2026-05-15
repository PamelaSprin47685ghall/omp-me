import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import App from './App.jsx';

// Register <agent-message> custom element before React renders
import './components/agent-message.js';

const root = createRoot(document.getElementById('root'));
root.render(
  <ChakraProvider value={defaultSystem}>
    <App />
  </ChakraProvider>
);