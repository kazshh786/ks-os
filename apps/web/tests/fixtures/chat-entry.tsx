import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { ChatWorkspace } from '../../src/features/chat/ChatPage';
import '../../src/index.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><main style={{height:'100dvh',minHeight:0,fontFamily:'var(--font-sans)'}}><BrowserRouter><Routes><Route path="/app/chat/:conversationId?" element={<ChatWorkspace/>}/></Routes></BrowserRouter></main></React.StrictMode>);
