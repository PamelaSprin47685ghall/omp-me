import React from 'react';
import { Heading, Button, Badge, Portal, Tooltip, Icon, HStack } from '@chakra-ui/react';
import { Settings, Wifi, WifiOff, Square } from 'lucide-react';
import { usePathState } from '../hooks/useAtomicState.js';
import { eventStore } from '../event-store.js';
import { useWebSocketContext } from '../websocket-context.js';

export default function Header() {
  const { connected } = useWebSocketContext();
  const squadActive = usePathState('squad', s => s.squad.mode && (s.squad.status === 'active' || s.squad.status === 'complete'));
  const { send } = useWebSocketContext();
  const port = typeof window !== 'undefined' ? window.location.port : '';

  const handleAbort = () => {
    send({ type: 'abort', payload: {} });
  };

  return (
    <HStack
      as="header"
      justifyContent="space-between"
      px={4}
      py={2}
      bg="bg.subtle"
      borderBottom="1px solid"
      borderColor="border"
    >
      <HStack>
        <Heading size="sm" data-app-title>
          Squad-Tau
        </Heading>
        <Icon as={connected ? Wifi : WifiOff} boxSize={3.5} />
        <Badge colorPalette={connected ? 'green' : 'red'} data-header-connection>
          {connected ? `Connected: ${port}` : 'Disconnected'}
        </Badge>
      </HStack>
      <HStack>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant="ghost" size="sm" onClick={() => eventStore.dispatch('ui:toggle_drawer', { open: true })} aria-label="Runtime Metrics">
              <Icon as={Settings} boxSize={4} />
            </Button>
          </Tooltip.Trigger>
          <Portal>
            <Tooltip.Positioner>
              <Tooltip.Content>Runtime Metrics</Tooltip.Content>
            </Tooltip.Positioner>
          </Portal>
        </Tooltip.Root>
        {squadActive && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant="ghost" size="sm" colorPalette="red" onClick={handleAbort}>
                <Icon as={Square} boxSize={4} />
              </Button>
            </Tooltip.Trigger>
            <Portal>
              <Tooltip.Positioner>
                <Tooltip.Content>Abort Squad</Tooltip.Content>
              </Tooltip.Positioner>
            </Portal>
          </Tooltip.Root>
        )}
      </HStack>
    </HStack>
  );
}
