import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntitlementUsageMeter, LockedFeatureCard, TIER_LIMITS } from '../EntitlementUI';

describe('EntitlementUI', () => {
  describe('TIER_LIMITS configuration', () => {
    it('defines exact limits for Core, Growth, and Scale tiers', () => {
      expect(TIER_LIMITS.CORE).toEqual({
        monthlyBookings: 500,
        activeStaff: 5,
        locations: 1,
        onlineBooking: true,
        manualBookings: true,
        posAndPayments: true,
        customAutomations: false,
        advancedAnalytics: false,
        inventory: 'LOCKED',
        supportLevel: 'Standard',
      });

      expect(TIER_LIMITS.GROWTH).toEqual({
        monthlyBookings: 2500,
        activeStaff: 15,
        locations: 3,
        onlineBooking: true,
        manualBookings: true,
        posAndPayments: true,
        customAutomations: true,
        advancedAnalytics: true,
        inventory: 'BETA',
        supportLevel: 'Priority',
      });

      expect(TIER_LIMITS.SCALE).toEqual({
        monthlyBookings: 20000,
        activeStaff: 100,
        locations: 20,
        onlineBooking: true,
        manualBookings: true,
        posAndPayments: true,
        customAutomations: true,
        advancedAnalytics: true,
        inventory: 'BETA',
        supportLevel: 'Strategic',
      });
    });
  });

  describe('LockedFeatureCard', () => {
    it('renders feature title, lock icon indicator, required tier, benefit, and upgrade action', async () => {
      const user = userEvent.setup();
      const onUpgrade = vi.fn();

      render(
        <LockedFeatureCard
          title="Custom Multi-step Automations"
          description="Build automated SMS and email follow-up sequences for no-shows and re-engagement."
          requiredTier="GROWTH"
          benefit="Automate post-appointment review requests and no-show follow-ups to boost client retention."
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.getByText('Custom Multi-step Automations')).toBeInTheDocument();
      expect(screen.getByText('GROWTH Plan')).toBeInTheDocument();
      expect(screen.getByText(/Automate post-appointment review requests/)).toBeInTheDocument();

      const upgradeButton = screen.getByRole('button', { name: /Upgrade plan/i });
      await user.click(upgradeButton);
      expect(onUpgrade).toHaveBeenCalledWith('GROWTH');
    });
  });

  describe('EntitlementUsageMeter', () => {
    it('renders normal usage context without warning below 80%', () => {
      render(
        <EntitlementUsageMeter
          label="Monthly bookings"
          current={350}
          limit={500}
          currentTier="CORE"
        />
      );

      expect(screen.getByText('350 of 500 used this month')).toBeInTheDocument();
      expect(screen.queryByText(/volume used/i)).not.toBeInTheDocument();
    });

    it('renders warning at 80% usage and displays upgrade recommendation', () => {
      render(
        <EntitlementUsageMeter
          label="Monthly bookings"
          current={432}
          limit={500}
          currentTier="CORE"
        />
      );

      expect(screen.getByText('432 of 500 used this month')).toBeInTheDocument();
      expect(screen.getByText(/86% of monthly volume used/i)).toBeInTheDocument();
      expect(screen.getByText(/Upgrade to GROWTH for 2,500 bookings/i)).toBeInTheDocument();
    });

    it('renders critical alert at 100% usage', () => {
      render(
        <EntitlementUsageMeter
          label="Monthly bookings"
          current={500}
          limit={500}
          currentTier="CORE"
        />
      );

      expect(screen.getByText('500 of 500 used this month')).toBeInTheDocument();
      expect(screen.getByText(/Monthly limit reached \(500\/500\)/i)).toBeInTheDocument();
    });
  });
});
