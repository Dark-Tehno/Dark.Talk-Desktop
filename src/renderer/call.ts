import type { ActiveCallInfo, ScreenSource, User, WsEventMsg, WsState } from '../shared/types';
import * as api from './api';
import { S, myId } from './state';
import { avatar, h, icon, openModal, toast } from './ui';
import { callEndReasonText, t } from './util';

// Dark.Call client. Port of the Android CallManager: the backend only relays signaling over /ws/chats/,
// audio / video / screen go peer-to-peer (WebRTC). Protocol: see backend call/CALLS.md.
// Group calls are a mesh: one RTCPeerConnection ("link") per other participant; the participant who joined
// LATER creates the offer. A direct call is the same machinery with a single link and no `to_user_id`.

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface Peer {
  id: number;
  username: string;
  avatar?: string | null;
}

export interface Member extends Peer {
  video: boolean;
  screen: boolean;
  muted: boolean;
  link: 'connecting' | 'connected' | 'lost';
}

interface CallState {
  phase: CallPhase;
  callId: string | null;
  chatId: number | null;
  peer: Peer | null;
  isVideoCall: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  remoteVideoOn: boolean;
  remoteScreenShare: boolean;
  remoteMuted: boolean;
  connectedAt: number | null;
  endReason: string | null;
  group: boolean;
  chatTitle: string;
  members: Member[];
  maxParticipants: number;
}

const idle = (): CallState => ({
  phase: 'idle',
  callId: null,
  chatId: null,
  peer: null,
  isVideoCall: false,
  micMuted: false,
  cameraOn: false,
  screenSharing: false,
  remoteVideoOn: false,
  remoteScreenShare: false,
  remoteMuted: false,
  connectedAt: null,
  endReason: null,
  group: false,
  chatTitle: '',
  members: [],
  maxParticipants: 6,
});

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** One WebRTC connection to one remote participant. */
interface Link {
  id: number;
  pc: RTCPeerConnection;
  offerer: boolean; // I create the offer for this link (and own the video transceiver)
  videoSender: RTCRtpSender | null;
  pending: RTCIceCandidateInit[];
  stream: MediaStream;
  iceRestartDone: boolean;
  timer: number | null;
  chain: Promise<void>;
}

/** Active group calls per chat, fed by `call_group_state` and GET /call/api/active/ (banner "Join"). */
export const groupCalls = {
  map: new Map<number, ActiveCallInfo>(),
  listeners: new Set<(chatId: number) => void>(),
  set(chatId: number, info: ActiveCallInfo): void {
    if (info.active) this.map.set(chatId, info);
    else this.map.delete(chatId);
    this.listeners.forEach((l) => l(chatId));
  },
  get(chatId: number): ActiveCallInfo | undefined {
    return this.map.get(chatId);
  },
  subscribe(fn: (chatId: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

class CallController {
  state: CallState = idle();
  private listeners = new Set<() => void>();

  private links = new Map<number, Link>();
  private known = new Map<number, Peer>();
  private isCaller = false;
  private clientCallId: string | null = null;
  private pendingCancelClientId: string | null = null;
  private iceServers: RTCIceServer[] = FALLBACK_ICE;
  private audioStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private cameraPromise: Promise<void> | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  /** Remote stream of a direct call (kept stable so the video element can be bound once). */
  readonly remoteStream = new MediaStream();
  readonly localPreview = new MediaStream();
  private pingTimer: number | null = null;
  private watchdog: number | null = null;
  private endedTimer: number | null = null;
  private lostSocketInCall = false;
  private socketUp = false;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<CallState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  get busy(): boolean {
    return this.state.phase !== 'idle' && this.state.phase !== 'ended';
  }

  /** Remote media stream of a group member (for the tile's <video>). */
  streamOf(id: number): MediaStream | null {
    return this.links.get(id)?.stream ?? null;
  }

  /** Lets the room hand over the chat's participants so tiles have names/avatars. */
  seedUsers(users: Array<{ id: number; username: string; avatar?: string | null }>): void {
    for (const u of users) if (u?.id != null) this.known.set(u.id, { id: u.id, username: u.username ?? '?', avatar: u.avatar });
  }

  // ------------------------------------------------------------ signaling transport

  private send(type: string, fields: Record<string, unknown> = {}): boolean {
    void window.dt.ws.sendCall({ type, ...fields }).then((ok) => {
      if (!ok) this.onSendFailed(type);
    });
    return this.socketUp;
  }

  /** Signaling addressed to one participant: groups need `to_user_id`, direct calls don't. */
  private sendTo(link: Link, type: string, fields: Record<string, unknown> = {}): void {
    this.send(type, { call_id: this.state.callId, ...(this.state.group ? { to_user_id: link.id } : {}), ...fields });
  }

  private onSendFailed(type: string): void {
    if (type === 'call_invite' && this.state.phase === 'outgoing' && !this.state.callId) this.finish('no_connection');
  }

  onSocketState(state: WsState): void {
    const up = state === 'connected';
    if (up === this.socketUp) return;
    this.socketUp = up;
    const phase = this.state.phase;
    if (!up) {
      if (phase === 'outgoing' || phase === 'incoming') this.finish('connection_lost');
      else if (phase === 'connecting' || phase === 'active') this.lostSocketInCall = true; // media is direct, wait for the socket
    } else if (this.lostSocketInCall && (phase === 'connecting' || phase === 'active')) {
      this.lostSocketInCall = false;
      this.sendPing();
      for (const l of this.links.values()) if (l.offerer) void this.sendOffer(l, true);
      if (this.state.group) void this.resync();
    }
  }

  /** Group: after a socket gap we may have missed joins/leaves; compare with the server's list. */
  private async resync(): Promise<void> {
    const s = this.state;
    if (!s.group || !s.chatId || !s.callId) return;
    const r = await api.getActiveCall(s.chatId);
    if (!r.ok || this.state.callId !== s.callId) return;
    if (!r.data.active || r.data.call_id !== s.callId) return; // call_ended / call_error will tell us
    const ids = new Set((r.data.participants ?? []).filter((x) => x !== myId()));
    for (const id of Array.from(this.links.keys())) {
      if (!ids.has(id)) this.dropMember(id);
    }
    for (const id of ids) {
      if (this.links.has(id)) continue;
      // joined while we were offline and their offer never reached us: offer to them (tie-break handles collisions)
      this.addMember(id);
      const link = await this.createLink(id, true);
      if (link) await this.sendOffer(link, false);
    }
  }

  // ------------------------------------------------------------ public commands

  async start(chatId: number, peer: Peer, video: boolean): Promise<void> {
    if (this.state.phase === 'ended') this.reset();
    if (this.state.phase !== 'idle') return;
    if (!(await this.ensureMic())) {
      this.showEnded('no_permission', chatId, peer);
      return;
    }
    this.clientCallId = crypto.randomUUID();
    this.pendingCancelClientId = null;
    this.isCaller = true;
    this.set({ ...idle(), phase: 'outgoing', chatId, peer, isVideoCall: video });
    if (!this.socketUp) {
      this.finish('no_connection');
      return;
    }
    this.send('call_invite', { chat_id: chatId, media: video ? 'video' : 'audio', client_call_id: this.clientCallId });
    Sounds.ringback();
    void this.loadIceServers();
  }

  async startGroup(chatId: number, title: string, video: boolean, users: Peer[]): Promise<void> {
    if (this.state.phase === 'ended') this.reset();
    if (this.state.phase !== 'idle') return;
    this.seedUsers(users);
    if (!(await this.ensureMic())) {
      this.showEnded('no_permission', chatId, null);
      return;
    }
    this.clientCallId = crypto.randomUUID();
    this.pendingCancelClientId = null;
    this.isCaller = true;
    this.set({ ...idle(), phase: 'outgoing', chatId, isVideoCall: video, group: true, chatTitle: title });
    if (!this.socketUp) {
      this.finish('no_connection');
      return;
    }
    this.send('call_invite', { chat_id: chatId, media: video ? 'video' : 'audio', client_call_id: this.clientCallId });
    Sounds.ringback();
    void this.loadIceServers();
    if (video) void this.startCamera();
  }

  /** Join an already running group call from the chat banner. */
  async join(chatId: number, callId: string, title: string, video: boolean, users: Peer[]): Promise<void> {
    if (this.state.phase === 'ended') this.reset();
    if (this.state.phase !== 'idle') return;
    this.seedUsers(users);
    if (!(await this.ensureMic())) {
      this.showEnded('no_permission', chatId, null);
      return;
    }
    if (!this.socketUp) {
      this.showEnded('no_connection', chatId, null);
      return;
    }
    this.isCaller = false;
    this.set({ ...idle(), phase: 'connecting', callId, chatId, isVideoCall: video, group: true, chatTitle: title, maxParticipants: groupCalls.get(chatId)?.max_participants ?? 6 });
    await this.enterGroup(callId, video);
  }

  private async enterGroup(callId: string, video: boolean): Promise<void> {
    await this.loadIceServers();
    if (video) void this.startCamera();
    this.send('call_accept', { call_id: callId });
    this.startPing();
    this.startWatchdog(40_000);
  }

  async accept(): Promise<void> {
    const s = this.state;
    if (s.phase !== 'incoming' || !s.callId) return;
    if (!(await this.ensureMic())) {
      this.send('call_reject', { call_id: s.callId });
      this.finish('no_permission');
      return;
    }
    if (this.state.phase !== 'incoming') return; // cancelled while the permission dialog was open
    Sounds.stop();
    this.isCaller = false;
    this.set({ phase: 'connecting' });
    if (s.group) {
      await this.enterGroup(s.callId, s.isVideoCall);
      return;
    }
    await this.loadIceServers();
    await this.createLink(s.peer!.id, false);
    this.send('call_accept', { call_id: s.callId });
    this.startPing();
    this.startWatchdog(40_000);
  }

  reject(): void {
    const s = this.state;
    if (s.phase === 'incoming' && s.callId) {
      this.send('call_reject', { call_id: s.callId });
      this.finish('rejected');
    }
  }

  hangUp(): void {
    const s = this.state;
    switch (s.phase) {
      case 'idle':
      case 'ended':
        return;
      case 'incoming':
        return this.reject();
      default:
        if (s.callId) this.send('call_end', { call_id: s.callId });
        else this.pendingCancelClientId = this.clientCallId; // call_ringing not received yet: cancel when it arrives
        this.finish(s.phase === 'outgoing' ? 'cancelled' : 'hangup');
    }
  }

  toggleMute(): void {
    const muted = !this.state.micMuted;
    this.audioStream?.getAudioTracks().forEach((tr) => (tr.enabled = !muted));
    this.set({ micMuted: muted });
    this.sendMediaState();
  }

  private get inMedia(): boolean {
    return this.state.phase === 'connecting' || this.state.phase === 'active' || (this.state.group && this.state.phase === 'outgoing');
  }

  async toggleCamera(): Promise<void> {
    if (!this.inMedia) return;
    if (this.state.cameraOn) {
      this.stopCamera();
      await this.restoreVideoSource();
      this.set({ cameraOn: false });
      this.sendMediaState();
      return;
    }
    if (this.state.screenSharing) this.stopScreen(false);
    await this.startCamera();
  }

  async toggleScreen(): Promise<void> {
    if (!this.inMedia) return;
    if (this.state.screenSharing) {
      this.stopScreen(true);
      return;
    }
    const sources = await window.dt.screen.sources();
    const pick = await pickScreenSource(sources);
    if (!pick) return;
    await window.dt.screen.select(pick.id);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      this.stopCamera();
      this.screenTrack = track;
      track.onended = () => this.stopScreen(true);
      await this.setVideoSource(track);
      this.set({ screenSharing: true, cameraOn: false });
      this.sendMediaState();
    } catch {
      toast(t('noDevices'), 'error');
    }
  }

  // ------------------------------------------------------------ members (group tiles)

  private lookup(id: number): Peer {
    return this.known.get(id) ?? { id, username: `#${id}`, avatar: null };
  }

  private addMember(id: number, info?: Partial<Peer>): void {
    if (id === myId()) return;
    if (info?.username) this.known.set(id, { id, username: info.username, avatar: info.avatar });
    const existing = this.state.members.find((m) => m.id === id);
    if (existing) return;
    const p = this.lookup(id);
    this.set({ members: [...this.state.members, { ...p, video: false, screen: false, muted: false, link: 'connecting' }] });
    if (!this.known.has(id) || this.known.get(id)!.username.startsWith('#')) void this.resolveNames();
  }

  private patchMember(id: number, patch: Partial<Member>): void {
    if (!this.state.members.some((m) => m.id === id)) return;
    this.set({ members: this.state.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }

  /** Fill in names we don't know yet from the cached chat list. */
  private async resolveNames(): Promise<void> {
    const chatId = this.state.chatId;
    if (!chatId) return;
    try {
      const chats = await window.dt.cache.chats();
      const chat = chats.find((c) => c.id === chatId);
      for (const p of chat?.participants ?? []) if (p.user) this.known.set(p.user.id, { id: p.user.id, username: p.user.username, avatar: p.user.avatar });
    } catch {
      return;
    }
    this.set({ members: this.state.members.map((m) => ({ ...m, ...this.lookup(m.id) })) });
  }

  private dropMember(id: number): void {
    this.closeLink(id);
    this.set({ members: this.state.members.filter((m) => m.id !== id) });
  }

  // ------------------------------------------------------------ server events

  handleEvent(e: WsEventMsg): void {
    if (!e.type.startsWith('call_')) return;
    if (e.type === 'call_group_state') {
      const chatId = Number(e.chat_id);
      if (chatId) groupCalls.set(chatId, { active: !!e.active, call_id: e.call_id, participants: e.participants, media: e.media, max_participants: e.max_participants });
      return;
    }
    const s = this.state;
    const callId = (e.call_id as string | undefined) ?? null;
    switch (e.type) {
      case 'call_incoming': {
        if (!callId || callId === s.callId) return;
        if (s.phase === 'ended') this.reset();
        const c = e.caller as User | undefined;
        if (this.state.phase !== 'idle') {
          if (!e.group) this.send('call_reject', { call_id: callId }); // already busy on this device
          return;
        }
        if (e.group) {
          const inCall = (e.participants as User[] | undefined) ?? [];
          this.seedUsers(inCall);
          if (c) this.seedUsers([c]);
          this.isCaller = false;
          this.set({
            ...idle(),
            phase: 'incoming',
            callId,
            chatId: Number(e.chat_id),
            peer: c ? { id: c.id, username: c.username ?? '?', avatar: c.avatar } : null,
            isVideoCall: e.media === 'video',
            group: true,
            chatTitle: String(e.chat_title ?? ''),
            members: inCall.filter((u) => u.id !== myId()).map((u) => ({ id: u.id, username: u.username ?? '?', avatar: u.avatar, video: false, screen: false, muted: false, link: 'connecting' as const })),
            maxParticipants: Number(e.max_participants ?? 6),
          });
          Sounds.ringtone();
          this.notifyIncoming();
          break;
        }
        if (!c) return;
        this.isCaller = false;
        this.set({
          ...idle(),
          phase: 'incoming',
          callId,
          chatId: Number(e.chat_id),
          peer: { id: c.id, username: c.username ?? '?', avatar: c.avatar },
          isVideoCall: e.media === 'video',
        });
        Sounds.ringtone();
        this.notifyIncoming();
        break;
      }
      case 'call_ringing': {
        const cid = e.client_call_id as string | undefined;
        if (this.pendingCancelClientId && cid === this.pendingCancelClientId) {
          this.pendingCancelClientId = null;
          if (callId) this.send('call_end', { call_id: callId });
          return;
        }
        if (s.phase === 'outgoing' && !s.callId && cid === this.clientCallId) this.set({ callId });
        break;
      }
      case 'call_accepted': {
        if (callId !== s.callId) return;
        if (s.group) {
          if (s.phase === 'incoming') this.finish('answered_elsewhere');
          else if (s.phase === 'connecting' || s.phase === 'active') {
            // I joined: connect to everyone who was already in the call, I create the offers.
            const list = (e.participants as User[] | undefined) ?? [];
            if (e.max_participants) this.set({ maxParticipants: Number(e.max_participants) });
            for (const u of list) {
              this.addMember(u.id, u);
              void this.createLink(u.id, true).then((l) => l && this.sendOffer(l, false));
            }
          }
          break;
        }
        if (s.phase === 'incoming') this.finish('answered_elsewhere');
        else if (s.phase === 'outgoing' && this.isCaller) {
          Sounds.stop();
          this.set({ phase: 'connecting' });
          this.startPing();
          this.startWatchdog(40_000);
          void this.createLink(s.peer!.id, true).then((l) => l && this.sendOffer(l, false));
        }
        break;
      }
      case 'call_participant_joined': {
        if (callId !== s.callId || !s.group) return;
        const id = Number(e.user_id);
        if (!id || id === myId()) return;
        if (s.phase === 'outgoing') {
          Sounds.stop();
          this.set({ phase: 'connecting' });
          this.startPing();
        }
        this.addMember(id);
        void this.createLink(id, false); // the newcomer offers, we answer
        break;
      }
      case 'call_participant_left': {
        if (callId !== s.callId || !s.group) return;
        const id = Number(e.user_id);
        if (id && id !== myId()) this.dropMember(id);
        break;
      }
      case 'call_declined':
        if (callId === s.callId && s.phase === 'incoming' && Number(e.user_id) === myId()) this.finish('declined_elsewhere');
        break;
      case 'call_offer':
        if (callId === s.callId) {
          const link = this.linkFor(e, true);
          if (link) this.chain(link, () => this.onRemoteOffer(link, String(e.sdp ?? '')));
        }
        break;
      case 'call_answer':
        if (callId === s.callId) {
          const link = this.linkFor(e, false);
          if (link) this.chain(link, () => this.onRemoteAnswer(link, String(e.sdp ?? '')));
        }
        break;
      case 'call_ice':
        if (callId === s.callId) {
          const link = this.linkFor(e, false);
          if (link) void this.onRemoteCandidate(link, e);
        }
        break;
      case 'call_media_state':
        if (callId === s.callId) {
          const id = s.group ? Number(e.user_id) : s.peer?.id ?? 0;
          if (s.group) {
            this.patchMember(id, {
              ...(typeof e.video === 'boolean' ? { video: e.video } : {}),
              ...(typeof e.screen_share === 'boolean' ? { screen: e.screen_share } : {}),
              ...(typeof e.audio_muted === 'boolean' ? { muted: e.audio_muted } : {}),
            });
          } else {
            this.set({
              remoteVideoOn: typeof e.video === 'boolean' ? e.video : s.remoteVideoOn,
              remoteScreenShare: typeof e.screen_share === 'boolean' ? e.screen_share : s.remoteScreenShare,
              remoteMuted: typeof e.audio_muted === 'boolean' ? e.audio_muted : s.remoteMuted,
            });
          }
        }
        break;
      case 'call_ended':
        if (callId && callId === s.callId && s.phase !== 'idle' && s.phase !== 'ended') {
          const status = String(e.status ?? '');
          this.finish(status === 'ended' ? 'hangup' : String(e.reason || status));
        }
        break;
      case 'call_error': {
        const code = String(e.code ?? '');
        if (s.phase === 'outgoing' && !s.callId) this.finish(code);
        else if (s.group && s.phase === 'connecting' && this.links.size === 0 && callId === s.callId && ['call_full', 'call_not_found', 'already_in_call'].includes(code)) this.finish(code);
        else if (code === 'call_not_found' && callId && callId === s.callId && (s.phase === 'connecting' || s.phase === 'active')) this.finish('connection_lost');
        break;
      }
      default:
        break;
    }
  }

  /** The link an incoming SDP/ICE event belongs to (group: by sender; direct: the only link). */
  private linkFor(e: WsEventMsg, create: boolean): Link | null {
    const s = this.state;
    if (!s.group) return this.links.values().next().value ?? null;
    const id = Number(e.user_id);
    const existing = this.links.get(id);
    if (existing || !create || !id) return existing ?? null;
    // offer from someone whose call_participant_joined we have not seen (yet): create the link on the fly
    this.addMember(id);
    const link = this.makeLink(id, false);
    return link;
  }

  private notifyIncoming(): void {
    if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const s = this.state;
      const body = s.group ? (s.isVideoCall ? t('incomingGroupVideo') : t('incomingGroupVoice')) : s.isVideoCall ? t('incomingVideo') : t('incomingVoice');
      const n = new Notification(s.group ? s.chatTitle || 'Dark.Call' : s.peer?.username ?? 'Dark.Call', { body, silent: true });
      n.onclick = () => window.focus();
    } catch {
      /* best effort */
    }
  }

  // ------------------------------------------------------------ WebRTC

  /** Serializes offer/answer handling per link (like the single-threaded actor on Android). */
  private chain(link: Link, fn: () => Promise<void>): void {
    link.chain = link.chain.then(fn).catch((err) => console.warn('negotiation', err));
  }

  private async ensureMic(): Promise<boolean> {
    if (this.audioStream) return true;
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch {
      return false;
    }
  }

  private async loadIceServers(): Promise<void> {
    const r = await api.getIceServers();
    const list = r.ok ? (r.data.ice_servers ?? r.data.iceServers ?? []) : [];
    const mapped: RTCIceServer[] = (list as any[])
      .map((s) => ({ urls: s.urls, username: s.username || undefined, credential: s.credential || undefined }))
      .filter((s) => s.urls && (Array.isArray(s.urls) ? s.urls.length : true));
    this.iceServers = mapped.length ? mapped : FALLBACK_ICE;
  }

  private async createLink(id: number, offerer: boolean): Promise<Link | null> {
    const existing = this.links.get(id);
    if (existing) return existing;
    const link = this.makeLink(id, offerer);
    if (link && !this.state.group && this.state.isVideoCall) await this.startCamera();
    return link;
  }

  private makeLink(id: number, offerer: boolean): Link | null {
    if (!this.audioStream) return null;
    const existing = this.links.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    const link: Link = {
      id,
      pc,
      offerer,
      videoSender: null,
      pending: [],
      stream: this.state.group ? new MediaStream() : this.remoteStream,
      iceRestartDone: false,
      timer: null,
      chain: Promise.resolve(),
    };
    this.links.set(id, link);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.state.callId) {
        this.sendTo(link, 'call_ice', { candidate: ev.candidate.candidate, sdp_mid: ev.candidate.sdpMid, sdp_mline_index: ev.candidate.sdpMLineIndex });
      }
    };
    pc.ontrack = (ev) => {
      if (!link.stream.getTracks().includes(ev.track)) link.stream.addTrack(ev.track);
      this.notify();
    };
    pc.oniceconnectionstatechange = () => this.onIceState(link);

    const audio = this.audioStream.getAudioTracks()[0];
    audio.enabled = !this.state.micMuted;
    pc.addTrack(audio, this.audioStream);
    // The offerer always creates the video transceiver (even for audio calls); camera/screen are then
    // swapped with replaceTrack, no renegotiation. The other side takes the transceiver from the offer.
    if (offerer) {
      link.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      const track = this.screenTrack ?? this.cameraTrack;
      if (track) void link.videoSender.replaceTrack(track).catch(() => {});
    }
    if (this.state.group) this.startLinkTimer(link, 40_000); // never connected: give up on this participant
    return link;
  }

  private closeLink(id: number): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    if (link.timer != null) window.clearTimeout(link.timer);
    link.pc.onicecandidate = link.pc.ontrack = link.pc.oniceconnectionstatechange = null;
    try {
      link.pc.close();
    } catch {
      /* already closed */
    }
    if (link.stream !== this.remoteStream) link.stream.getTracks().forEach((x) => link.stream.removeTrack(x));
    this.notify();
  }

  private async sendOffer(link: Link, iceRestart: boolean): Promise<void> {
    if (!this.links.has(link.id)) return;
    const pc = link.pc;
    try {
      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);
      this.sendTo(link, 'call_offer', { sdp: offer.sdp });
    } catch (err) {
      console.warn('offer failed', err);
    }
  }

  /** Offer collision: direct = the caller is impolite; group = the lower user id is impolite. */
  private impolite(link: Link): boolean {
    return this.state.group ? myId() < link.id : this.isCaller;
  }

  private async onRemoteOffer(link: Link, sdp: string): Promise<void> {
    const pc = link.pc;
    if (!sdp || !this.links.has(link.id)) return;
    if (pc.signalingState === 'have-local-offer' && this.impolite(link)) return;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    this.attachVideoSenderFromOffer(link);
    await this.drainCandidates(link);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendTo(link, 'call_answer', { sdp: answer.sdp });
    this.sendMediaState();
  }

  private attachVideoSenderFromOffer(link: Link): void {
    if (link.videoSender) return;
    const tr = link.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
    if (!tr) return;
    tr.direction = 'sendrecv';
    link.videoSender = tr.sender;
    const track = this.screenTrack ?? this.cameraTrack;
    if (track) void tr.sender.replaceTrack(track).catch(() => {});
  }

  private async onRemoteAnswer(link: Link, sdp: string): Promise<void> {
    const pc = link.pc;
    if (!sdp || pc.signalingState !== 'have-local-offer') return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
    await this.drainCandidates(link);
    this.sendMediaState();
  }

  private async onRemoteCandidate(link: Link, e: WsEventMsg): Promise<void> {
    const line = String(e.candidate ?? '');
    if (!line) return;
    const init: RTCIceCandidateInit = { candidate: line, sdpMid: e.sdp_mid ?? null, sdpMLineIndex: typeof e.sdp_mline_index === 'number' ? e.sdp_mline_index : 0 };
    if (!link.pc.remoteDescription) link.pending.push(init);
    else await link.pc.addIceCandidate(init).catch(() => {});
  }

  private async drainCandidates(link: Link): Promise<void> {
    const list = link.pending.splice(0);
    for (const c of list) await link.pc.addIceCandidate(c).catch(() => {});
  }

  private onIceState(link: Link): void {
    switch (link.pc.iceConnectionState) {
      case 'connected':
      case 'completed':
        this.clearWatchdog();
        if (link.timer != null) window.clearTimeout(link.timer);
        link.timer = null;
        link.iceRestartDone = false;
        if (this.state.group) this.patchMember(link.id, { link: 'connected' });
        if (this.state.phase === 'connecting') {
          this.set({ phase: 'active', connectedAt: Date.now() });
        }
        this.sendMediaState();
        break;
      case 'disconnected':
        if (this.state.group) this.startLinkTimer(link, 25_000);
        else this.startWatchdog();
        break;
      case 'failed':
        if (this.state.group) this.startLinkTimer(link, 25_000);
        else this.startWatchdog();
        if (link.offerer && !link.iceRestartDone) {
          link.iceRestartDone = true;
          void this.sendOffer(link, true);
        }
        break;
      default:
        break;
    }
  }

  /** Group: a link that stays down is marked lost (the call and the other links go on). */
  private startLinkTimer(link: Link, ms: number): void {
    if (link.timer != null) window.clearTimeout(link.timer);
    link.timer = window.setTimeout(() => {
      link.timer = null;
      const st = link.pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') return;
      this.patchMember(link.id, { link: 'lost' });
    }, ms);
  }

  // ------------------------------------------------------------ keep-alive

  private startPing(): void {
    this.stopPing();
    this.sendPing();
    this.pingTimer = window.setInterval(() => this.sendPing(), 8_000);
  }

  private stopPing(): void {
    if (this.pingTimer != null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendPing(): void {
    const id = this.state.callId;
    if (id) this.send('call_ping', { call_id: id });
  }

  private clearWatchdog(): void {
    if (this.watchdog != null) window.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private startWatchdog(ms = 25_000): void {
    this.clearWatchdog();
    this.watchdog = window.setTimeout(() => {
      const p = this.state.phase;
      if (this.state.group) return; // groups track every link separately; being alone in a call is fine
      if (p === 'active' || p === 'connecting') {
        if (this.state.callId) this.send('call_end', { call_id: this.state.callId });
        this.finish('connection_lost');
      }
    }, ms);
  }

  // ------------------------------------------------------------ camera / screen

  private async setVideoSource(track: MediaStreamTrack | null): Promise<void> {
    await Promise.all(Array.from(this.links.values()).map((l) => l.videoSender?.replaceTrack(track).catch(() => {})));
    this.localPreview.getVideoTracks().forEach((x) => this.localPreview.removeTrack(x));
    if (track) this.localPreview.addTrack(track);
    this.notify();
  }

  private startCamera(): Promise<void> {
    if (this.cameraTrack) return Promise.resolve();
    this.cameraPromise ??= (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        if (this.state.phase === 'idle' || this.state.phase === 'ended') {
          stream.getTracks().forEach((x) => x.stop());
          return;
        }
        this.cameraTrack = stream.getVideoTracks()[0];
        await this.setVideoSource(this.cameraTrack);
        this.set({ cameraOn: true });
        this.sendMediaState();
      } catch {
        toast(t('noDevices'), 'error');
      } finally {
        this.cameraPromise = null;
      }
    })();
    return this.cameraPromise;
  }

  private stopCamera(): void {
    this.cameraTrack?.stop();
    this.cameraTrack = null;
  }

  private stopScreen(restoreCamera: boolean): void {
    if (!this.screenTrack) return;
    this.screenTrack.onended = null;
    this.screenTrack.stop();
    this.screenTrack = null;
    this.set({ screenSharing: false });
    if (restoreCamera && this.state.isVideoCall && this.inMedia) void this.startCamera();
    else void this.restoreVideoSource().then(() => this.sendMediaState());
  }

  private async restoreVideoSource(): Promise<void> {
    await this.setVideoSource(this.screenTrack ?? this.cameraTrack);
  }

  private sendMediaState(): void {
    const s = this.state;
    if (!s.callId || this.links.size === 0) return;
    this.send('call_media_state', { call_id: s.callId, video: s.cameraOn || s.screenSharing, screen_share: s.screenSharing, audio_muted: s.micMuted });
  }

  // ------------------------------------------------------------ teardown

  private showEnded(reason: string, chatId: number | null, peer: Peer | null): void {
    const keep = { group: this.state.group, chatTitle: this.state.chatTitle };
    this.set({ ...idle(), ...keep, phase: 'ended', chatId, peer, endReason: reason });
    if (this.endedTimer != null) window.clearTimeout(this.endedTimer);
    this.endedTimer = window.setTimeout(() => {
      if (this.state.phase === 'ended') this.reset();
    }, 2500);
  }

  private reset(): void {
    this.state = idle();
    this.notify();
  }

  private finish(reason: string): void {
    const before = this.state;
    this.clearWatchdog();
    this.stopPing();
    this.lostSocketInCall = false;
    Sounds.stop();
    this.stopCamera();
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      this.screenTrack.stop();
      this.screenTrack = null;
    }
    this.audioStream?.getTracks().forEach((x) => x.stop());
    this.audioStream = null;
    for (const id of Array.from(this.links.keys())) this.closeLink(id);
    this.remoteStream.getTracks().forEach((x) => this.remoteStream.removeTrack(x));
    this.localPreview.getTracks().forEach((x) => this.localPreview.removeTrack(x));
    this.clientCallId = null;
    this.showEnded(reason, before.chatId, before.peer);
  }
}

export const call = new CallController();

// ---------------------------------------------------------------- sounds (synthesized, no assets)

const Sounds = (() => {
  let ctx: AudioContext | null = null;
  let timer: number | null = null;
  const beep = (freq: number, ms: number, vol = 0.12): void => {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
  };
  const loop = (fn: () => void, every: number): void => {
    stop();
    fn();
    timer = window.setInterval(fn, every);
  };
  const stop = (): void => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };
  return {
    ringtone: () => loop(() => (beep(880, 220), window.setTimeout(() => beep(660, 220), 260)), 2000),
    ringback: () => loop(() => beep(425, 900, 0.07), 4000),
    stop,
  };
})();

// ---------------------------------------------------------------- screen picker

function pickScreenSource(sources: ScreenSource[]): Promise<ScreenSource | null> {
  return new Promise((resolve) => {
    let done = false;
    let close: () => void = () => {};
    const finish = (v: ScreenSource | null): void => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const group = (title: string, list: ScreenSource[]): HTMLElement | null =>
      list.length
        ? h(
            'div',
            { class: 'col gap-s' },
            h('div', { class: 'section-title' }, title),
            h('div', { class: 'src-grid' }, ...list.map((s) => h('button', { class: 'src', type: 'button', onclick: () => finish(s) }, h('img', { src: s.thumbnail, alt: '' }), h('span', { class: 'ellipsis small' }, s.name)))),
          )
        : null;
    const box = h(
      'div',
      { class: 'dialog' },
      h('div', { class: 'dialog-title' }, t('chooseScreen')),
      group(t('screens'), sources.filter((s) => s.isScreen)),
      group(t('windows'), sources.filter((s) => !s.isScreen)),
    );
    close = openModal(box, { wide: true, onClose: () => finish(null) });
  });
}

// ---------------------------------------------------------------- UI (full-window overlay)

let overlay: HTMLElement | null = null;

export function mountCallUi(): () => void {
  const remoteVideo = h('video', { class: 'call-remote', autoplay: true, playsinline: true }) as HTMLVideoElement;
  remoteVideo.srcObject = call.remoteStream;
  const localVideo = h('video', { class: 'call-local', autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  localVideo.muted = true;
  localVideo.srcObject = call.localPreview;
  const center = h('div', { class: 'call-center' });
  const grid = h('div', { class: 'call-grid' });
  const controls = h('div', { class: 'call-controls' });
  const timeEl = h('div', { class: 'call-sub' });
  const top = h('div', { class: 'call-top' });
  overlay = h('div', { class: 'call-overlay hidden' }, remoteVideo, h('div', { class: 'call-shade' }), grid, center, localVideo, controls, top);
  document.body.append(overlay);

  // Window modes: full-window, mini card inside the messenger (so it can be used meanwhile), or a separate
  // always-on-top window (Document Picture-in-Picture; falls back to the mini card when unavailable).
  let mode: 'full' | 'mini' | 'window' = 'full';
  let pip: Window | null = null;
  const closePip = (): void => {
    const w = pip;
    pip = null;
    if (w && !w.closed) w.close();
  };
  const toMain = (): void => {
    if (overlay && overlay.ownerDocument !== document) document.body.append(overlay);
  };
  const setMode = (m: 'full' | 'mini' | 'window'): void => {
    mode = m;
    if (overlay) {
      // drop the position left over from dragging the mini card, otherwise the full overlay collapses
      overlay.style.left = overlay.style.top = overlay.style.right = overlay.style.bottom = '';
    }
    if (m !== 'window') {
      closePip();
      toMain();
    }
    overlay?.classList.toggle('mini', m === 'mini');
    overlay?.classList.toggle('in-window', m === 'window');
    render();
  };
  const popOut = async (): Promise<void> => {
    const dpip = (window as any).documentPictureInPicture;
    if (!dpip) {
      setMode('mini');
      return;
    }
    try {
      const w: Window = await dpip.requestWindow({ width: 440, height: 660 });
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const st = w.document.createElement('style');
          st.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
          w.document.head.append(st);
        } catch {
          /* cross-origin sheet */
        }
      }
      w.document.documentElement.style.cssText = document.documentElement.style.cssText;
      w.document.documentElement.lang = document.documentElement.lang;
      w.document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#0b1220;color:#f8fafc;font-family:inherit';
      w.document.documentElement.style.height = '100%';
      pip = w;
      overlay!.style.left = overlay!.style.top = overlay!.style.right = overlay!.style.bottom = '';
      w.document.body.append(overlay!);
      overlay!.classList.remove('mini');
      overlay!.classList.add('in-window');
      mode = 'window';
      w.addEventListener('pagehide', () => {
        if (pip !== w) return; // closed by us
        pip = null;
        toMain();
        setMode(call.busy ? 'mini' : 'full');
      });
      render();
    } catch {
      setMode('mini');
    }
  };

  // dragging the mini card
  let drag: { dx: number; dy: number } | null = null;
  center.addEventListener('mousedown', (e) => {
    if (mode !== 'mini' || !overlay) return;
    const r = overlay.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  const onMove = (e: MouseEvent): void => {
    if (!drag || !overlay) return;
    const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - overlay.offsetWidth);
    const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - overlay.offsetHeight);
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  };
  const onUp = (): void => {
    drag = null;
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  let tick = 0;
  const fmt = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const rbtn = (ic: string, label: string, onClick: () => void, cls = ''): HTMLElement =>
    h('button', { class: `call-btn ${cls}`, type: 'button', title: label, 'aria-label': label, onclick: onClick }, icon(ic, 26));


  // ---- group tiles (kept between renders so <video> elements are not recreated) ----
  interface Tile { el: HTMLElement; video: HTMLVideoElement; av: HTMLElement; name: HTMLElement; badges: HTMLElement; sig: string }
  const tiles = new Map<number | 'me', Tile>();
  let manualPin: number | 'me' | null | undefined; // undefined = auto
  const tileFor = (key: number | 'me'): Tile => {
    let tl = tiles.get(key);
    if (tl) return tl;
    const video = h('video', { class: 'tile-video', autoplay: true, playsinline: true }) as HTMLVideoElement;
    if (key === 'me') {
      video.muted = true;
      video.srcObject = call.localPreview;
    }
    const av = h('div', { class: 'tile-avatar' });
    const name = h('div', { class: 'tile-name ellipsis' });
    const badges = h('div', { class: 'tile-badges' });
    const el = h('div', { class: 'call-tile', title: t('enlarge') }, video, av, name, badges);
    el.addEventListener('click', () => {
      const cur = pinnedKey;
      manualPin = cur === key ? null : key;
      render();
    });
    tl = { el, video, av, name, badges, sig: '' };
    tiles.set(key, tl);
    return tl;
  };
  let pinnedKey: number | 'me' | null = null;
  const renderGrid = (s: typeof call.state): void => {
    const me = { username: S.me?.username ?? t('you'), avatar: S.me?.avatar ?? null };
    const entries: Array<{ key: number | 'me'; username: string; avatar?: string | null; video: boolean; screen: boolean; muted: boolean; link: string }> = [
      { key: 'me', ...me, video: s.cameraOn || s.screenSharing, screen: s.screenSharing, muted: s.micMuted, link: 'connected' },
      ...s.members.map((m) => ({ key: m.id as number | 'me', username: m.username, avatar: m.avatar, video: m.video || m.screen, screen: m.screen, muted: m.muted, link: m.link })),
    ];
    const keys = new Set(entries.map((x) => x.key));
    for (const [k, tl] of Array.from(tiles)) {
      if (!keys.has(k)) {
        tl.video.srcObject = null;
        tl.el.remove();
        tiles.delete(k);
      }
    }
    // pinned tile: manual choice wins; otherwise whoever shares a screen
    const sharer = entries.find((x) => x.screen && x.key !== 'me') ?? entries.find((x) => x.screen);
    pinnedKey = manualPin === undefined ? sharer?.key ?? null : manualPin !== null && keys.has(manualPin) ? manualPin : null;
    grid.classList.toggle('pinned', pinnedKey != null && entries.length > 1);
    grid.dataset.n = String(Math.min(entries.length, 6));
    grid.style.setProperty('--others', String(Math.max(1, entries.length - 1)));
    let prev: Node | null = null;
    for (const en of entries) {
      const tl = tileFor(en.key);
      const sig = `${en.username}|${en.avatar ?? ''}`;
      if (tl.sig !== sig) {
        tl.sig = sig;
        tl.av.replaceChildren(avatar(en.avatar, en.username, 84));
        tl.name.textContent = en.key === 'me' ? `${en.username} (${t('you')})` : en.username;
      }
      if (en.key !== 'me') {
        const stream = call.streamOf(en.key as number);
        if (stream && tl.video.srcObject !== stream) tl.video.srcObject = stream;
      }
      tl.el.classList.toggle('novideo', !en.video);
      tl.el.classList.toggle('mirror', en.key === 'me' && !en.screen);
      tl.el.classList.toggle('pin', pinnedKey === en.key && entries.length > 1);
      tl.el.classList.toggle('lost', en.link === 'lost');
      tl.el.title = pinnedKey === en.key ? t('shrink') : t('enlarge');
      tl.badges.replaceChildren(
        ...(en.muted ? [h('span', { class: 'tile-badge' }, icon('mic_off', 14))] : []),
        ...(en.screen ? [h('span', { class: 'tile-badge' }, icon('screen_share', 14))] : []),
        ...(en.link === 'lost' ? [h('span', { class: 'tile-badge warn' }, t('tileLost'))] : []),
      );
      const want: Node | null = prev ? prev.nextSibling : grid.firstChild;
      if (tl.el !== want) grid.insertBefore(tl.el, want);
      prev = tl.el;
      tl.video.play().catch(() => {});
    }
  };

  const render = (): void => {
    const s = call.state;
    const el = overlay!;
    el.classList.toggle('hidden', s.phase === 'idle');
    window.clearInterval(tick);
    if (s.phase === 'idle') {
      if (mode !== 'full') {
        mode = 'full';
        closePip();
        toMain();
        el.classList.remove('mini', 'in-window');
        el.style.left = el.style.top = el.style.right = el.style.bottom = '';
      }
      return;
    }
    // an incoming call always opens full-size on the main window
    if (s.phase === 'incoming' && mode !== 'full') {
      setMode('full');
      return;
    }
    top.replaceChildren();
    if (s.phase !== 'incoming' && s.phase !== 'ended') {
      if (mode === 'full') {
        top.append(
          h('button', { class: 'call-top-btn', type: 'button', title: t('minimize'), onclick: () => setMode('mini') }, icon('pip', 20)),
          h('button', { class: 'call-top-btn', type: 'button', title: t('popOut'), onclick: () => void popOut() }, icon('open_in_new', 20)),
        );
      } else if (mode === 'mini') {
        top.append(
          h('button', { class: 'call-top-btn', type: 'button', title: t('popOut'), onclick: () => void popOut() }, icon('open_in_new', 18)),
          h('button', { class: 'call-top-btn', type: 'button', title: t('expand'), onclick: () => setMode('full') }, icon('fullscreen', 18)),
        );
      }
    }

    const groupView = s.group && mode !== 'mini' && (s.phase === 'outgoing' || s.phase === 'connecting' || s.phase === 'active');
    el.classList.toggle('group-view', groupView);
    if (groupView) renderGrid(s);
    else if (!s.group) manualPin = undefined;
    const remoteShown = !s.group && (s.phase === 'active' || s.phase === 'connecting') && s.remoteVideoOn;
    el.classList.toggle('has-remote', remoteShown);
    el.classList.toggle('has-local', !s.group && (s.cameraOn || s.screenSharing));
    el.classList.toggle('screen-local', !s.group && s.screenSharing);
    remoteVideo.play().catch(() => {});
    localVideo.play().catch(() => {});

    const count = s.members.length + (s.phase === 'incoming' ? 0 : 1);
    let status = '';
    if (s.phase === 'outgoing') status = s.group ? t('waitingOthers') : t('calling');
    else if (s.phase === 'incoming') {
      status = s.group ? (s.isVideoCall ? t('incomingGroupVideo') : t('incomingGroupVoice')) : s.isVideoCall ? t('incomingVideo') : t('incomingVoice');
      if (s.group && s.peer) status = `${t('callingYou', s.peer.username)} · ${s.isVideoCall ? t('videoCall') : t('voiceCall')}`;
    }
    else if (s.phase === 'connecting') status = t('callConnecting');
    else if (s.phase === 'ended') status = callEndReasonText(s.endReason);
    if (s.phase === 'active') {
      const upd = (): void => {
        timeEl.textContent = fmt(Date.now() - (s.connectedAt ?? Date.now())) + (s.group ? ` · ${t('members', count)}` : '') + (s.remoteMuted ? ` · ${t('remoteMuted')}` : '') + (s.remoteScreenShare ? ` · ${t('remoteSharing')}` : '');
      };
      upd();
      tick = window.setInterval(upd, 1000);
    } else timeEl.textContent = status;

    const name = s.group ? s.chatTitle || t('groupVoiceCall') : s.peer?.username ?? '';
    const inNow = s.group && s.phase === 'incoming' ? (s.members.length ? t('inCallNow', s.members.map((m) => m.username).join(', ')) : t('noOneInCall')) : '';
    center.replaceChildren(
      ...(remoteShown || groupView ? [] : [h('div', { class: 'call-avatar' }, avatar(s.group ? null : s.peer?.avatar, name, 120))]),
      h('div', { class: 'call-name' }, name),
      timeEl,
      ...(inNow ? [h('div', { class: 'call-sub small' }, inNow)] : []),
    );

    controls.replaceChildren();
    if (s.phase === 'incoming') {
      controls.append(rbtn('call_end', t('decline'), () => call.reject(), 'red'), rbtn(s.isVideoCall ? 'videocam' : 'call', s.group ? t('joinCall') : t('accept'), () => void call.accept(), 'green'));
    } else if (s.phase === 'ended') {
      // nothing to do, overlay disappears by itself
    } else {
      const inCall = s.phase === 'active' || s.phase === 'connecting' || (s.group && s.phase === 'outgoing');
      if (inCall) {
        controls.append(
          rbtn(s.micMuted ? 'mic_off' : 'mic', s.micMuted ? t('unmute') : t('mute'), () => call.toggleMute(), s.micMuted ? 'on' : ''),
          rbtn(s.cameraOn ? 'videocam' : 'videocam_off', s.cameraOn ? t('cameraOff') : t('cameraOn'), () => void call.toggleCamera(), s.cameraOn ? 'on' : ''),
          rbtn('screen_share', s.screenSharing ? t('stopShare') : t('shareScreen'), () => void call.toggleScreen(), s.screenSharing ? 'on' : ''),
        );
      }
      controls.append(rbtn('call_end', t('hangUp'), () => call.hangUp(), 'red'));
    }
  };

  const unsub = call.subscribe(render);
  render();
  return () => {
    unsub();
    window.clearInterval(tick);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    closePip();
    tiles.forEach((tl) => (tl.video.srcObject = null));
    overlay?.remove();
    overlay = null;
  };
}

/** Starts a call from a direct chat. */
export function startCallFromChat(chatId: number, other: User | null, video: boolean): void {
  if (!other) return;
  if (call.busy) {
    toast(callEndReasonText('already_in_call'), 'error');
    return;
  }
  void call.start(chatId, { id: other.id, username: other.username, avatar: other.avatar }, video);
}

/** Starts a group call from a group chat. */
export function startGroupCallFromChat(chatId: number, title: string, users: User[], video: boolean): void {
  if (call.busy) {
    toast(callEndReasonText('already_in_call'), 'error');
    return;
  }
  void call.startGroup(chatId, title, video, users.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar })));
}

/** Join an active group call (banner in the chat). */
export function joinGroupCall(chatId: number, title: string, users: User[]): void {
  const info = groupCalls.get(chatId);
  if (!info?.call_id) return;
  if (call.busy) {
    toast(callEndReasonText('already_in_call'), 'error');
    return;
  }
  void call.join(chatId, info.call_id, title, info.media === 'video', users.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar })));
}
