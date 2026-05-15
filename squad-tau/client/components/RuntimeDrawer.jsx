import React from 'react';
import { usePathState, useUiState, useEnv } from '../hooks/useAtomicState.js';
import { uiStore } from '../ui-store.js';
import { useWebSocketContext } from '../websocket-context.js';
import {
  Drawer,
  Stack,
  Box,
  Slider,
  HStack,
  Text,
} from '@chakra-ui/react';

export default function RuntimeDrawer() {
  const isOpen = useUiState(s => s.drawerOpen || false);
  const maxWorkers = useEnv(s => s.maxWorkers ?? 3);
  const sessionMap = usePathState('sessions', s => s.sessions || {});
  const sessions = Object.values(sessionMap);
  const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'creating');
  const { send } = useWebSocketContext();

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => { if (!open) uiStore.dispatch('ui:toggle_drawer', { open: false }); }} placement="end" size="sm">
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>Runtime Metrics</Drawer.Header>
          <Drawer.Body pb={6}>
            <Stack gap={4}>
              <Box p={4} bg="bg.subtle" borderRadius="md">
                <Box fontWeight="semibold" mb={1}>Max Workers</Box>
                <Box fontSize="sm" color="fg.muted" mb={3}>Maximum concurrent LLM sessions</Box>
                <Slider.Root
                  defaultValue={[maxWorkers]}
                  min={1}
                  max={10}
                  step={1}
                  value={[maxWorkers]}
                  onValueChange={({ value }) => {
                    send({ type: 'config:capacity_changed', payload: { maxWorkers: value[0] } });
                  }}
                >
                  <Slider.Control>
                    <Slider.Track>
                      <Slider.Range />
                    </Slider.Track>
                    <Slider.Thumb>
                      <Slider.HiddenInput />
                    </Slider.Thumb>
                  </Slider.Control>
                </Slider.Root>
                <HStack justify="space-between" mt={1}>
                  <Text fontSize="xs" color="fg.muted">1</Text>
                  <Text fontSize="md" fontWeight="bold">{maxWorkers}</Text>
                  <Text fontSize="xs" color="fg.muted">10</Text>
                </HStack>
              </Box>
              <Box p={4} bg="bg.subtle" borderRadius="md">
                <Box fontWeight="semibold" mb={1}>Active Sessions</Box>
                <Box fontSize="2xl">{activeSessions.length}</Box>
                <Box fontSize="sm" color="fg.muted">Sessions currently creating or active</Box>
              </Box>
              {activeSessions.map(s => (
                <Box key={s.sessionId} p={2} bg="bg.emphasized" borderRadius="sm" fontSize="sm">
                  {s.sessionId}: {s.status}
                </Box>
              ))}
            </Stack>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  );
}
