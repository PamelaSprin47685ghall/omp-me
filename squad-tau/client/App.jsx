import React, { useEffect } from 'react';
import { Flex } from '@chakra-ui/react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainContent from './components/MainContent.jsx';
import RuntimeDrawer from './components/RuntimeDrawer.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { WebSocketContext } from './websocket-context.js';

export default function App() {
  const { isDark } = useDarkMode();
  const { connected, send } = useWebSocket();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <WebSocketContext.Provider value={{ connected, send }}>
      <Flex direction="column" minH="100vh" w="full">
        <Header />
        <Flex flex={1} minH={0}>
          <Sidebar />
          <MainContent />
        </Flex>
        <RuntimeDrawer />
      </Flex>
    </WebSocketContext.Provider>
  );
}
