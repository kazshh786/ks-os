import React from 'react';
import { Link } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="space-y-4 max-w-md">
        <h1 className="text-6xl font-black text-indigo-500">404</h1>
        <h2 className="text-xl font-bold">Workspace View Not Found</h2>
        <p className="text-xs text-slate-400 leading-normal">
          The requested URL path does not exist on this tenant workspace configuration, or has been relocated during platform boot.
        </p>
        <div className="pt-4">
          <Link
            to="/app/calendar"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl shadow-lg transition"
          >
            Return to Staff Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};
export default NotFoundPage;
