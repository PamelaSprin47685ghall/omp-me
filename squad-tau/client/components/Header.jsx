import React from 'react';
import { Navbar, Button, Tag, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

function ConnectionStatus({ connected }) {
  const port = typeof window !== 'undefined' ? window.location.port : '';
  return (
    <div className="bp6-text-small header-connection">
      <Tag round minimal intent={connected ? 'success' : 'danger'} icon={connected ? IconNames.SIGNAL_SEARCH : IconNames.OFFLINE}>
        {connected ? `Connected: ${port}` : 'Disconnected'}
      </Tag>
    </div>
  );
}

function Header({ connected, onOpenModelPool, squadActive, onAbort }) {
  return (
    <Navbar fixedToTop={false}>
      <Navbar.Group align="left">
        <Navbar.Heading className="app-title">Squad-Tau</Navbar.Heading>
        <ConnectionStatus connected={connected} />
      </Navbar.Group>
      <Navbar.Group align="right">
        <Tooltip content="Model Pool" minimal>
          <Button minimal icon={IconNames.COG} onClick={onOpenModelPool} />
        </Tooltip>
        {squadActive && (
          <Tooltip content="Abort Squad" minimal>
            <Button minimal icon={IconNames.STOP} intent="danger" onClick={onAbort} />
          </Tooltip>
        )}
      </Navbar.Group>
    </Navbar>
  );
}

export default Header;
