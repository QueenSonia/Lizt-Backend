import { Injectable } from '@nestjs/common';

// In-memory presence map: accountId → set of currently connected socket ids.
// "Active" means the account has at least one live socket on the chat
// namespace, which in practice maps to "user has the dashboard tab open"
// because the LandlordRealtimeProvider (and FM equivalent) opens this socket
// on layout mount and closes it on tab close.
//
// Single-instance only. If we ever horizontally scale the WS gateway, swap
// this for a Redis SET keyed by accountId; the interface stays the same.
@Injectable()
export class ChatPresenceService {
  private readonly connected = new Map<string, Set<string>>();

  add(accountId: string, socketId: string): void {
    const set = this.connected.get(accountId) ?? new Set<string>();
    set.add(socketId);
    this.connected.set(accountId, set);
  }

  remove(accountId: string, socketId: string): void {
    const set = this.connected.get(accountId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.connected.delete(accountId);
  }

  isActive(accountId: string): boolean {
    const set = this.connected.get(accountId);
    return !!set && set.size > 0;
  }
}
