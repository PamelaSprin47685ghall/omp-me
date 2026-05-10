import { Icon, Intent, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const STATUS_MAP = {
  pending: [Intent.NONE, IconNames.TIME],
  waiting_deps: [Intent.NONE, IconNames.TIME],
  authoring: [Intent.PRIMARY, IconNames.EDIT],
  confirming: [Intent.PRIMARY, IconNames.CONFIRM],
  reviewing: [Intent.WARNING, IconNames.EYE_OPEN],
  approved: [Intent.SUCCESS, IconNames.TICK_CIRCLE],
  rejected: [Intent.DANGER, IconNames.CROSS_CIRCLE],
  failed: [Intent.DANGER, IconNames.ERROR],
  blocked: [Intent.DANGER, IconNames.BLOCKED_PERSON]
};

const STYLE = {
  padding: '8px 16px',
  borderBottom: '1px solid rgba(16, 22, 26, 0.15)',
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
};

export default function StatusBar({ nodeId, retryCount, phase, status, mode, currentLayer, totalLayers }) {
  if (!nodeId) return null;
  const [intent, iconName] = STATUS_MAP[status] || [Intent.NONE, IconNames.DOT];

  return (
    <div style={STYLE}>
      <Tag intent={intent} icon={<Icon icon={iconName} />}>
        Node: {nodeId} · R{retryCount} · {phase}
      </Tag>
      {mode === 'L' && totalLayers > 0 && (
        <Tag minimal>Layer {currentLayer}/{totalLayers}</Tag>
      )}
    </div>
  );
}
