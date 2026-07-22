/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Search, User, Award, CreditCard, BookOpen, Clock, Heart, Sliders, Calendar, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { BusinessTenant } from '../data/types.js';
import { getClients, getClientProfile } from '../api/client.js';

interface ClientCRMProps {
  tenant: BusinessTenant;
}

export default function ClientCRM({ tenant }: ClientCRMProps) {
  const { clientId } = useParams();
  const navigate = useNavigate();

  // Directory State
  const [clients, setClients] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  // Profile State
  const [profileData, setProfileData] = useState<any | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset pagination on new search
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch Directory
  const loadDirectory = useCallback(async (pageNum: number, searchStr: string, append = false) => {
    try {
      if (!append) setIsSearching(true);
      setDirectoryError(null);
      
      const response = await getClients({ limit: 20, page: pageNum, search: searchStr });
      
      if (append) {
        setClients(prev => [...prev, ...response.data]);
      } else {
        setClients(response.data);
      }
      
      setHasMore(response.meta.page < response.meta.totalPages);
    } catch (err: any) {
      setDirectoryError(err.message || 'Failed to load directory');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(page, debouncedSearch, page > 1);
  }, [page, debouncedSearch, loadDirectory]);

  // Fetch Profile
  useEffect(() => {
    if (clientId) {
      const loadProfile = async () => {
        setIsProfileLoading(true);
        setProfileError(null);
        try {
          const res = await getClientProfile(clientId);
          setProfileData(res.data);
        } catch (err: any) {
          setProfileError(err.message || 'Failed to load profile');
          setProfileData(null);
        } finally {
          setIsProfileLoading(false);
        }
      };
      loadProfile();
    } else {
      setProfileData(null);
    }
  }, [clientId]);

  const handleLoadMore = () => {
    if (hasMore && !isSearching) {
      setPage(prev => prev + 1);
    }
  };

  const formatFriendlyDate = (dateStr: string | null) => {
    if (!dateStr) return 'No visits yet';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 min-h-[500px] font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Directory */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-sm flex flex-col h-[650px]">
          <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-slate-500" /> Client Directory
          </h3>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 focus:outline-none text-xs font-semibold"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-2">
            {isSearching && page === 1 ? (
              <div className="py-8 flex justify-center text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            ) : directoryError ? (
              <div className="py-8 text-center text-rose-500 font-medium text-xs">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-400" />
                <p>{directoryError}</p>
                <button onClick={() => loadDirectory(page, debouncedSearch, false)} className="mt-2 text-indigo-600 underline">Retry</button>
              </div>
            ) : clients.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs font-medium">
                No clients found matching "{debouncedSearch}"
              </div>
            ) : (
              <>
                {clients.map(c => (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/app/clients/${c.id}`)}
                    className={`p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2 ${clientId === c.id ? 'bg-slate-950 text-white' : 'hover:bg-slate-50'}`}
                  >
                    <div className="truncate">
                      <p className={`text-xs font-bold ${clientId === c.id ? 'text-white' : 'text-slate-800'}`}>{c.name}</p>
                      <p className={`text-[10px] mt-0.5 ${clientId === c.id ? 'text-slate-400' : 'text-slate-400'}`}>{c.phone || c.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                        {c.totalBookingCount} visits
                      </span>
                    </div>
                  </div>
                ))}
                {hasMore && (
                  <div className="pt-4 pb-2 flex justify-center">
                    <button onClick={handleLoadMore} disabled={isSearching} className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-lg transition disabled:opacity-50">
                      {isSearching ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right column: CRM Client Profile */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm h-[650px] overflow-y-auto">
          {isProfileLoading ? (
            <div className="h-full flex items-center justify-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin" />
            </div>
          ) : profileError ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <AlertTriangle className="w-12 h-12 text-rose-400 mb-4" />
              <h4 className="font-bold text-slate-800 text-lg">Unable to load profile</h4>
              <p className="text-sm mt-1 mb-4">{profileError}</p>
              <button onClick={() => navigate('/app/clients')} className="text-indigo-600 underline text-sm font-medium">Return to Directory</button>
            </div>
          ) : !clientId || !profileData ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <User className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h4 className="font-bold text-slate-800 text-lg">No client selected</h4>
              <p className="text-sm mt-1 max-w-sm text-center">Select a client from the directory to view their appointment history, medical details, and profile metrics.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Header */}
              <div className="border-b pb-6">
                <h3 className="text-2xl font-black text-slate-900">{profileData.profile.name}</h3>
                <p className="text-sm text-slate-500 mt-1 flex gap-3">
                  <span>{profileData.profile.phone || 'No Phone'}</span>
                  <span>•</span>
                  <span>{profileData.profile.email || 'No Email'}</span>
                </p>
                <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5" /> Client since {formatFriendlyDate(profileData.profile.createdAt)}
                </p>
              </div>

              {/* Aggregates Widget Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-100">
                  <BookOpen className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                  <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Total Bookings</span>
                  <span className="text-lg font-extrabold text-slate-800">{profileData.bookingHistory?.length || 0}</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-100">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
                  <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Completed</span>
                  <span className="text-lg font-extrabold text-slate-800">{profileData.bookingHistory?.filter((b: any) => b.status === 'COMPLETED').length || 0}</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-100">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-2" />
                  <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">No-Shows</span>
                  <span className="text-lg font-extrabold text-slate-800">{profileData.bookingHistory?.filter((b: any) => b.status === 'NO_SHOW').length || 0}</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-100">
                  <Award className="w-5 h-5 text-purple-500 mx-auto mb-2" />
                  <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Loyalty Points</span>
                  <span className="text-lg font-extrabold text-slate-800">{profileData.profile.loyaltyPoints || 0}</span>
                </div>
              </div>

              {/* Medical & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              </div>

              {/* Booking History */}
              <div className="space-y-6">
                {profileData.bookingHistory?.filter((b: any) => new Date(b.startTime) >= new Date()).length > 0 && (
                  <div>
                    <h4 className="text-xs font-black uppercase text-indigo-500 tracking-wider mb-3">Upcoming Bookings</h4>
                    <div className="space-y-2">
                      {profileData.bookingHistory.filter((b: any) => new Date(b.startTime) >= new Date()).map((b: any) => (
                        <div key={b.id} className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center text-sm">
                          <div className="flex items-center gap-3">
                            <Clock className="w-4 h-4 text-indigo-400" />
                            <div>
                              <p className="font-bold text-slate-800">{formatFriendlyDate(b.startTime)}</p>
                              <p className="text-xs text-slate-500">{b.serviceName} with {b.staffName}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white text-indigo-700 uppercase tracking-wide">
                              {b.status}
                            </span>
                            <Link to={`/app/calendar?date=${b.startTime.split('T')[0]}`} className="block text-[10px] text-indigo-600 font-bold hover:underline mt-1.5">
                              View in Calendar &rarr;
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">Recent History</h4>
                  <div className="space-y-2">
                    {profileData.bookingHistory?.filter((b: any) => new Date(b.startTime) < new Date()).length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No past bookings found.</p>
                    ) : (
                      profileData.bookingHistory.filter((b: any) => new Date(b.startTime) < new Date()).map((b: any) => (
                        <div key={b.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center text-sm">
                          <div className="flex items-center gap-3">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <div>
                              <p className="font-bold text-slate-800">{formatFriendlyDate(b.startTime)}</p>
                              <p className="text-xs text-slate-500">{b.serviceName} with {b.staffName}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${b.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : b.status === 'CANCELLED' ? 'bg-rose-50 text-rose-700' : 'bg-slate-200 text-slate-700'}`}>
                              {b.status}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
