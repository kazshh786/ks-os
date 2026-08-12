import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CalendarActionEnhancer} from './features/bookings/CalendarActionEnhancer.tsx';
import {BookingPaymentExperienceEnhancer} from './features/bookings/BookingPaymentExperienceEnhancer.tsx';
import './index.css';
import './accessible-selects.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CalendarActionEnhancer />
    <BookingPaymentExperienceEnhancer />
    <App />
  </StrictMode>,
);