import React, { useState } from 'react';
import {
  Button,
  IconButton,
  DrawerBody,
  DrawerCloseTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerPositioner,
  DrawerBackdrop,
  DrawerRoot,
  DrawerFooter,
  DialogRoot,
  DialogBackdrop,
  DialogPositioner,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogCloseTrigger,
  FieldRoot,
  FieldLabel,
  Flex,
  HStack,
  Input,
  NativeSelectRoot,
  NativeSelectField,
  Stack,
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRoot,
  TableRow,
  Box,
} from '@chakra-ui/react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

const PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const ROLES = ['worker', 'reviewer'];
const THINKING_LEVELS = ['none', 'low', 'medium', 'high'];

const COL_WIDTHS = ['14%', '32%', '12%', '20%', '10%', '12%'];

function SelectField({ label, value, onChange, options }) {
  return (
    <FieldRoot>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelectRoot>
        <NativeSelectField
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select</option>
          {options.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </NativeSelectField>
      </NativeSelectRoot>
    </FieldRoot>
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
    <Stack spacing={4}>
      <Box fontWeight="semibold" pb={2}>Add Slot</Box>
      <Stack spacing={3}>
        <SelectField label="Provider" value={provider} onChange={setProvider} options={PROVIDERS} />
        <FieldRoot>
          <FieldLabel>Model ID</FieldLabel>
          <Input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. claude-3-5-sonnet"
          />
        </FieldRoot>
        <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
        <SelectField label="Thinking Level" value={thinkingLevel} onChange={setThinkingLevel} options={THINKING_LEVELS} />
        <Button
          leftIcon={<Plus />}
          alignSelf="flex-start"
          colorScheme="blue"
          onClick={handleAdd}
          disabled={!provider || !modelId || !role}
        >
          Add slot
        </Button>
      </Stack>
    </Stack>
  );
}

function SlotActions({ slotId, onEdit, onDelete, disabled }) {
  return (
    <HStack spacing={1}>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={<Pencil />}
        onClick={() => onEdit(slotId)}
        disabled={disabled}
        aria-label="Edit slot"
      />
      <Button
        size="sm"
        variant="ghost"
        colorScheme="red"
        leftIcon={<Trash2 />}
        onClick={() => onDelete(slotId)}
        aria-label="Delete slot"
      />
    </HStack>
  );
}

function SlotRow({ slot, isEditing, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  return (
    <TableRow>
      <TableCell>{slot.provider}</TableCell>
      <TableCell>{slot.modelId}</TableCell>
      <TableCell>{slot.role}</TableCell>
      <TableCell>
        {isEditing ? (
          <HStack spacing={2}>
            <NativeSelectRoot size="sm" width="auto">
              <NativeSelectField
                value={editingLevel}
                onChange={(e) => setEditingLevel(e.target.value)}
              >
                {THINKING_LEVELS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </NativeSelectField>
            </NativeSelectRoot>
            <IconButton size="sm" colorScheme="green" aria-label="Save" onClick={() => onSave(slot.slotId)}>
              <Check />
            </IconButton>
            <IconButton size="sm" variant="ghost" aria-label="Cancel" onClick={onCancel}>
              <X />
            </IconButton>
          </HStack>
        ) : (
          slot.thinkingLevel
        )}
      </TableCell>
      <TableCell>{slot.inUse ? '✓' : '✗'}</TableCell>
      <TableCell>
        <SlotActions slotId={slot.slotId} onEdit={onEdit} onDelete={onDelete} disabled={isEditing} />
      </TableCell>
    </TableRow>
  );
}

function SlotTable({ slots, editingSlotId, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  if (slots.length === 0) {
    return <Box p={4} bg="gray.50" borderRadius="md" _dark={{ bg: "gray.700" }}>No models configured. Add one above.</Box>;
  }

  return (
    <Stack spacing={4}>
      <Box fontWeight="semibold" pb={2}>Configured Slots</Box>
      <Box overflowX="auto">
        <TableRoot variant="striped" size="sm">
          <TableHeader>
            <TableRow>
              {['Provider', 'Model ID', 'Role', 'Thinking Level', 'In Use', 'Actions'].map((h, i) => (
                <TableColumnHeader key={h} width={COL_WIDTHS[i]}>{h}</TableColumnHeader>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
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
          </TableBody>
        </TableRoot>
      </Box>
    </Stack>
  );
}

function DeleteAlert({ slotId, onClose, onConfirm }) {
  return (
    <DialogRoot open={slotId !== null} onOpenChange={({ open }) => { if (!open) onClose(); }}>
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent>
          <DialogHeader>Delete Slot</DialogHeader>
          <DialogBody>
            Are you sure you want to delete this model slot?
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button colorScheme="red" onClick={onConfirm} ml={3}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
          <DialogCloseTrigger />
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  );
}

export default function ModelPoolDrawer({ isOpen, onClose, slots, onUpdateSlot }) {
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
      <DrawerRoot open={isOpen} onOpenChange={({ open }) => { if (!open) onClose(); }} placement="right" size="md">
        <DrawerBackdrop />
        <DrawerPositioner>
          <DrawerContent>
            <DrawerCloseTrigger />
            <DrawerHeader>Model Pool Configuration</DrawerHeader>
            <DrawerBody pb={6}>
              <Stack spacing={6} pt={4}>
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
            </DrawerBody>
          </DrawerContent>
        </DrawerPositioner>
      </DrawerRoot>
      <DeleteAlert slotId={deleteSlotId} onClose={() => setDeleteSlotId(null)} onConfirm={handleDeleteConfirm} />
    </>
  );
}
