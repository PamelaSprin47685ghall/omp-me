import React from 'react';
import { NonIdealState, Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export default function WelcomeView({ onOpenModelPool }) {
  return (
    <div className="app-main welcome-layout">
      <NonIdealState
        icon={IconNames.PEOPLE}
        title="Welcome to Squad-Tau"
        description="Type /squad <task> in your terminal to start a multi-agent orchestrated task."
        action={
          <Button intent="primary" icon={IconNames.COG} text="Configure Model Pool" onClick={onOpenModelPool} large />
        }
      />
    </div>
  );
}
