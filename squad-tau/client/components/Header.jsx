import React from 'react';
import { Flex, Heading, Button, Badge, Text, Tooltip } from '@chakra-ui/react';
import { Settings, Wifi, WifiOff, Square } from 'lucide-react';

function ConnectionStatus({ connected }) {
  const port = typeof window !== 'undefined' ? window.location.port : '';
  const statusIcon = connected ? Wifi : WifiOff;
  const Icon = statusIcon;
  return (
    <Flex alignItems="center" gap={2} data-header-connection>
      <Icon size={14} />
      <Badge colorScheme={connected ? 'green' : 'red'} borderRadius="full" fontSize="xs" px={2} py={0.5}>
        {connected ? `Connected: ${port}` : 'Disconnected'}
      </Badge>
    </Flex>
  );
}

function Header({ connected, onOpenModelPool, squadActive, onAbort }) {
  return (
    <Flex
      as="header"
      alignItems="center"
      justifyContent="space-between"
      px={4}
      py={2}
      bg="gray.50"
      borderBottom="1px solid"
      borderColor="gray.200"
      _dark={{ bg: 'gray.800', borderColor: 'gray.600' }}
    >
      <Flex alignItems="center" gap={3}>
        <Heading size="sm" color="gray.800" _dark={{ color: 'gray.100' }} data-app-title>
          Squad-Tau
        </Heading>
        <ConnectionStatus connected={connected} />
      </Flex>
      <Flex alignItems="center" gap={2}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant="ghost" size="sm" onClick={onOpenModelPool} aria-label="Model Pool">
              <Settings size={16} />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Positioner>
            <Tooltip.Content>Model Pool</Tooltip.Content>
          </Tooltip.Positioner>
        </Tooltip.Root>
        {squadActive && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant="ghost" size="sm" colorScheme="red" onClick={onAbort}>
                <Square size={16} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Positioner>
              <Tooltip.Content>Abort Squad</Tooltip.Content>
            </Tooltip.Positioner>
          </Tooltip.Root>
        )}
      </Flex>
    </Flex>
  );
}

export default Header;
