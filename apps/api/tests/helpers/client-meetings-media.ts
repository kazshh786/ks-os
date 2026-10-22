import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { LiveKitProvider, type MeetingMediaProvider } from '../../src/modules/communications/communications.livekit.js';

// Public, disposable fixture credentials; never inherit a deployed endpoint or key.
export const mediaEnvironment = {
  NODE_ENV: 'test', LIVEKIT_ENABLED: 'true', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_URL: 'http://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'ksos-test-key', LIVEKIT_API_SECRET: 'ksos-isolated-test-secret-never-production-2026',
};
export const clientMeetingEnvironment = {
  MEETING_INVITATION_SECRET: 'ksos-isolated-invitation-secret-never-production-2026',
  PUBLIC_MEETING_ORIGIN: 'http://127.0.0.1:5173',
};

/** Only media network state is simulated. Token signing and webhook authentication are real. */
export class ClientMeetingTestMedia implements MeetingMediaProvider {
  private readonly signer = new LiveKitProvider(mediaEnvironment);
  readonly enabled = true;
  readonly url = mediaEnvironment.LIVEKIT_URL;
  readonly participantLimit = 4;
  readonly tokenTtlSeconds = this.signer.tokenTtlSeconds;
  readonly liveRooms = new Map<string, { sid: string; members: Map<string, string> }>();
  readonly removals: string[] = [];
  readonly issued: { room: string; identity: string }[] = [];
  unavailable = false;
  async token(...args: Parameters<MeetingMediaProvider['token']>) {
    this.issued.push({ room: args[0], identity: args[1] });
    return this.signer.token(...args);
  }
  verify(raw: string, authorization: string) { return this.signer.verify(raw, authorization); }
  async createRoom(name: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    if (!this.liveRooms.has(name)) this.liveRooms.set(name, { sid: `RM_${randomUUID()}`, members: new Map() });
  }
  async deleteRoom(name: string) { if (this.unavailable) throw new Error('Media server unavailable'); this.liveRooms.delete(name); }
  async rooms() {
    if (this.unavailable) throw new Error('Media server unavailable');
    return [...this.liveRooms].map(([name, room]) => ({ name, sid: room.sid }));
  }
  async participants(name: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    return [...(this.liveRooms.get(name)?.members ?? [])].map(([identity, sid]) => ({ identity, sid }));
  }
  async removeParticipant(name: string, identity: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    this.removals.push(identity); this.liveRooms.get(name)?.members.delete(identity);
  }
  observeJoin(name: string, identity: string) {
    const room = this.liveRooms.get(name);
    assert.ok(room, 'A media room must be explicitly created before connecting');
    const sid = `PA_${randomUUID()}`;
    room.members.set(identity, sid);
    return { room: { name, sid: room.sid }, participant: { identity, sid } };
  }
}

export const mediaClaims = (token: string) => new TokenVerifier(mediaEnvironment.LIVEKIT_API_KEY, mediaEnvironment.LIVEKIT_API_SECRET).verify(token);
export async function signedMediaEvent(input: Record<string, unknown>) {
  const body = JSON.stringify({ id: `EV_${randomUUID()}`, createdAt: Math.floor(Date.now() / 1000), ...input });
  const signature = new AccessToken(mediaEnvironment.LIVEKIT_API_KEY, mediaEnvironment.LIVEKIT_API_SECRET, { ttl: 60 });
  signature.sha256 = createHash('sha256').update(body).digest('base64');
  return { body, authorization: await signature.toJwt() };
}
