// Only the native UI visual test resolves this mock. Real media has a separate LiveKit test.
export const ConnectionState={Disconnected:'disconnected',Connecting:'connecting',Connected:'connected',Reconnecting:'reconnecting',SignalReconnecting:'signalReconnecting'};
export const Track={Kind:{Audio:'audio',Video:'video'},Source:{Camera:'camera',ScreenShare:'screen_share'}};
export const RoomEvent=Object.fromEntries(['ConnectionStateChanged','Disconnected','MediaDevicesError','ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','ActiveSpeakersChanged','ConnectionQualityChanged','AudioPlaybackStatusChanged','ParticipantNameChanged'].map(name=>[name,name]));
function videoTrack(label:string,share=false){
 const canvas=document.createElement('canvas');canvas.width=share?960:640;canvas.height=share?540:400;
 const context=canvas.getContext('2d')!;context.fillStyle=share?'#eef2ff':'#dbeafe';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#334155';context.font='32px sans-serif';context.fillText(label,40,90);
 if(share){context.font='22px sans-serif';for(const [index,text]of ['Priorities for this week','1. Review design concepts','2. Gather team feedback','3. Agree the next milestone'].entries())context.fillText(text,40,160+index*65);}
 const stream=canvas.captureStream(2);
 return{kind:'video',attach(element:HTMLMediaElement){element.srcObject=stream;void element.play().catch(()=>{});return element;},detach(element?:HTMLMediaElement){if(element)element.srcObject=null;},stop(){stream.getTracks().forEach(track=>track.stop());}};
}
class Participant{
 identity:string;name:string;isLocal:boolean;isMicrophoneEnabled=false;isCameraEnabled=false;isScreenShareEnabled=false;isSpeaking=false;connectionQuality='excellent';audioTrackPublications=new Map();publications=new Map();
 constructor(identity:string,name:string,isLocal:boolean){this.identity=identity;this.name=name;this.isLocal=isLocal;}
 getTrackPublication(source:string){return this.publications.get(source);}
 async setMicrophoneEnabled(value:boolean){this.isMicrophoneEnabled=value;}
 async setCameraEnabled(value:boolean){this.isCameraEnabled=value;if(value)this.publications.set('camera',{track:videoTrack(this.name),isMuted:false});else{this.publications.get('camera')?.track.stop();this.publications.delete('camera');}}
 async setScreenShareEnabled(value:boolean){this.isScreenShareEnabled=value;if(value)this.publications.set('screen_share',{track:videoTrack('Quarterly plan',true),isMuted:false});else{this.publications.get('screen_share')?.track.stop();this.publications.delete('screen_share');}}
 stop(){for(const publication of this.publications.values())publication.track.stop();}
}
export class Room{
 state='disconnected';canPlaybackAudio=true;localParticipant=new Participant('ada:session','Ada Lovelace',true);remoteParticipants=new Map([['grace:session',new Participant('grace:session','Grace Hopper',false)]]);listeners=new Map<string,Set<(...args:any[])=>void>>();
 constructor(_options:unknown){}
 on(event:string,listener:(...args:any[])=>void){const set=this.listeners.get(event)||new Set();set.add(listener);this.listeners.set(event,set);return this;}
 emit(event:string,...args:any[]){for(const listener of this.listeners.get(event)||[])listener(...args);}
 removeAllListeners(){this.listeners.clear();}
 async connect(){await this.remoteParticipants.get('grace:session')!.setCameraEnabled(true);this.remoteParticipants.get('grace:session')!.isSpeaking=true;this.state='connected';this.emit('ConnectionStateChanged',this.state);}
 async disconnect(){this.localParticipant.stop();for(const participant of this.remoteParticipants.values())participant.stop();this.state='disconnected';}
 async switchActiveDevice(){return true;}async startAudio(){}
 static async getLocalDevices(){return[{kind:'audioinput',deviceId:'microphone',label:'Built-in microphone'},{kind:'videoinput',deviceId:'camera',label:'Front camera'},{kind:'audiooutput',deviceId:'speaker',label:'Built-in speakers'}];}
}
export async function createLocalTracks(options:{video:boolean|object;audio:boolean|object}){return options.video?[videoTrack('Your camera preview')]:[];}

