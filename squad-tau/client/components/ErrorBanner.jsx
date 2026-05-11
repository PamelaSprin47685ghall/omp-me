import { useState } from 'react';
import { Callout, Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export function formatNodeCounts(nodes) {
  const failed = nodes.filter(n => n.status === 'failed').length;
  const blocked = nodes.filter(n => n.status === 'blocked').length;
  
  if (failed === 0 && blocked === 0) return '';
  if (failed > 0 && blocked > 0) return `${failed} failed, ${blocked} blocked`;
  if (failed > 0) return `${failed} failed`;
  return `${blocked} blocked`;
}

export function getFailureReason(nodes) {
  const nodeWithSummary = nodes.find(n => n.summary && n.summary.trim());
  return nodeWithSummary?.summary || 'Unknown error';
}

export default function ErrorBanner({ nodes }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const blocked = nodes.filter(n => n.status === 'blocked');
  const failed = nodes.filter(n => n.status === 'failed');
  const total = blocked.length + failed.length;

  if (total === 0) return null;

  const reason = blocked.length > 0
    ? blocked[0].error || blocked[0].summary || 'Node blocked'
    : failed.length > 0
      ? failed[0].error || failed[0].summary || 'Node failed'
      : 'Unknown error';

  return (
    <Callout
      intent="danger"
      icon={IconNames.Error}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Squad Failed</span>
          <Button
            minimal
            icon={IconNames.Cross}
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          />
        </div>
      }
    >
      {reason} &mdash; {total} node{total !== 1 ? 's' : ''} blocked/failed
    </Callout>
  );
}