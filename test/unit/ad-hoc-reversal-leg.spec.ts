import { isAdHocReversalLeg } from '../../src/users/tenant-management/tenant-management.service';

/**
 * The balance-breakdown net-fix (Phase 2) distinguishes ad-hoc REVERSAL legs
 * (cancellation / edit-down — net against the charge, hidden) from GENUINE
 * payments (shown as money received). New rows carry metadata.reversal; legacy
 * prod rows (e.g. Tunji) predate the tag and must be detected by description.
 */
describe('isAdHocReversalLeg', () => {
  it('detects new tagged reversals via metadata.reversal', () => {
    expect(isAdHocReversalLeg({ metadata: { reversal: true }, description: 'anything' })).toBe(true);
  });

  it('detects historical CANCEL reversals by description (em dash, untagged)', () => {
    expect(
      isAdHocReversalLeg({
        metadata: null,
        description: 'Invoice AHI-2026-0001 cancelled — reversed ₦100,000',
      }),
    ).toBe(true);
  });

  it('detects historical EDIT-DOWN reversals by description (untagged)', () => {
    expect(
      isAdHocReversalLeg({
        metadata: null,
        description: 'Invoice AHI-2026-0001 edited — reduced by ₦70,000',
      }),
    ).toBe(true);
  });

  it('does NOT match a genuine ad-hoc payment', () => {
    expect(isAdHocReversalLeg({ metadata: null, description: 'Payment received' })).toBe(false);
    expect(
      isAdHocReversalLeg({ metadata: null, description: 'Manual payment of ₦500,000 received' }),
    ).toBe(false);
  });

  it('does NOT match an edit-UP charge or a fresh charge description', () => {
    expect(
      isAdHocReversalLeg({ metadata: null, description: 'Invoice AHI-2026-0001 edited — increased by ₦99,000' }),
    ).toBe(false);
    expect(isAdHocReversalLeg({ metadata: null, description: 'Invoice AHI-2026-0003 — ₦1,000' })).toBe(false);
  });

  it('handles missing/empty description and metadata safely', () => {
    expect(isAdHocReversalLeg({})).toBe(false);
    expect(isAdHocReversalLeg({ metadata: undefined, description: null })).toBe(false);
    expect(isAdHocReversalLeg({ metadata: {}, description: '' })).toBe(false);
  });
});
