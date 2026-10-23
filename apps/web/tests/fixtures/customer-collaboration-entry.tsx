import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import ClientPortal from '../../src/features/client-collaboration/ClientPortal';
import ClientInvitation from '../../src/features/client-collaboration/ClientInvitation';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes><Route path="/customer/collaboration/*" element={<ClientPortal/>}/><Route path="/customer/invite" element={<ClientInvitation/>}/><Route path="/customer/login" element={<main><h1>Secure customer sign in</h1></main>}/></Routes></BrowserRouter></React.StrictMode>);
