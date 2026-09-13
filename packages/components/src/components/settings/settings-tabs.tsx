import { useAtomValue } from 'jotai';
import { promptShortcutsFeatureEnabledAtom } from '@/atoms/settings';
import type { LucideIcon } from 'lucide-react';
import type { PlatformCapability } from '@lody/platform';
import { useAppCapabilityCheck } from '../../lib/app-platform';
import {
  Bot,
  Building2,
  ChartNoAxesCombined,
  CreditCard,
  FolderOpen,
  Github,
  Info,
  Keyboard,
  Monitor,
  Palette,
  Plug,
  FileText,
  SlidersHorizontal,
  UserRound,
  UserRoundCog,
} from 'lucide-react';

export type SettingsSectionId = 'account' | 'personal' | 'workspace' | 'other';

export type SettingsTabId =
  | 'account'
  | 'preferences'
  | 'appearance'
  | 'keyboard-shortcuts'
  | 'workspace'
  | 'people'
  | 'machines'
  | 'agents'
  | 'agent-roles'
  | 'prompt-shortcuts'
  | 'mcp'
  | 'projects'
  | 'github'
  | 'ai-usage'
  | 'billing'
  | 'about';

export type SettingsPath =
  | '/$workspaceName/settings/account'
  | '/$workspaceName/settings/preferences'
  | '/$workspaceName/settings/appearance'
  | '/$workspaceName/settings/keyboard-shortcuts'
  | '/$workspaceName/settings/workspace'
  | '/$workspaceName/settings/people'
  | '/$workspaceName/settings/machines'
  | '/$workspaceName/settings/agents'
  | '/$workspaceName/settings/agent-roles'
  | '/$workspaceName/settings/prompt-shortcuts'
  | '/$workspaceName/settings/mcp'
  | '/$workspaceName/settings/projects'
  | '/$workspaceName/settings/github'
  | '/$workspaceName/settings/ai-usage'
  | '/$workspaceName/settings/billing'
  | '/$workspaceName/settings/about';

export type SettingsTabConfig = {
  id: SettingsTabId;
  section: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** Cloud capability the whole tab depends on; the tab hides when missing. */
  capability?: PlatformCapability;
  /** The workspace machine inventory has no useful distinction in a solo workspace. */
  multiMemberOnly?: boolean;
  path: SettingsPath;
};

export const SETTINGS_DEFAULT_TAB: SettingsTabId = 'account';

export const SETTINGS_TAB_CONFIGS: SettingsTabConfig[] = [\n  {\n    id: 'account',\n    section: 'account',\n    labelKey: 'settings.tabs.account',\n    descriptionKey: 'settings.categories.account.description',\n    icon: UserRound,\n    capability: 'cloudAccount',\n    path: '/$workspaceName/settings/account',\n  },\n  {\n    id: 'preferences',\n    section: 'personal',\n    labelKey: 'settings.tabs.preferences',\n    descriptionKey: 'settings.categories.preferences.description',\n    icon: SlidersHorizontal,\n    path: '/$workspaceName/settings/preferences',\n  },\n  {\n    id: 'appearance',\n    section: 'personal',\n    labelKey: 'settings.tabs.appearance',\n    descriptionKey: 'settings.categories.appearance.description',\n    icon: Palette,\n    path: '/$workspaceName/settings/appearance',\n  },\n  {\n    id: 'keyboard-shortcuts',\n    section: 'personal',\n    labelKey: 'settings.tabs.keyboardShortcuts',\n    descriptionKey: 'settings.categories.keyboardShortcuts.description',\n    icon: Keyboard,\n    path: '/$workspaceName/settings/keyboard-shortcuts',\n  },\n  {\n    id: 'workspace',\n    section: 'workspace',\n    labelKey: 'settings.tabs.workspaceGeneral',\n    descriptionKey: 'settings.categories.workspace.description',\n    icon: Building2,\n    capability: 'cloudAccount',\n    path: '/$workspaceName/settings/workspace',\n  },\n  {\n    id: 'machines',\n    section: 'workspace',\n    labelKey: 'settings.tabs.machines',\n    descriptionKey: 'settings.categories.machines.description',\n    icon: Monitor,\n    multiMemberOnly: true,\n    path: '/$workspaceName/settings/machines',\n  },\n  {\n    id: 'agents',\n    section: 'workspace',\n    labelKey: 'settings.tabs.agents',\n    descriptionKey: 'settings.categories.agents.description',\n    icon: Bot,\n    path: '/$workspaceName/settings/agents',\n  },\n  {\n    // Beside Agents on purpose: a provider says how an agent starts, a Role\n    // says how one is used, and the two must not read as one editor.\n    id: 'agent-roles',\n    section: 'workspace',\n    labelKey: 'settings.tabs.agentRoles',\n    descriptionKey: 'settings.categories.agentRoles.description',\n    icon: UserRoundCog,\n    path: '/$workspaceName/settings/agent-roles',\n  },\n  {\n    id: 'mcp',\n    section: 'workspace',\n    labelKey: 'settings.tabs.mcp',\n    descriptionKey: 'settings.categories.mcp.description',\n    icon: Plug,\n    path: '/$workspaceName/settings/mcp',\n  },\n  {\n    id: 'prompt-shortcuts',\n    section: 'workspace',\n    labelKey: 'settings.tabs.promptShortcuts',\n    descriptionKey: 'settings.categories.promptShortcuts.description',\n    icon: FileText,\n    path: '/$workspaceName/settings/prompt-shortcuts',\n  },\n  {\n    id: 'projects',\n    section: 'workspace',\n    labelKey: 'settings.tabs.projects',\n    descriptionKey: 'settings.categories.projects.description',\n    icon: FolderOpen,\n    path: '/$workspaceName/settings/projects',\n  },\n  {\n    id: 'github',\n    section: 'workspace',\n    labelKey: 'settings.tabs.github',\n    descriptionKey: 'settings.categories.github.description',\n    icon: Github,\n    capability: 'githubIntegration',\n    path: '/$workspaceName/settings/github',\n  },\n  {\n    id: 'ai-usage',\n    section: 'workspace',\n    labelKey: 'settings.tabs.aiUsage',\n    descriptionKey: 'settings.categories.aiUsage.description',\n    icon: ChartNoAxesCombined,\n    capability: 'usageAnalytics',\n    path: '/$workspaceName/settings/ai-usage',\n  },\n  {\n    id: 'billing',\n    section: 'workspace',\n    labelKey: 'settings.tabs.billing',\n    descriptionKey: 'settings.categories.billing.description',\n    icon: CreditCard,\n    capability: 'billing',\n    path: '/$workspaceName/settings/billing',\n  },\n  {\n    id: 'about',\n    section: 'other',\n    labelKey: 'settings.tabs.about',\n    descriptionKey: 'settings.categories.about.description',\n    icon: Info,\n    path: '/$workspaceName/settings/about',\n  },\n];\n\nexport function useVisibleSettingsTabs(options?: {\n  includeMultiMemberOnly?: boolean;\n}): SettingsTabConfig[] {\n  const promptShortcutsEnabled = useAtomValue(promptShortcutsFeatureEnabledAtom);\n  const hasCapability = useAppCapabilityCheck();\n  const includeMultiMemberOnly = options?.includeMultiMemberOnly ?? true;\n  return SETTINGS_TAB_CONFIGS.filter(\n    (tab) =>\n      (tab.id !== 'prompt-shortcuts' || promptShortcutsEnabled) &&\n      (tab.capability === undefined ||\n        hasCapability(tab.capability) ||\n        ((tab.id === 'github' || tab.id === 'account') &&\n          typeof window !== 'undefined' &&\n          window.__LODY_ELECTRON__ === true)) &&\n      (!tab.multiMemberOnly || includeMultiMemberOnly)\n  );\n}\n\nexport function getActiveSettingsTabId(pathname: string): SettingsTabId | null {\n  const suffixes: Array<[string, SettingsTabId]> = [\n    ['/settings/account', 'account'],\n    ['/settings/preferences', 'preferences'],\n    ['/settings/general', 'preferences'],\n    ['/settings/appearance', 'appearance'],\n    ['/settings/keyboard-shortcuts', 'keyboard-shortcuts'],\n    ['/settings/my-machines', 'machines'],\n    ['/settings/workspace', 'workspace'],\n    ['/settings/people', 'workspace'],\n    ['/settings/machines', 'machines'],\n    ['/settings/devices', 'machines'],\n    ['/settings/agents', 'agents'],\n    ['/settings/agent-config', 'agents'],\n    ['/settings/agent-roles', 'agent-roles'],\n    ['/settings/prompt-shortcuts', 'prompt-shortcuts'],\n    ['/settings/mcp', 'mcp'],\n    ['/settings/projects', 'projects'],\n    ['/settings/github', 'github'],\n    ['/settings/ai-usage', 'ai-usage'],\n    ['/settings/stats', 'ai-usage'],\n    ['/settings/billing', 'billing'],\n    ['/settings/about', 'about'],\n  ];\n  return suffixes.find(([suffix]) => pathname.endsWith(suffix))?.[1] ?? null;\n}\n