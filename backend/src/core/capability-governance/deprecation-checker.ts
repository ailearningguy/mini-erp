import type { CapabilityContract } from './types';

function checkDeprecations(contracts: CapabilityContract[]): void {
  const now = new Date();

  for (const contract of contracts) {
    if (!contract.deprecated) continue;

    const sunsetInfo = contract.sunsetDate ? `, sunset: ${contract.sunsetDate}` : '';
    console.warn(`Capability "${contract.name}@${contract.version}" is deprecated${sunsetInfo}`);

    if (contract.sunsetDate && now > new Date(contract.sunsetDate)) {
      throw new Error(
        `Capability "${contract.name}@${contract.version}" has passed sunset date: ${contract.sunsetDate}. `
        + 'Remove all dependencies on this capability before proceeding.',
      );
    }
  }
}

export { checkDeprecations };