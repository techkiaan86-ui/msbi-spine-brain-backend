import { AuthenticatedUser } from '../middlewares/auth.middleware';

/**
 * Resource-Level Authorization & Ownership Verification Utilities
 * 
 * Prevents Insecure Direct Object References (IDOR) and horizontal privilege escalation.
 */

export class ResourceAuth {
  /**
   * Verifies if a user can access or modify another user's personal resource (e.g. notification settings, profile).
   * 
   * Rule: Admins can manage any user. Non-admins may ONLY manage their own user record.
   */
  static canAccessUser(currentUser: AuthenticatedUser, targetUserId: string): boolean {
    if (!currentUser || !currentUser.isActive) return false;
    if (currentUser.roleName === 'Admin') return true;
    return currentUser.id === targetUserId;
  }

  /**
   * Verifies if a user can modify a specific marketing campaign.
   * 
   * Rule: Admins and Managers can modify all campaigns. Other roles (e.g. Specialists) can only modify campaigns they own.
   */
  static canModifyCampaign(currentUser: AuthenticatedUser, campaignOwnerId: string): boolean {
    if (!currentUser || !currentUser.isActive) return false;
    if (currentUser.roleName === 'Admin' || currentUser.roleName === 'Manager') return true;
    return currentUser.id === campaignOwnerId;
  }

  /**
   * Scopes queries by clinic or location if applicable.
   */
  static isClinicAccessible(currentUser: AuthenticatedUser, clinicId: string | null | undefined): boolean {
    if (!currentUser || !currentUser.isActive) return false;
    // Currently single-tenant organization model where Admins/Clinical Leads manage all mapped clinics
    return true;
  }
}
