import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { CallWorkspace } from '../../src/features/calls/CallWorkspace';
import { ConversationCalls } from '../../src/features/calls/ConversationCalls';
import { fixture, subscribe } from './calls-ui-api';
import '../../src/index.css';
import '../../src/features/chat/chat.css';
Object.assign(window,{callsFixture:fixture});
createRoot(document.getElementById('root')!).render(<BrowserRouter><main className="chat-workspace chat-has-channel" style={{height:'100dvh',fontFamily:'var(--font-sans)'}}><CallWorkspace subscribe={subscribe} revision={0} userId="ada"/><aside className="chat-channel-nav" aria-label="Conversations"><header className="chat-nav-header"><div><p className="chat-eyebrow">Your workspace</p><h1>Chat</h1></div></header><div className="chat-channels-scroll"><p>Design team</p></div></aside><div className="chat-main" style={{display:'flex'}}><header className="chat-conversation-header"><div className="chat-channel-title"><h2>Design team</h2><p>A shared space for your team</p></div><ConversationCalls conversationId="22222222-2222-4222-8222-222222222222" archived={false} subscribe={subscribe} revision={0}/></header><section className="chat-timeline"><p className="chat-muted">Messages and shared files stay in your KSOS conversation.</p></section></div></main></BrowserRouter>);

