import React, { useState, useEffect } from 'react';
import { getDataProvider } from '../../data/data-provider.js';
import { useAuth } from '../../auth/useAuth.js';
import { CommunicationsSettingsResponse, UpdateCommunicationsSettingsRequest } from '@ks-os/contracts';

export function Communications() {
  const { role } = useAuth();
  const [settings, setSettings] = useState<CommunicationsSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [role]);

  const fetchSettings = async () => {
    if (role === 'staff') {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.getCommunicationsSettings();
      setSettings(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load communications settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      const provider = getDataProvider();
      const updateReq: UpdateCommunicationsSettingsRequest = {
        replyToEmail: settings.replyToEmail,
        senderDisplayName: settings.senderDisplayName,
        bookingConfirmationEnabled: settings.bookingConfirmationEnabled,
        bookingCancellationEnabled: settings.bookingCancellationEnabled,
        bookingRescheduleEnabled: settings.bookingRescheduleEnabled,
        appointmentRemindersEnabled: settings.appointmentRemindersEnabled,
        formDeliveryEnabled: settings.formDeliveryEnabled,
        formRemindersEnabled: settings.formRemindersEnabled,
        paymentConfirmationEnabled: settings.paymentConfirmationEnabled,
        formReminderTiming: settings.formReminderTiming as any,
      };
      await provider.updateCommunicationsSettings(updateReq);
      setSuccessMessage('Settings saved successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to save communications settings');
    } finally {
      setSaving(false);
    }
  };

  if (role === 'staff') {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Communications Settings</h2>
        <div className="bg-red-50 text-red-600 p-4 rounded-md">
          You do not have permission to view communications settings. Only account owners can access this page.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Communications Settings</h2>
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Communications Settings</h2>
        <div className="text-red-500">Could not load settings.</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold mb-6">Communications Settings</h2>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-50 text-green-600 p-4 rounded-md mb-6">
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-lg shadow border p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Sender Information</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Display Name</label>
              <input
                type="text"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={settings.senderDisplayName || ''}
                onChange={e => setSettings({ ...settings, senderDisplayName: e.target.value })}
                placeholder="e.g. Sovereign Gents Barbershop"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reply-To Email</label>
              <input
                type="email"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={settings.replyToEmail || ''}
                onChange={e => setSettings({ ...settings, replyToEmail: e.target.value })}
                placeholder="e.g. hello@sovereigngents.com"
              />
            </div>
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Booking Notifications</h3>
          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.bookingConfirmationEnabled}
                onChange={e => setSettings({ ...settings, bookingConfirmationEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Booking Confirmations</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.bookingRescheduleEnabled}
                onChange={e => setSettings({ ...settings, bookingRescheduleEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Booking Reschedules</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.bookingCancellationEnabled}
                onChange={e => setSettings({ ...settings, bookingCancellationEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Booking Cancellations</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.appointmentRemindersEnabled}
                onChange={e => setSettings({ ...settings, appointmentRemindersEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Appointment Reminders</span>
            </label>
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Form & Document Notifications</h3>
          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.formDeliveryEnabled}
                onChange={e => setSettings({ ...settings, formDeliveryEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Form Delivery Emails</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                checked={settings.formRemindersEnabled}
                onChange={e => setSettings({ ...settings, formRemindersEnabled: e.target.checked })}
              />
              <span className="ml-2 text-sm text-gray-700">Form Reminders</span>
            </label>

            {settings.formRemindersEnabled && (
              <div className="ml-6 mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Reminder Timing</label>
                <select
                  className="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={settings.formReminderTiming}
                  onChange={e => setSettings({ ...settings, formReminderTiming: e.target.value })}
                >
                  <option value="no_reminder">No additional reminder</option>
                  <option value="24_hours_after_assignment">24 Hours After Assignment</option>
                  <option value="48_hours_before_appointment">48 Hours Before Appointment</option>
                  <option value="24_hours_before_appointment">24 Hours Before Appointment</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
