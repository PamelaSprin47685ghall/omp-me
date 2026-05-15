import React from 'react';
import { usePathState } from '../hooks/useAtomicState.js';
import { eventStore } from '../event-store.js';
import {
  Drawer,
  Stack,
  Box,
} from '@chakra-ui/react';

export default function RuntimeDrawer() {
  const isOpen = usePathState('ui', s => s.ui?.drawerOpen || false);
  const maxWorkers = usePathState('modelPool', s => s.modelPool?.maxWorkers || 3);
  const sessions = usePathState('sessions', s => Object.values(s.sessions || {}));
  const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'creating');

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => { if (!open) eventStore.dispatch('ui:toggle_drawer', { open: false }); }} placement="end" size="sm">
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>Runtime Metrics</Drawer.Header>
          <Drawer.Body pb={6}>
            <Stack gap={4}>
              <Box p={4} bg="bg.subtle" borderRadius="md">
                <Box fontWeight="semibold" mb={1}>Max Workers</Box>
                <Box fontSize="2xl">{maxWorkers}</Box>
                <Box fontSize="sm" color="fg.muted">Maximum concurrent LLM sessions</Box>
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
