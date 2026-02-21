interface GatewayStateShape {
  url: string;
  port: number;
  pid: number;
  startedAt: string;
  status: string;
}

export function formatGatewayStateWithRuntime(
  state: GatewayStateShape,
  ownerPID?: number,
  isOwner?: boolean,
  activeAgentId?: string,
  storageRevision?: number,
): string {
  return [
    `url=${state.url}`,
    `port=${state.port}`,
    `pid=${state.pid}`,
    `owner_pid=${ownerPID ?? 0}`,
    `is_owner=${Boolean(isOwner)}`,
    `started_at=${state.startedAt}`,
    `status=${state.status}`,
    `active_agent=${activeAgentId ?? ''}`,
    `storage_revision=${storageRevision ?? 0}`,
  ].join('\n');
}

export function formatGatewayState(state: GatewayStateShape): string {
  return formatGatewayStateWithRuntime(
    state,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}
