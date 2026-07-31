import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CalendarActionEnhancer} from './features/bookings/CalendarActionEnhancer.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CalendarActionEnhancer />
    <App />
  </StrictMode>,
);
