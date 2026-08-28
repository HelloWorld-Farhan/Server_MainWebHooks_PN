import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { getClerkAuthorizedParties } from '../../auth/clerk-config';

@WebSocketGateway({
  cors: {
    origin: getClerkAuthorizedParties(),
    credentials: true,
  },
})
export class CampaignGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private static instance: CampaignGateway;

  constructor() {
    CampaignGateway.instance = this;
  }

  static getInstance(): CampaignGateway {
    return CampaignGateway.instance;
  }

  handleConnection(client: Socket) {
    // Client connected
    const companyId = client.handshake.query.companyId as string;
    if (companyId) {
      client.join(`company:${companyId}`);
    }
  }

  handleDisconnect(client: Socket) {
    // Client disconnected
  }

  broadcastCampaignUpdate(companyId: string, campaignState: any) {
    if (this.server) {
      this.server.to(`company:${companyId}`).emit('campaign-updated', campaignState);
    }
  }
}
