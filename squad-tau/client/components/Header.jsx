import React from 'react';
import { Navbar, Button, Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

/**
 * @typedef {Object} HeaderProps
 * @property {boolean} connected
 * @property {boolean} dagCollapsed
 * @property {()=>void} onToggleDAG
 * @property {()=>void} onOpenModelPool
 * @property {boolean} squadActive
 * @property {()=>void} onAbort
 */

const NAVBAR_STYLE = {
  padding: '0 16px',
  height: '50px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
};

const BRAND_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '16px',
  fontWeight: 600,
};

const STATUS_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

function BrandSection({ dagCollapsed, onToggleDAG }) {
  return (
    <Navbar.Group align="left">
      <div style={BRAND_STYLE}>
        <Icon icon={IconNames.PEOPLE} size={20} />
        <span className="brand-text">Squad-Tau</span>
      </div>
      <Navbar.Divider />
      <Tooltip content={dagCollapsed ? 'Expand DAG View' : 'Collapse DAG View'}>
        <Button
          minimal
          icon={IconNames.PANEL_STATS}
          onClick={onToggleDAG}
          aria-label="Toggle DAG View"
        />
      </Tooltip>
    </Navbar.Group>
  );
}

function ConnectionStatus({ connected }) {
  const port = typeof window !== 'undefined' ? window.location.port : '';
  const statusColor = connected ? '#0F9960' : '#DB3737';
  const statusText = connected ? `Connected :${port}` : 'Disconnected';

  return (
    <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <div style={STATUS_STYLE}>
        <Tooltip content={statusText}>
          <Icon icon={IconNames.DOT} size={16} color={statusColor} />
        </Tooltip>
        {connected && <span style={{fontSize:12,color:'#5C7080'}}>:&#8203;{port}</span>}
      </div>
    </div>
  );
}

function ActionButtons({ onOpenModelPool, squadActive, onAbort }) {
  return (
    <Navbar.Group align="right">
      <Tooltip content="Model Pool Configuration">
        <Button
          minimal
          icon={IconNames.COG}
          onClick={onOpenModelPool}
          aria-label="Model Pool Configuration"
        />
      </Tooltip>
      {squadActive && (
        <Tooltip content="Abort Squad">
          <Button
            minimal
            icon={IconNames.STOP_SIGN}
            intent="danger"
            onClick={onAbort}
            aria-label="Abort Squad"
          />
        </Tooltip>
      )}
    </Navbar.Group>
  );
}

/**
 * Top header bar with brand, DAG toggle, connection status, model pool config, and abort button.
 * @param {HeaderProps} props
 */
export default function Header({
  connected,
  dagCollapsed,
  onToggleDAG,
  onOpenModelPool,
  squadActive,
  onAbort,
}) {
  return (
    <Navbar style={NAVBAR_STYLE}>
      <BrandSection dagCollapsed={dagCollapsed} onToggleDAG={onToggleDAG} />
      <ConnectionStatus connected={connected} />
      <ActionButtons
        onOpenModelPool={onOpenModelPool}
        squadActive={squadActive}
        onAbort={onAbort}
      />

      <style>{`
        @media (max-width: 1280px) {
          .brand-text {
            display: none;
          }
        }
      `}</style>
    </Navbar>
  );
}
