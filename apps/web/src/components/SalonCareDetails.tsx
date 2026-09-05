import { Heart, Sliders } from 'lucide-react';
import type { ClientDetailResponse } from '@ks-os/contracts';
export function SalonCareDetails({profileData,formatFriendlyDate}:{profileData:ClientDetailResponse;formatFriendlyDate:(value:string|null)=>string}) {
  return (<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                    <Heart className="w-4 h-4 text-rose-500" /> Medical & Authorized Notes
                  </h4>
                  <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl text-sm min-h-[120px]">
                    {profileData.medicalNotes ? (
                      <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">{profileData.medicalNotes}</p>
                    ) : (
                      <p className="text-slate-400 italic">No medical notes on file.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-slate-500" /> Operational Data
                  </h4>
                  <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl text-sm space-y-4 min-h-[120px]">
                    <div>
                      <span className="text-xs text-slate-400 block font-bold uppercase mb-1">Patch Test Date</span>
                      <span className="font-bold text-slate-900">{profileData.profile.patchTestDate ? formatFriendlyDate(profileData.profile.patchTestDate) : 'Not recorded'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block font-bold uppercase mb-1">Last Visit</span>
                      <span className="font-medium text-slate-800">{formatFriendlyDate(profileData.profile.lastVisitDate)}</span>
                    </div>
                  </div>
                </div>
              </div>);
}
