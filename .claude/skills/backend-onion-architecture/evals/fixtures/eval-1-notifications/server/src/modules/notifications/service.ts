import type { NotificationsRepository } from './repository';
import { SlackWebhookNotifier } from '../../adapters/slack/webhook-notifier';

export class NotificationsService {
  private readonly slack = new SlackWebhookNotifier(process.env.SLACK_WEBHOOK_URL!);

  constructor(private readonly repository: NotificationsRepository) {}

  async notifyReviewComplete(workspaceId: string, pullTitle: string) {
    const recent = await this.repository.findRecent(workspaceId, 5);
    const alreadySent = recent.some(
      (n) => n.kind === 'review-complete' && n.payload?.pullTitle === pullTitle,
    );
    if (alreadySent) return;
    await this.slack.send(`Review complete for ${pullTitle}`);
  }

  async markRead(workspaceId: string, notificationId: string) {
    await this.repository.markRead(workspaceId, notificationId);
  }
}
