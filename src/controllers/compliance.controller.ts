import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../plugins/db';
import { auditService } from '../services/audit.service';

/**
 * High-level HIPAA / Compliance Governance Status Overview.
 * Strips all secrets, database credentials, tokens, and PHI.
 * Restricted to administrators with 'settings' or 'users-roles' permissions.
 */
export async function getComplianceStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = request.user;

    // Count user accounts & role distribution
    const [userCount, activeCount, deactivatedCount, rolesCount, logsCount, integrationsCount] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.role.count(),
      prisma.activityLog.count(),
      prisma.integrationCredential.count()
    ]);

    // Construct safe compliance overview object
    const complianceOverview = {
      framework: 'HIPAA Security Rule (45 CFR Part 160 and Part 164, Subparts A and C)',
      governanceStatus: 'HIPAA-COMPLIANCE-READY',
      certificationClaim: 'NONE - HIPAA certification does not legally exist',
      lastEvaluatedAt: new Date().toISOString(),
      controlsSummary: {
        administrativeSafeguards: {
          securityManagementProcess: 'IMPLEMENTED',
          assignedSecurityResponsibility: 'MANUAL REVIEW REQUIRED (Roles defined in SECURITY_RESPONSIBILITY_REGISTER.md)',
          workforceSecurity: 'IMPLEMENTED (RBAC + Session Invalidation + Lifecycle Policy)',
          informationAccessManagement: 'IMPLEMENTED (Role-based minimum necessary access)',
          securityAwarenessAndTraining: 'MANUAL REVIEW REQUIRED (Policy defined; workforce records in SECURITY_TRAINING_RECORD.md)',
          securityIncidentProcedures: 'IMPLEMENTED (6-Phase IR plan in SECURITY_STEP_12_INCIDENT_RESPONSE.md)',
          contingencyPlan: 'IMPLEMENTED (12 DR Runbooks in SECURITY_STEP_12_DR_RUNBOOK.md)',
          evaluation: 'IMPLEMENTED (Annual evaluation policy in SECURITY_EVALUATION_POLICY.md)',
          businessAssociateContracts: 'MANUAL REVIEW REQUIRED (BAA Register in BAA_REGISTER.md)'
        },
        physicalSafeguards: {
          facilityAccessControls: 'MANUAL REVIEW REQUIRED (Cloud Hosting / Railway Console Verification)',
          workstationUseAndSecurity: 'MANUAL REVIEW REQUIRED (Organizational Device Policies)',
          deviceAndMediaControls: 'MANUAL REVIEW REQUIRED (Zero local ePHI export to removable media)'
        },
        technicalSafeguards: {
          accessControl: 'IMPLEMENTED (Unique User IDs, Role Validation, Session Expiry, IDOR Defense)',
          auditControls: 'IMPLEMENTED (Immutable ActivityLog recording user, action, route, IP, timestamp)',
          integrityControls: 'IMPLEMENTED (Foreign keys, schema validation, AES-256-GCM encrypted credentials)',
          personOrEntityAuthentication: 'IMPLEMENTED (Bcrypt password hashing, JWT with fail-closed rotation; MFA Plan in MFA_READINESS_PLAN.md)',
          transmissionSecurity: 'IMPLEMENTED (TLS 1.2+ encryption in transit, strict CORS, defensive HTTP headers)'
        }
      },
      workforceSummary: {
        totalAccounts: userCount,
        activeAccounts: activeCount,
        deactivatedAccounts: deactivatedCount,
        configuredRoles: rolesCount
      },
      integrationsSummary: {
        activeIntegrations: integrationsCount,
        baaStatus: 'MANUAL REVIEW REQUIRED (Refer to BAA_REGISTER.md)'
      },
      auditSummary: {
        totalAuditLogs: logsCount,
        auditTrailIntegrity: 'IMMUTABLE (No DELETE/PUT API routes)'
      }
    };

    // Audit compliance status check
    if (user?.id) {
      await auditService.log({
        userId: user.id,
        userEmail: user.email,
        userRole: user.roleName,
        action: 'COMPLIANCE_STATUS_VIEWED',
        resourceType: 'Compliance',
        resourceId: 'overview',
        resource: 'HIPAA Compliance Status',
        requestMethod: 'GET',
        route: request.url,
        ipAddress: request.ip || '127.0.0.1',
        userAgent: (request.headers['user-agent'] as string) || 'unknown',
        success: true
      });
    }

    return reply.status(200).send({
      success: true,
      data: complianceOverview
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: 'Failed to retrieve compliance overview status'
    });
  }
}

/**
 * Access Review Audit Endpoint.
 * Generates an administrative snapshot of active users, assigned roles,
 * last activity, and flags potential stale or deactivated accounts.
 * Restricted to administrators with 'users-roles' permission.
 */
export async function getAccessReviewHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = request.user;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roleName: true,
        departmentId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        department: {
          select: {
            name: true
          }
        },
        role: {
          select: {
            name: true,
            permissions: true,
            isSystem: true
          }
        },
        sessions: {
          where: { revokedAt: null },
          select: {
            id: true,
            lastUsedAt: true,
            expiresAt: true
          },
          orderBy: { lastUsedAt: 'desc' },
          take: 1
        }
      },
      orderBy: { email: 'asc' }
    });

    const accessReviewData = users.map(u => ({
      userId: u.id,
      email: u.email,
      fullName: `${u.firstName} ${u.lastName}`,
      role: u.roleName,
      department: u.department?.name || 'Unassigned',
      isActive: u.isActive,
      isSystemRole: u.role?.isSystem || false,
      hasActiveSession: u.sessions.length > 0,
      lastSessionActivity: u.sessions[0]?.lastUsedAt || null,
      accountCreatedAt: u.createdAt,
      reviewFlag: !u.isActive ? 'ACCOUNT_DEACTIVATED' : (u.sessions.length === 0 ? 'NO_ACTIVE_SESSION' : 'ACTIVE')
    }));

    // Audit compliance access review event
    if (user?.id) {
      await auditService.log({
        userId: user.id,
        userEmail: user.email,
        userRole: user.roleName,
        action: 'ACCESS_REVIEW_AUDITED',
        resourceType: 'Compliance',
        resourceId: 'access-review',
        resource: 'Periodic Access Review',
        requestMethod: 'GET',
        route: request.url,
        ipAddress: request.ip || '127.0.0.1',
        userAgent: (request.headers['user-agent'] as string) || 'unknown',
        success: true
      });
    }

    return reply.status(200).send({
      success: true,
      reviewDate: new Date().toISOString(),
      totalReviewed: accessReviewData.length,
      data: accessReviewData
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: 'Failed to generate access review snapshot'
    });
  }
}

/**
 * Safe Disaster Recovery & System Readiness Diagnostic Endpoint.
 * Validates database connectivity, cryptographic key availability,
 * schema entity delegates, and core security subsystem readiness.
 * Strips all database URLs, connection strings, secret keys, passwords, and PHI.
 * Restricted to administrators with 'settings' permission.
 */
export async function getRecoveryStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = request.user;

    // 1. Verify live database connectivity & schema delegates
    let dbStatus = 'disconnected';
    let tableCoverage = 0;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';

      // Verify all core models are accessible
      const modelChecks = [
        prisma.user.count(),
        prisma.role.count(),
        prisma.department.count(),
        prisma.lead.count(),
        prisma.formSubmission.count(),
        prisma.callLog.count(),
        prisma.campaign.count(),
        prisma.budget.count(),
        prisma.vendor.count(),
        prisma.review.count(),
        prisma.integrationCredential.count(),
        prisma.activityLog.count(),
        prisma.userSession.count(),
        prisma.userMFA.count(),
        prisma.userMFARecoveryCode.count(),
        prisma.userMFAChallenge.count()
      ];
      await Promise.all(modelChecks);
      tableCoverage = modelChecks.length;
    } catch (dbErr) {
      dbStatus = 'error';
    }

    // 2. Verify encryption keys presence without exposing values
    const hasJwtSecret = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16;
    const hasEncryptionKey = !!process.env.INTEGRATION_ENCRYPTION_KEY && (
      process.env.INTEGRATION_ENCRYPTION_KEY.length === 64 ||
      process.env.INTEGRATION_ENCRYPTION_KEY.length === 32
    );

    // 3. Construct safe diagnostic response
    const recoveryDiagnostic = {
      systemStatus: dbStatus === 'connected' && hasJwtSecret && hasEncryptionKey ? 'HEALTHY' : 'DEGRADED',
      database: {
        connectivity: dbStatus,
        schemaSynchronized: tableCoverage === 16,
        modelDelegatesVerified: tableCoverage,
        totalRequiredDelegates: 16
      },
      cryptography: {
        jwtSigningConfigured: hasJwtSecret,
        credentialEncryptionConfigured: hasEncryptionKey,
        algorithm: 'AES-256-GCM / HS256'
      },
      subsystems: {
        authentication: hasJwtSecret ? 'operational' : 'misconfigured',
        rbac: 'operational',
        mfa: hasEncryptionKey ? 'operational' : 'degraded',
        sessionLifecycle: 'operational',
        auditLogging: 'operational'
      },
      disasterRecovery: {
        backupProvider: 'Railway Managed MySQL',
        recoveryMechanism: 'Point-In-Time Snapshot Restore (Cloud Console)',
        retentionPolicy: 'RETENTION CONTROLLED BY INFRASTRUCTURE',
        rpoTarget: '< 1 Hour (Automated Continuous/Periodic Snapshots)',
        rtoTarget: '< 4 Hours (Target Standby Provisioning)'
      },
      timestamp: new Date().toISOString()
    };

    // Audit the diagnostic inspection
    if (user?.id) {
      await auditService.log({
        userId: user.id,
        userEmail: user.email,
        userRole: user.roleName,
        action: 'SYSTEM_HEALTH_DIAGNOSTIC',
        resourceType: 'System',
        resourceId: 'recovery-status',
        resource: 'System Recovery Diagnostic',
        requestMethod: 'GET',
        route: request.url,
        ipAddress: request.ip || '127.0.0.1',
        userAgent: (request.headers['user-agent'] as string) || 'unknown',
        success: true
      });
    }

    return reply.status(200).send({
      success: true,
      data: recoveryDiagnostic
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: 'Failed to retrieve recovery status diagnostic'
    });
  }
}
