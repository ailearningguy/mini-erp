import { CapabilityRegistry } from '@core/capability/capability-registry';
import type { CapabilityContract, VersionedCapabilityHandler } from './types';
import { resolveHandlerCompatibility } from './version-resolver';

class CapabilityGovernanceRegistry extends CapabilityRegistry {
  private contracts = new Map<string, CapabilityContract>();

  registerContract(contract: CapabilityContract): void {
    this.contracts.set(contract.name, contract);

    this.registerCapability({
      name: contract.name,
      type: contract.type,
      stages: contract.stages,
    });
  }

  getContract(name: string): CapabilityContract | undefined {
    return this.contracts.get(name);
  }

  getAllContracts(): CapabilityContract[] {
    return [...this.contracts.values()];
  }

  registerVersionedHandler(handler: VersionedCapabilityHandler): void {
    const contract = this.contracts.get(handler.capability);

    if (contract) {
      resolveHandlerCompatibility(contract, handler);
    }

    this.registerHandler(handler);
  }

  override clear(): void {
    this.contracts.clear();
    super.clear();
  }
}

export { CapabilityGovernanceRegistry };