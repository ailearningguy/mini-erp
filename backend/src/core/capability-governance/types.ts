import type { z } from 'zod';
import type { CapabilityHandler } from '@core/capability/types';

interface CapabilityContract {
  name: string;
  version: string;
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  compatibility: {
    backwardCompatible: boolean;
  };
  deprecated?: boolean;
  sunsetDate?: string;
}

interface CapabilityRequirement {
  name: string;
  versionRange: string;
  mode: 'required' | 'optional';
}

interface VersionedCapabilityHandler extends CapabilityHandler {
  supportedVersion: string;
}

export type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler };