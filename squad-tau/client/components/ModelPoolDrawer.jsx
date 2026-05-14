import React, { useState } from 'react';
import { Alert, Button, ButtonGroup, Callout, CardList, ControlGroup, Drawer, FormGroup, HTMLTable, HTMLSelect, InputGroup, SectionCard } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const ROLES = ['worker', 'reviewer'];
const THINKING_LEVELS = ['none', 'low', 'medium', 'high'];

function makeSelectOptions(values) {
  return [{ label: 'Select', value: '' }, ...values.map((value) => ({ label: value, value }))];
}

function SelectField({ label, value, onChange, options }) {
  return (
    <FormGroup label={label}>
      <HTMLSelect fill value={value} onChange={(event) => onChange(event.target.value)} options={makeSelectOptions(options)} />
    </FormGroup>
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
    <SectionCard elevation={0} title="Add Slot">
      <ControlGroup fill vertical>
        <SelectField label="Provider" value={provider} onChange={setProvider} options={PROVIDERS} />
        <FormGroup label="Model ID">
          <InputGroup fill value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="e.g. claude-3-5-sonnet" />
        </FormGroup>
        <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
        <SelectField label="Thinking Level" value={thinkingLevel} onChange={setThinkingLevel} options={THINKING_LEVELS} />
        <Button icon={IconNames.ADD} intent="primary" text="Add slot" onClick={handleAdd} disabled={!provider || !modelId || !role} style={{ alignSelf: 'flex-start' }} />
      </ControlGroup>
    </SectionCard>
  );
}

function SlotActions({ slotId, onEdit, onDelete, disabled }) {
  return (
    <ButtonGroup minimal>
      <Button icon={IconNames.EDIT} small minimal title="Edit slot" onClick={() => onEdit(slotId)} disabled={disabled} />
      <Button icon={IconNames.TRASH} small minimal intent="danger" title="Delete slot" onClick={() => onDelete(slotId)} />
    </ButtonGroup>
  );
}

function SlotRow({ slot, isEditing, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  return (
    <tr>
      <td>{slot.provider}</td>
      <td>{slot.modelId}</td>
      <td>{slot.role}</td>
      <td>
        {isEditing ? (
          <ControlGroup>
            <HTMLSelect
              value={editingLevel}
              onChange={(event) => setEditingLevel(event.target.value)}
              options={THINKING_LEVELS.map((thinkingLevel) => ({ label: thinkingLevel, value: thinkingLevel }))}
            />
            <Button icon={IconNames.TICK} small intent="success" onClick={() => onSave(slot.slotId)} />
            <Button icon={IconNames.CROSS} small onClick={onCancel} />
          </ControlGroup>
        ) : (
          slot.thinkingLevel
        )}
      </td>
      <td>{slot.inUse ? '✓' : '✗'}</td>
      <td>
        <SlotActions slotId={slot.slotId} onEdit={onEdit} onDelete={onDelete} disabled={isEditing} />
      </td>
    </tr>
  );
}

function SlotTable({ slots, editingSlotId, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  if (slots.length === 0) {
    return <Callout intent="none">No models configured. Add one above.</Callout>;
  }

  return (
    <CardList>
      <SectionCard elevation={0} title="Configured Slots">
        <HTMLTable striped compact interactive style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '14%' }}>Provider</th>
              <th style={{ width: '32%' }}>Model ID</th>
              <th style={{ width: '12%' }}>Role</th>
              <th style={{ width: '20%' }}>Thinking Level</th>
              <th style={{ width: '10%' }}>In Use</th>
              <th style={{ width: '12%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
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
          </tbody>
        </HTMLTable>
      </SectionCard>
    </CardList>
  );
}

function DeleteAlert({ slotId, onClose, onConfirm }) {
  return (
    <Alert
      isOpen={slotId !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      intent="danger"
      icon={IconNames.TRASH}
      confirmButtonText="Delete"
      cancelButtonText="Cancel"
    >
      <p>Are you sure you want to delete this model slot?</p>
    </Alert>
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
      <Drawer isOpen={isOpen} onClose={onClose} title="Model Pool Configuration" size="600px" position="right">
        <div className="bp6-padded">
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
        </div>
      </Drawer>
      <DeleteAlert slotId={deleteSlotId} onClose={() => setDeleteSlotId(null)} onConfirm={handleDeleteConfirm} />
    </>
  );
}

