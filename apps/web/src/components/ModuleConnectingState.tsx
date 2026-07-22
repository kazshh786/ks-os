import React from 'react';
import { Settings } from 'lucide-react';

export const ModuleConnectingState: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div className="flex h-[calc(100vh-64px)] w-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 rounded-full bg-slate-100 p-4">
        <Settings className="h-10 w-10 text-slate-400 animate-[spin_3s_linear_infinite]" />
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
      <p className="max-w-md text-slate-500">
        This module is being connected to the live database in Phase 2. Data here is temporarily unavailable while we ensure strict tenant isolation.
      </p>
    </div>
  );
};
