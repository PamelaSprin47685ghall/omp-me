import React, { useState } from 'react';
import { Drawer, Button, Icon, HTMLTable, InputGroup, Alert, HTMLSelect } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const ROLES = ['worker', 'reviewer', 'outer'];
const THINKING_LEVELS = ['none', 'low', 'medium', 'high'];

const TABLE_CONTAINER_STYLE = { overflowX: 'auto', marginTop: '16px' };
const EMPTY_STYLE = { textAlign: 'center', padding: '32px', color: '#5C7080', fontStyle: 'italic' };
const ADD_FORM_STYLE = { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' };
const FORM_FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '120px' };
const LABEL_STYLE = { fontSize: '12px', fontWeight: 600, color: '#5C7080' };

function SelectField({ label, value, onChange, options }) {
  return (
    <div style={FORM_FIELD_STYLE}>
      <label style={LABEL_STYLE}>{label}</label>
      <HTMLSelect
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[{ label: 'Select', value: '' }, ...options.map(o => ({ label: o, value: o }))]}
      />
    </div>
  );
}

export default function ModelPoolDrawer({ isOpen, onClose, slots, onUpdateSlot }) {
  const [provider, setProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [role, setRole] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingThinkingLevel, setEditingThinkingLevel] = useState('');
  const [deleteIndex, setDeleteIndex] = useState(null);

  const handleAdd = () => {
    if (!provider || !modelId || !role) return;
    onUpdateSlot('add', { provider, modelId, role, thinkingLevel: thinkingLevel || 'none', inUse: false });
    setProvider('');
    setModelId('');
    setRole('');
    setThinkingLevel('');
  };

  const handleEditStart = (index, currentLevel) => {
    setEditingIndex(index);
    setEditingThinkingLevel(currentLevel);
  };

  const handleEditSave = (index) => {
    onUpdateSlot('edit', { ...slots[index], thinkingLevel: editingThinkingLevel }, index);
    setEditingIndex(null);
  };

  const handleDeleteConfirm = () => {
    onUpdateSlot('remove', null, deleteIndex);
    setDeleteIndex(null);
  };

  return (
    <>
      <Drawer isOpen={isOpen} onClose={onClose} title="Model Pool Configuration" size="600px" position="right">
        <div style={{ padding: '16px' }}>
          <div style={ADD_FORM_STYLE}>
            <SelectField label="Provider" value={provider} onChange={setProvider} options={PROVIDERS} />
            <div style={{ ...FORM_FIELD_STYLE, flex: 1 }}>
              <label style={LABEL_STYLE}>Model ID</label>
              <InputGroup value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="e.g. claude-3-5-sonnet" />
            </div>
            <SelectField label="Role" value={role} onChange={setRole} options={ROLES} />
            <SelectField label="Thinking Level" value={thinkingLevel} onChange={setThinkingLevel} options={THINKING_LEVELS} />
            <Button icon={IconNames.ADD} intent="primary" onClick={handleAdd} disabled={!provider || !modelId || !role} />
          </div>

          <div style={TABLE_CONTAINER_STYLE}>
            {slots.length === 0 ? (
              <div style={EMPTY_STYLE}>No models configured. Add one above.</div>
            ) : (
              <HTMLTable striped interactive style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model ID</th>
                    <th>Role</th>
                    <th>Thinking Level</th>
                    <th>In Use</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot, index) => (
                    <tr key={index}>
                      <td>{slot.provider}</td>
                      <td>{slot.modelId}</td>
                      <td>{slot.role}</td>
                      <td>
                        {editingIndex === index ? (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <HTMLSelect
                              value={editingThinkingLevel}
                              onChange={(e) => setEditingThinkingLevel(e.target.value)}
                              options={THINKING_LEVELS.map(t => ({ label: t, value: t }))}
                            />
                            <Button icon={IconNames.TICK} small intent="success" onClick={() => handleEditSave(index)} />
                            <Button icon={IconNames.CROSS} small onClick={() => setEditingIndex(null)} />
                          </div>
                        ) : (
                          slot.thinkingLevel
                        )}
                      </td>
                      <td>
                        {slot.inUse ? '✓' : '✗'}
                      </td>
                      <td>
                        <Button icon={IconNames.EDIT} small minimal onClick={() => handleEditStart(index, slot.thinkingLevel)} disabled={editingIndex !== null} />
                        <Button icon={IconNames.TRASH} small minimal intent="danger" onClick={() => setDeleteIndex(index)} disabled={slot.inUse} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
          </div>
        </div>
      </Drawer>

      <Alert
        isOpen={deleteIndex !== null}
        onClose={() => setDeleteIndex(null)}
        onConfirm={handleDeleteConfirm}
        intent="danger"
        icon={IconNames.TRASH}
        confirmButtonText="Delete"
        cancelButtonText="Cancel"
      >
        <p>Are you sure you want to delete this model slot?</p>
      </Alert>
    </>
  );
}
