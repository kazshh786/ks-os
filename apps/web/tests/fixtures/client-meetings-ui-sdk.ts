import { Room as FixtureRoom } from './calls-ui-sdk';
export * from './calls-ui-sdk';
export class Room extends FixtureRoom {
  constructor(options: unknown) {
    super(options);
    const guest = window.location.pathname === '/meet';
    this.localParticipant.name = guest ? 'Alex Taylor' : 'Ada Patel';
    this.remoteParticipants.get('grace:session')!.name = guest ? 'Ada Patel' : 'Grace Morgan';
  }
}
