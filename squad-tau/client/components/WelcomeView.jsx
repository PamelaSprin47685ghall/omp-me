import React from 'react';
import { Card, Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const CONTAINER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: '32px'
};

const CARD_STYLE = {
  textAlign: 'center',
  maxWidth: '500px',
  padding: '32px'
};

const TITLE_STYLE = {
  fontSize: '24px',
  fontWeight: 600,
  marginBottom: '16px'
};

const INSTRUCTION_STYLE = {
  fontSize: '16px',
  color: '#5C7080',
  marginBottom: '24px'
};

export default function WelcomeView({ onOpenModelPool }) {
  return (
    <div style={CONTAINER_STYLE}>
      <Card style={CARD_STYLE}>
        <div style={TITLE_STYLE}>Welcome to Squad-Tau</div>
        <div style={INSTRUCTION_STYLE}>
          Type <code>/squad &lt;task&gt;</code> in your terminal to start.
        </div>
        <Button
          icon={IconNames.COG}
          text="Configure Model Pool"
          onClick={onOpenModelPool}
          large
        />
      </Card>
    </div>
  );
}
