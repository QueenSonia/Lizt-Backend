export enum MessageStatus {
  SENT = 'SENT', // Successfully sent to Meta API
  DELIVERED = 'DELIVERED', // Delivered to user's device
  READ = 'READ', // Read by user
  FAILED = 'FAILED', // Failed to deliver
}
