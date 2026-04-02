import type { HookRegistration } from '@core/hooks/types';
import type { IPlugin } from '@core/plugin-system/plugin-loader';
import type { Express } from 'express';
import type { EventEnvelope } from '@shared/types/event';
import type { DIContainer } from '@core/di/container';

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  trusted: boolean;
  entry: string;
  dependencies?: string[];
  permissions?: {
    resource: string;
    actions: string[];
    scope?: string;
  }[];
}

interface PluginMetadata {
  name: string;
  version: string;
  enabled: boolean;
  trusted: boolean;
  dependencies: { name: string; version: string }[];
  entry: () => Promise<{ default: PluginFactory }>;
  manifest: PluginManifest;
}

interface PluginFactory {
  create(container: DIContainer): Promise<PluginDefinition>;
}

interface PluginDefinition {
  plugin: IPlugin;
  routes?: (app: Express) => void;
  schemas?: Record<string, unknown>;
  hooks?: HookRegistration[];
  eventHandlers?: {
    eventType: string;
    handler: (event: EventEnvelope) => Promise<void>;
  }[];
}

interface PluginRegistry {
  scan(): Promise<PluginMetadata[]>;
  resolve(mods: PluginMetadata[]): PluginMetadata[];
  getActive(): PluginMetadata[];
  refresh(): Promise<PluginMetadata[]>;
  getByName(name: string): PluginMetadata | undefined;
}

export type {
  PluginManifest,
  PluginMetadata,
  PluginFactory,
  PluginDefinition,
  PluginRegistry,
};