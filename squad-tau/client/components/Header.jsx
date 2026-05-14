import React from 'react';
import { Heading, Button, Badge, Portal, Tooltip, Icon, HStack } from '@chakra-ui/react';
import { Settings, Wifi, WifiOff, Square } from 'lucide-react';
import { useAppState } from '../use-app-state.js';

function Header({ connected, onOpenModelPool, onAbort }) {
  const squadActive = useAppState(s => s.squad.mode && (s.squad.status === 'active' || s.squad.status === 'complete'));
  const port = typeof window !== 'undefined' ? window.location.port : '';
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
            <Button variant="ghost" size="sm" onClick={onOpenModelPool} aria-label="Model Pool">
              <Icon as={Settings} boxSize={4} />
            </Button>
          </Tooltip.Trigger>
          <Portal>
            <Tooltip.Positioner>
              <Tooltip.Content>Model Pool</Tooltip.Content>
            </Tooltip.Positioner>
          </Portal>
        </Tooltip.Root>
        {squadActive && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant="ghost" size="sm" colorPalette="red" onClick={onAbort}>
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

export default Header;
