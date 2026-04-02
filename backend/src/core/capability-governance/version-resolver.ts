import satisfies from 'semver/functions/satisfies';
import type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler } from './types';
import type { CapabilityGovernanceRegistry } from './governance-registry';

function resolveHandlerCompatibility(
  contract: CapabilityContract,
  handler: VersionedCapabilityHandler,
): void {
  if (!satisfies(contract.version, handler.supportedVersion)) {
    if (contract.compatibility.backwardCompatible) {
      return;
    }
    throw new Error(
      `Handler ${handler.plugin ?? handler.module ?? 'unknown'} incompatible with `
      + `${contract.name}@${contract.version} (supports ${handler.supportedVersion})`,
    );
  }
}

function validateRequirements(
  requirements: CapabilityRequirement[],
  registry: CapabilityGovernanceRegistry,
): void {
  for (const req of requirements) {
    const contract = registry.getContract(req.name);

    if (!contract) {
      if (req.mode === 'optional') continue;
      throw new Error(`Missing required capability: ${req.name}`);
    }

    if (!satisfies(contract.version, req.versionRange)) {
      throw new Error(
        `Capability ${req.name}@${contract.version} does not satisfy ${req.versionRange}`,
      );
    }

    if (contract.deprecated) {
      const sunsetInfo = contract.sunsetDate ? `, sunset: ${contract.sunsetDate}` : '';
      console.warn(`Capability "${req.name}" is deprecated${sunsetInfo}`);
    }

    if (contract.sunsetDate && new Date() > new Date(contract.sunsetDate)) {
      throw new Error(
        `Capability "${req.name}" has passed sunset date: ${contract.sunsetDate}`,
      );
    }
  }
}

export { resolveHandlerCompatibility, validateRequirements };