import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/events', // Use a separate namespace to avoid conflicts with chat gateway
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('EventsGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:property')
  async handleJoinProperty(
    @MessageBody() propertyId: string,
    @ConnectedSocket() client: Socket,
  ) {
    await this.joinPropertyRoom(client, propertyId);
    return { success: true, room: `property:${propertyId}` };
  }

  @SubscribeMessage('join:landlord')
  async handleJoinLandlord(
    @MessageBody() landlordId: string,
    @ConnectedSocket() client: Socket,
  ) {
    await this.joinLandlordRoom(client, landlordId);
    return { success: true, room: `landlord:${landlordId}` };
  }

  // Emit KYC submission event to landlords watching a specific property
  emitKYCSubmission(propertyId: string, landlordId: string, kycData: any) {
    this.logger.log(
      `Emitting KYC submission for property ${propertyId} to landlord ${landlordId}`,
    );

    // Emit to specific landlord room
    this.server.to(`landlord:${landlordId}`).emit('kyc:submitted', {
      propertyId,
      kycData,
      timestamp: new Date().toISOString(),
    });

    // Also emit to property-specific room for anyone viewing that property
    this.server.to(`property:${propertyId}`).emit('kyc:submitted', {
      propertyId,
      kycData,
      timestamp: new Date().toISOString(),
    });
  }

  // Allow clients to join property-specific rooms
  async joinPropertyRoom(client: Socket, propertyId: string) {
    await client.join(`property:${propertyId}`);
    this.logger.log(`Client ${client.id} joined property room: ${propertyId}`);
  }

  // Allow clients to join landlord-specific rooms
  async joinLandlordRoom(client: Socket, landlordId: string) {
    await client.join(`landlord:${landlordId}`);
    this.logger.log(`Client ${client.id} joined landlord room: ${landlordId}`);
  }
}
