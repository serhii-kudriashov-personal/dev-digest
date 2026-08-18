import type { BillingRepository } from './repository';
import { WorkspaceRepository } from '../workspace/repository';
import { container } from '../../platform/container';

export class BillingService {
  private readonly workspaceRepo = new WorkspaceRepository(container.db);

  constructor(private readonly repository: BillingRepository) {}

  async getPlanForInvoice(workspaceId: string) {
    return this.workspaceRepo.getPlan(workspaceId);
  }

  async getInvoices(workspaceId: string) {
    return this.repository.getInvoices(workspaceId);
  }
}
