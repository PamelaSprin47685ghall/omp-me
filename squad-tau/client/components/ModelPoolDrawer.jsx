import React, { useState } from 'react';
import { Drawer, Button, Icon, HTMLTable, InputGroup, Alert, HTMLSelect } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const ROLES = ['worker', 'reviewer'];
const THINKING_LEVELS = ['none', 'low', 'medium', 'high'];

const FORM_FIELD_CLASS = 'model-pool-field';

function SelectField({ label, value, onChange, options }) {
  return (
    <div className={FORM_FIELD_CLASS}>
      <label className="model-pool-label">{label}</label>
      <HTMLSelect
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[{ label: 'Select', value: '' }, ...options.map(o => ({ label: o, value: o }))]}
      />
    </div>
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

  const disabled = !provider || !modelId || !role;

  return (
    <div className="model-pool-add-form">
      <SelectField label="Provider" value={provider} onChange={setProvider} options={PROVIDERS} />
      <div className="model-pool-field-flex">
        <label className="model-pool-label">Model ID</label>
        <InputGroup value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="e.g. claude-3-5-sonnet" />
      </div>
      <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
      <SelectField label="Thinking Level" value={thinkingLevel} onChange={setThinkingLevel} options={THINKING_LEVELS} />
      <Button icon={IconNames.ADD} intent="primary" onClick={handleAdd} disabled={disabled} />
    </div>
  );
}

function SlotActions({ slotId, onEdit, onDelete, disabled }) {
  return (
    <td>
      <Button icon={IconNames.EDIT} small minimal onClick={() => onEdit(slotId)} disabled={disabled} />
      <Button icon={IconNames.TRASH} small minimal intent="danger" onClick={() => onDelete(slotId)} />
    </td>
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
          <div className="model-pool-edit-row">
            <HTMLSelect
              value={editingLevel}
              onChange={(e) => setEditingLevel(e.target.value)}
              options={THINKING_LEVELS.map(t => ({ label: t, value: t }))}
            />
            <Button icon={IconNames.TICK} small intent="success" onClick={() => onSave(slot.slotId)} />
            <Button icon={IconNames.CROSS} small onClick={onCancel} />
          </div>
        ) : slot.thinkingLevel}
      </td>
      <td>{slot.inUse ? '✓' : '✗'}</td>
      <SlotActions slotId={slot.slotId} onEdit={onEdit} onDelete={onDelete} disabled={isEditing} />
    </tr>
  );
}

function SlotTable({ slots, editingSlotId, editingLevel, setEditingLevel, onSave, onCancel, onEdit, onDelete }) {
  if (slots.length === 0) {
    return <div className="model-pool-empty">No models configured. Add one above.</div>;
  }
  return (
    <div className="model-pool-table-wrap">
      <HTMLTable striped interactive className="model-pool-table">
        <thead>
          <tr>
            <th>Provider</th><th>Model ID</th><th>Role</th>
            <th>Thinking Level</th><th>In Use</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {slots.map(slot => (
            <SlotRow
              key={slot.slotId} slot={slot}
              isEditing={editingSlotId === slot.slotId}
              editingLevel={editingLevel} setEditingLevel={setEditingLevel}
              onSave={onSave} onCancel={onCancel}
              onEdit={() => onEdit(slot.slotId, slot.thinkingLevel)} onDelete={onDelete}
            />
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
}

function DeleteAlert({ slotId, onClose, onConfirm }) {
  return (
    <Alert
      isOpen={slotId !== null} onClose={onClose} onConfirm={onConfirm}
      intent="danger" icon={IconNames.TRASH}
      confirmButtonText="Delete" cancelButtonText="Cancel"
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
        <div className="model-pool-drawer-body">
          <AddSlotForm onAdd={(data) => onUpdateSlot('add', data)} />
          <SlotTable
            slots={slots} editingSlotId={editingSlotId}
            editingLevel={editingThinkingLevel} setEditingLevel={setEditingThinkingLevel}
            onSave={handleEditSave} onCancel={() => setEditingSlotId(null)}
            onEdit={(slotId, lvl) => { setEditingSlotId(slotId); setEditingThinkingLevel(lvl); }}
            onDelete={setDeleteSlotId}
          />
        </div>
      </Drawer>
      <DeleteAlert slotId={deleteSlotId} onClose={() => setDeleteSlotId(null)} onConfirm={handleDeleteConfirm} />
    </>
  );
}


