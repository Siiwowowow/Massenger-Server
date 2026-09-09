import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, VideoGrant } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService implements OnModuleInit {
  private readonly logger = new Logger(LiveKitService.name);
  private url: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.url = this.configService.get<string>('livekit.url') || process.env.LIVEKIT_URL || 'ws://localhost:7880';
    this.apiKey = this.configService.get<string>('livekit.apiKey') || process.env.LIVEKIT_API_KEY || 'devkey';
    this.apiSecret = this.configService.get<string>('livekit.apiSecret') || process.env.LIVEKIT_API_SECRET || 'secret';
  }

  onModuleInit() {
    this.validateConfig();
    this.logger.log(`LiveKit service initialized with server URL: ${this.url}`);
  }

  /**
   * Validate that all required LiveKit configuration variables are present and valid.
   */
  public validateConfig(): void {
    if (!this.url || typeof this.url !== 'string') {
      throw new Error('LIVEKIT_URL configuration is missing or invalid');
    }
    if (!this.apiKey || typeof this.apiKey !== 'string') {
      throw new Error('LIVEKIT_API_KEY configuration is missing or invalid');
    }
    if (!this.apiSecret || typeof this.apiSecret !== 'string') {
      throw new Error('LIVEKIT_API_SECRET configuration is missing or invalid');
    }
  }

  /**
   * Get the configured LiveKit WebSocket server URL for client connections.
   */
  public getServerUrl(): string {
    return this.url;
  }

  /**
   * Deterministic, opaque room naming based purely on database internal ID.
   * Does NOT leak user names, emails, external IDs, or project secrets.
   */
  public generateRoomName(conversationId: string): string {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('Valid conversationId is required to generate room name');
    }
    return `call_${conversationId.trim()}`;
  }

  /**
   * Generate a secure participant access token with minimal permissions.
   * Explicitly avoids administrative room-management capabilities.
   *
   * @param participantIdentity Unique internal communication user ID
   * @param participantName Display name for the participant
   * @param roomName Deterministic target room name
   * @param ttl Token lifetime (defaults to '1h')
   */
  public async createParticipantToken(
    participantIdentity: string,
    participantName: string,
    roomName: string,
    ttl: string | number = '1h',
  ): Promise<string> {
    this.validateConfig();

    if (!participantIdentity) {
      throw new Error('participantIdentity is required for LiveKit token');
    }
    if (!roomName) {
      throw new Error('roomName is required for LiveKit token');
    }

    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participantIdentity,
      name: participantName || 'User',
      ttl,
    });

    const grant: VideoGrant = {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Explicitly non-administrative permissions:
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
    };

    token.addGrant(grant);

    return await token.toJwt();
  }
}
