import React, { useState } from 'react';
import { useAppState } from '../use-app-state.js';
import {
  Button,
  IconButton,
  Drawer,
  Dialog,
  Field,
  HStack,
  Icon,
  Input,
  NativeSelect,
  Stack,
  Table,
  Box,
} from '@chakra-ui/react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

const PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const ROLES = ['worker', 'reviewer'];
const THINKING_LEVELS = ['none', 'low', 'medium', 'high'];

const COL_WIDTHS = ['14%', '32%', '12%', '20%', '10%', '12%'];

function SelectField({ label, value, onChange, options }) {
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select</option>
          {options.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </NativeSelect.Field>
      </NativeSelect.Root>
    </Field.Root>
  );
}

function AddSlotForm({ onAdd }) {
  const [provider, setProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [role, setRole] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('');

  const handleAdd = () => {
    if (!provider || !modelId || !role) return;
    onAdd({ provider, modelId, role, thinkingLevel: thinkingLevel || 'none', inUse: false });
    setProvider('');
    setModelId('');
    setRole('');
    setThinkingLevel('');
  };

  return (
    <Stack gap={4}>
      <Box fontWeight="semibold">Add Slot</Box>
      <Stack>
        <SelectField label="Provider" value={provider} onChange={setProvider} options={PROVIDERS} />
        <Field.Root>
          <Field.Label>Model ID</Field.Label>
          <Input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. claude-3-5-sonnet"
          />
        </Field.Root>
        <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
        <SelectField label="Thinking Level" value={thinkingLevel} onChange={setThinkingLevel} options={THINKING_LEVELS} />
        <Button
          alignSelf="flex-start"
          colorPalette="blue"
          onClick={handleAdd}
          disabled={!provider || !modelId || !role}
        >
          <Icon as={Plus} boxSize={4} />
          Add slot
        </Button>
      </Stack>
    </Stack>
  );
}

function SlotRow({ slot, isEditing, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  return (
    <Table.Row>
      <Table.Cell>{slot.provider}</Table.Cell>
      <Table.Cell>{slot.modelId}</Table.Cell>
      <Table.Cell>{slot.role}</Table.Cell>
      <Table.Cell>
        {isEditing ? (
          <HStack>
            <NativeSelect.Root size="sm" width="auto">
              <NativeSelect.Field
                value={editingLevel}
                onChange={(e) => setEditingLevel(e.target.value)}
              >
                {THINKING_LEVELS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
            <IconButton size="sm" colorPalette="green" aria-label="Save" onClick={() => onSave(slot.slotId)}>
              <Icon as={Check} boxSize={4} />
            </IconButton>
            <IconButton size="sm" variant="ghost" aria-label="Cancel" onClick={onCancel}>
              <Icon as={X} boxSize={4} />
            </IconButton>
          </HStack>
        ) : (
          slot.thinkingLevel
        )}
      </Table.Cell>
      <Table.Cell>{slot.inUse ? '✓' : '✗'}</Table.Cell>
      <Table.Cell>
        <HStack gap={1}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit(slot.slotId)}
            disabled={isEditing}
            aria-label="Edit slot"
          >
            <Icon as={Pencil} boxSize={4} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            colorPalette="red"
            onClick={() => onDelete(slot.slotId)}
            aria-label="Delete slot"
          >
            <Icon as={Trash2} boxSize={4} />
          </Button>
        </HStack>
      </Table.Cell>
    </Table.Row>
  );
}

function SlotTable({ slots, editingSlotId, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  if (slots.length === 0) {
    return <Box p={4} bg="bg.subtle" borderRadius="md">No models configured. Add one above.</Box>;
  }

  return (
    <Stack gap={4}>
      <Box fontWeight="semibold">Configured Slots</Box>
      <Box overflowX="auto">
        <Table.Root variant="striped">
          <Table.Header>
            <Table.Row>
              {['Provider', 'Model ID', 'Role', 'Thinking Level', 'In Use', 'Actions'].map((h, i) => (
                <Table.ColumnHeader key={h} width={COL_WIDTHS[i]}>{h}</Table.ColumnHeader>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {slots.map((slot) => (
              <SlotRow
                key={slot.slotId}
                slot={slot}
                isEditing={editingSlotId === slot.slotId}
                editingLevel={editingLevel}
                setEditingLevel={setEditingLevel}
                onSave={onSave}
                onCancel={onCancel}
                onEdit={() => onEdit(slot.slotId, slot.thinkingLevel)}
                onDelete={onDelete}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Stack>
  );
}

function DeleteAlert({ slotId, onClose, onConfirm }) {
  return (
    <Dialog.Root open={slotId !== null} onOpenChange={({ open }) => { if (!open) onClose(); }}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content>
          <Dialog.Header>Delete Slot</Dialog.Header>
          <Dialog.Body>
            Are you sure you want to delete this model slot?
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button colorPalette="red" onClick={onConfirm}>
              <Icon as={Trash2} boxSize={4} /> Delete
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}

export default function ModelPoolDrawer({ isOpen, onClose, onUpdateSlot }) {
  const slots = useAppState(s => s.modelPool.slots || []);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [editingThinkingLevel, setEditingThinkingLevel] = useState('');
  const [deleteSlotId, setDeleteSlotId] = useState(null);

  const handleEditSave = (slotId) => {
    onUpdateSlot('edit', null, slotId, editingThinkingLevel);
    setEditingSlotId(null);
  };

  const handleDeleteConfirm = () => {
    onUpdateSlot('remove', null, deleteSlotId);
    setDeleteSlotId(null);
  };

  return (
    <>
      <Drawer.Root open={isOpen} onOpenChange={({ open }) => { if (!open) onClose(); }} placement="end" size="md">
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content>
            <Drawer.CloseTrigger />
            <Drawer.Header>Model Pool Configuration</Drawer.Header>
            <Drawer.Body pb={6}>
              <Stack gap={6} pt={4}>
                <AddSlotForm onAdd={(data) => onUpdateSlot('add', data)} />

                <SlotTable
                  slots={slots}
                  editingSlotId={editingSlotId}
                  editingLevel={editingThinkingLevel}
                  setEditingLevel={setEditingThinkingLevel}
                  onSave={handleEditSave}
                  onCancel={() => setEditingSlotId(null)}
                  onEdit={(slotId, thinkingLevel) => {
                    setEditingSlotId(slotId);
                    setEditingThinkingLevel(thinkingLevel);
                  }}
                  onDelete={setDeleteSlotId}
                />
              </Stack>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Drawer.Root>
      <DeleteAlert slotId={deleteSlotId} onClose={() => setDeleteSlotId(null)} onConfirm={handleDeleteConfirm} />
    </>
  );
}
