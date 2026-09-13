import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  Loader2,
  LockKeyhole,
  MonitorCog,
  Users,
} from 'lucide-react';
import type { AgentConfigMeta, MachineId } from '@lody/shared';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { userAtom } from '@/atoms';
import { AgentIcon } from '@/components/icons/agent-icon';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { useOnlineMachineIds } from '@/hooks/use-machine-online-status';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { useVisibleLocalProjectsFromMachineIndex } from '@/hooks/use-visible-local-projects';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { isElectronRenderer } from '@/lib/electron';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';

export type AccountMachineDirectory = {
  key: string;
  name: string;
  rootPath: string;
  sharedWithTeam: boolean;
};

export type AccountMachineOverviewItem = {
  id: MachineId;
  name: string;
  os?: string;
  isOnline: boolean;
  sharedWithTeam: boolean;
  agents: AgentConfigMeta[];
  directories: AccountMachineDirectory[];
};

export function AccountMachinesOverview() {
  const { openSettings } = useOpenSettings();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const localMachineId = useAtomValue(localMachineIdAtom);
  const onlineMachineIds = useOnlineMachineIds();
  const machineIndex = useVisibleMachineMetas();
  const projectIndex = useVisibleLocalProjectsFromMachineIndex(machineIndex);

  const ownMachines = useMemo(
    () =>
      [...machineIndex.machines.values()].filter((machine) => {
        if (machine.id === localMachineId) return true;
        const ownerUserId =
          machineIndex.accessByMachineId.get(machine.id)?.ownerUserId ?? machine.ownerUserId;
        if (isElectronRenderer() || !ownerUserId) return true;
        return Boolean(currentUserId && ownerUserId === currentUserId);
      }),
    [currentUserId, localMachineId, machineIndex.accessByMachineId, machineIndex.machines]
  );
  const ownMachineIds = useMemo(() => ownMachines.map((machine) => machine.id), [ownMachines]);
  useMachineFlockAgentConfigsForMachineIds(ownMachineIds);
  const allAgentConfigs = useAtomValue(getAllAgentConfigAtom);

  const items = useMemo<AccountMachineOverviewItem[]>(() => {
    const agentsByMachine = new Map<MachineId, AgentConfigMeta[]>();
    for (const config of allAgentConfigs) {
      if (!agentsByMachine.has(config.machineId)) agentsByMachine.set(config.machineId, []);
      agentsByMachine.get(config.machineId)?.push(config);
    }

    const directoriesByMachine = new Map<MachineId, AccountMachineDirectory[]>();
    for (const [key, entry] of projectIndex.projects) {
      if (!directoriesByMachine.has(entry.machineId)) {
        directoriesByMachine.set(entry.machineId, []);
      }
      directoriesByMachine.get(entry.machineId)?.push({
        key,
        name: entry.project.name,
        rootPath: entry.project.rootPath,
        sharedWithTeam: projectIndex.accessByProjectKey.get(key)?.sharedWithTeam ?? false,
      });
    }

    return ownMachines
      .map((machine) => ({
        id: machine.id,
        name: machine.name || machine.id,
        os: machine.os || undefined,
        isOnline: onlineMachineIds.has(machine.id),
        sharedWithTeam: machineIndex.accessByMachineId.get(machine.id)?.sharedWithTeam ?? false,
        agents: (agentsByMachine.get(machine.id) ?? []).sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
        directories: (directoriesByMachine.get(machine.id) ?? []).sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
      }))
      .sort((left, right) => {
        if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }, [
    allAgentConfigs,
    machineIndex.accessByMachineId,
    onlineMachineIds,
    ownMachines,
    projectIndex,
  ]);

  return (
    <AccountMachinesOverviewView
      items={items}
      loading={machineIndex.isLoading || projectIndex.isLoading}
      currentMachineId={isElectronRenderer() ? localMachineId : null}
      onConfigureAgents={(machineId) => openSettings('agents', { machineId })}
      onManageMachine={(machineId) => openSettings('machines', { machineId })}
      onOpenDirectory={(machineId, projectKey) =>
        openSettings('projects', { machineId, projectKey })
      }
      onOpenDirectories={(machineId) => openSettings('projects', { machineId })}
    />
  );
}

export function AccountMachinesOverviewView({
  items,
  loading = false,
  currentMachineId,
  onConfigureAgents,
  onManageMachine,
  onOpenDirectory,
  onOpenDirectories,
}: {
  items: AccountMachineOverviewItem[];
  loading?: boolean;
  currentMachineId?: MachineId | null;
  onConfigureAgents: (machineId: MachineId) => void;
  onManageMachine: (machineId: MachineId) => void;
  onOpenDirectory: (machineId: MachineId, projectKey: string) => void;
  onOpenDirectories: (machineId: MachineId) => void;
}) {
  const { t } = useTranslation();
  const [expandedMachineIds, setExpandedMachineIds] = useState<Set<MachineId>>(() => new Set());

  const toggleDirectories = (machineId: MachineId) => {
    setExpandedMachineIds((previous) => {
      const next = new Set(previous);
      if (next.has(machineId)) next.delete(machineId);
      else next.add(machineId);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={250}>
      <section className="mx-3 overflow-hidden rounded-xl border border-border/60 bg-card/60 md:mx-0 md:rounded-lg">
        <header className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-3 py-2.5">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-muted-foreground">
              {t('settings.account.machines.title', 'My machines')}
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/85">
              {t(
                'settings.account.machines.description',
                'Machines connected by you, with their Agents and shared directories.'
              )}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label={t('settings.account.machines.privacyHelpLabel', 'About private access')}
              >
                <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-72 leading-relaxed">
              {t(
                'settings.account.machines.privacyHelp',
                'Conversations on a private machine, and conversations in private directories on a shared machine, are not visible to other workspace members.'
              )}
            </TooltipContent>
          </Tooltip>
        </header>

        <div className="hidden cursor-default select-none grid-cols-[minmax(180px,1fr)_100px_180px_140px_32px] items-center gap-3 border-b border-border/50 px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 md:grid">
          <span>{t('settings.account.machines.machineColumn', 'Machine')}</span>
          <span>{t('settings.account.machines.accessColumn', 'Access')}</span>
          <span>{t('settings.account.machines.agentsColumn', 'Agents')}</span>
          <span>{t('settings.account.machines.directoriesColumn', 'Directories')}</span>
          <span className="sr-only">{t('settings.account.machines.actionsColumn', 'Actions')}</span>
        </div>

        {loading && items.length === 0 ? (\n          <div className=\"flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground\">\n            <Loader2 className=\"h-3.5 w-3.5 animate-spin\" />\n            {t('workspace.machines.loadingVisibility', 'Loading machines')}\n          </div>\n        ) : items.length === 0 ? (\n          <div className=\"px-3 py-8 text-center text-xs text-muted-foreground\">\n            {t('workspace.machines.empty', 'No machines connected')}\n          </div>\n        ) : (\n          items.map((item, index) => {\n            const expanded = expandedMachineIds.has(item.id);\n            return (\n              <div key={item.id} className={cn(index > 0 && 'border-t border-border/50')}>\n                <div className=\"grid min-w-0 grid-cols-1 gap-3 px-3 py-3 md:grid-cols-[minmax(180px,1fr)_100px_180px_140px_32px] md:items-center\">\n                  <div className=\"flex min-w-0 items-center gap-3.5\">\n                    <span\n                      className={cn(\n                        'h-2 w-2 shrink-0 rounded-full ring-4',\n                        item.isOnline\n                          ? 'bg-status-success ring-status-success/20'\n                          : 'bg-muted-foreground/45 ring-muted'\n                      )}\n                      aria-hidden=\"true\"\n                    />\n                    <div className=\"min-w-0\">\n                      <div className=\"flex min-w-0 items-center gap-1.5\">\n                        <button\n                          type=\"button\"\n                          onClick={() => onManageMachine(item.id)}\n                          className=\"min-w-0 truncate rounded-sm text-start text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring\"\n                        >\n                          {item.name}\n                        </button>\n                        {item.id === currentMachineId ? (\n                          <Badge\n                            variant=\"secondary\"\n                            className=\"shrink-0 px-1.5 py-0 text-[10px] font-medium text-muted-foreground\"\n                          >\n                            {t('settings.account.machines.localMachine', 'This machine')}\n                          </Badge>\n                        ) : null}\n                      </div>\n                      <p className=\"truncate text-[11px] text-muted-foreground\">\n                        {item.isOnline\n                          ? t('workspace.machines.online', 'Online')\n                          : t('workspace.machines.offline', 'Offline')}\n                        {item.os ? ` · ${item.os}` : ''}\n                      </p>\n                    </div>\n                    <div className=\"ms-auto md:hidden\">\n                      <AccessStatus sharedWithTeam={item.sharedWithTeam} scope=\"machine\" />\n                    </div>\n                  </div>\n\n                  <div className=\"hidden md:block\">\n                    <AccessStatus sharedWithTeam={item.sharedWithTeam} scope=\"machine\" />\n                  </div>\n\n                  <AgentStackButton\n                    agents={item.agents}\n                    onClick={() => onConfigureAgents(item.id)}\n                  />\n\n                  <Button\n                    type=\"button\"\n                    variant=\"ghost\"\n                    size=\"sm\"\n                    className=\"h-8 justify-between gap-2 bg-foreground/[0.04] px-2 text-xs hover:bg-foreground/[0.08]\"\n                    onClick={() => toggleDirectories(item.id)}\n                    aria-expanded={expanded}\n                  >\n                    <span className=\"flex min-w-0 items-center gap-1.5\">\n                      <Folder className=\"h-3.5 w-3.5 shrink-0\" strokeWidth={1.75} />\n                      <span className=\"truncate text-start\">\n                        {t('settings.account.machines.directoryCount', {\n                          count: item.directories.length,\n                          defaultValue: '{{count}} directories',\n                        })}\n                      </span>\n                    </span>\n                    <ChevronDown\n                      className={cn(\n                        'h-3.5 w-3.5 shrink-0 transition-transform',\n                        expanded && 'rotate-180'\n                      )}\n                    />\n                  </Button>\n\n                  <Tooltip>\n                    <TooltipTrigger asChild>\n                      <Button\n                        type=\"button\"\n                        variant=\"ghost\"\n                        size=\"icon\"\n                        className=\"hidden h-8 w-8 text-muted-foreground md:inline-flex\"\n                        onClick={() => onManageMachine(item.id)}\n                        aria-label={t('settings.account.machines.manageMachine', {\n                          name: item.name,\n                          defaultValue: 'Manage {{name}}',\n                        })}\n                      >\n                        <MonitorCog className=\"h-4 w-4\" strokeWidth={1.75} />\n                      </Button>\n                    </TooltipTrigger>\n                    <TooltipContent>\n                      {t('settings.account.machines.manageMachineShort', 'Machine settings')}\n                    </TooltipContent>\n                  </Tooltip>\n                </div>\n\n                {expanded ? (\n                  <div className=\"border-t border-border/50 bg-foreground/[0.018] px-3 py-2.5\">\n                    {item.directories.length === 0 ? (\n                      <div className=\"flex items-center justify-between gap-3 py-1 text-xs text-muted-foreground\">\n                        <span>\n                          {t(\n                            'settings.machines.noConnectedFolders',\n                            'No connected folders on this machine.'\n                          )}\n                        </span>\n                        <Button\n                          variant=\"ghost\"\n                          size=\"sm\"\n                          className=\"h-7 text-xs\"\n                          onClick={() => onOpenDirectories(item.id)}\n                        >\n                          {t('settings.account.machines.openProjects', 'Open Projects')}\n                        </Button>\n                      </div>\n                    ) : (\n                      <div className=\"space-y-1\">\n                        {item.directories.map((directory) => (\n                          <button\n                            key={directory.key}\n                            type=\"button\"\n                            onClick={() => onOpenDirectory(item.id, directory.key)}\n                            className=\"flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring\"\n                          >\n                            <Folder\n                              className=\"h-3.5 w-3.5 shrink-0 text-muted-foreground\"\n                              strokeWidth={1.75}\n                            />\n                            <span className=\"min-w-0 flex-1\">\n                              <span className=\"block truncate text-xs font-medium text-foreground\">\n                                {directory.name}\n                              </span>\n                              <span className=\"block truncate font-mono text-[10px] text-muted-foreground\">\n                                {directory.rootPath}\n                              </span>\n                            </span>\n                            <AccessStatus\n                              sharedWithTeam={directory.sharedWithTeam}\n                              scope=\"directory\"\n                            />\n                            <ChevronRight\n                              className=\"h-3.5 w-3.5 shrink-0 text-muted-foreground/60\"\n                              aria-hidden=\"true\"\n                            />\n                          </button>\n                        ))}\n                      </div>\n                    )}\n                  </div>\n                ) : null}\n              </div>\n            );\n          })\n        )}\n      </section>\n    </TooltipProvider>\n  );\n}\n\nfunction AgentStackButton({ agents, onClick }: { agents: AgentConfigMeta[]; onClick: () => void }) {\n  const { t } = useTranslation();\n  const visibleAgents = agents.slice(0, 3);\n  const hiddenCount = Math.max(0, agents.length - visibleAgents.length);\n  const names = agents.map((agent) => agent.name).join(', ');\n\n  return (\n    <Tooltip>\n      <TooltipTrigger asChild>\n        <Button\n          type=\"button\"\n          variant=\"ghost\"\n          size=\"sm\"\n          className=\"h-8 min-w-0 justify-between gap-2 bg-foreground/[0.04] px-2 hover:bg-foreground/[0.08]\"\n          onClick={onClick}\n          aria-label={t('settings.account.machines.configureAgents', 'Configure Agents')}\n        >\n          <span className=\"flex shrink-0 -space-x-1.5\" aria-hidden=\"true\">\n            {visibleAgents.length === 0 ? (\n              <span className=\"flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-muted-foreground\">\n                <Bot className=\"h-3 w-3\" strokeWidth={1.75} />\n              </span>\n            ) : (\n              visibleAgents.map((agent) => (\n                <span\n                  key={agent.id}\n                  className=\"flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-background text-foreground\"\n                >\n                  <AgentIcon\n                    cliType={agent.cliType}\n                    agentType={agent.agentType}\n                    brandId={agent.brandId}\n                    env={agent.env}\n                    className=\"h-3 w-3\"\n                  />\n                </span>\n              ))\n            )}\n            {hiddenCount > 0 ? (\n              <span className=\"flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-card bg-muted px-1 text-[9px] font-medium text-muted-foreground\">\n                +{hiddenCount}\n              </span>\n            ) : null}\n          </span>\n          <span className=\"ms-auto shrink-0 text-xs\">\n            {t('settings.account.machines.configureAgentsShort', 'Configure')}\n          </span>\n        </Button>\n      </TooltipTrigger>\n      <TooltipContent className=\"max-w-64\">\n        <p className=\"font-medium\">\n          {t('settings.account.machines.configureAgents', 'Configure Agents')}\n        </p>\n        <p className=\"mt-0.5 text-muted-foreground\">\n          {agents.length > 0\n            ? names\n            : t(\n                'settings.account.machines.noAgentsHint',\n                'No Agents are configured on this machine yet.'\n              )}\n        </p>\n      </TooltipContent>\n    </Tooltip>\n  );\n}\n\nfunction AccessStatus({\n  sharedWithTeam,\n  scope,\n}: {\n  sharedWithTeam: boolean;\n  scope: 'machine' | 'directory';\n}) {\n  const { t } = useTranslation();\n  const Icon = sharedWithTeam ? Users : LockKeyhole;\n  const label = sharedWithTeam\n    ? t('workspace.machines.shared', 'Shared')\n    : t('workspace.machines.private', 'Private');\n  const description = sharedWithTeam\n    ? scope === 'machine'\n      ? t(\n          'workspace.machines.sharedTooltip',\n          'Workspace members can access this machine. Only the machine owner can change sharing.'\n        )\n      : t(\n          'settings.account.machines.sharedDirectoryTooltip',\n          'Workspace members can access this directory.'\n        )\n    : scope === 'machine'\n      ? t(\n          'settings.account.machines.privateMachineTooltip',\n          'Only you can access this machine. Its conversations are not visible to other workspace members.'\n        )\n      : t(\n          'settings.account.machines.privateDirectoryTooltip',\n          'Only you can access this directory. Its conversations are not visible to other workspace members.'\n        );\n\n  return (\n    <Tooltip>\n      <TooltipTrigger asChild>\n        <span\n          className=\"inline-flex shrink-0 cursor-default select-none items-center gap-1 rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground\"\n          aria-label={`${label}. ${description}`}\n        >\n          <Icon className=\"h-3 w-3\" strokeWidth={1.75} aria-hidden=\"true\" />\n          {label}\n        </span>\n      </TooltipTrigger>\n      <TooltipContent className=\"max-w-64 leading-relaxed\">{description}</TooltipContent>\n    </Tooltip>\n  );\n}\n