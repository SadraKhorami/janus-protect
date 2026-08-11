import {
  OrganizationRole as PrismaOrganizationRole,
  Prisma,
  type PrismaClient,
  UserStatus as PrismaUserStatus,
} from '@janus/database';
import { OrganizationRole, UserStatus } from '@janus/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../../app.tokens';
import { errors } from '../../common/errors/application-error';
import type {
  AccountRecord,
  PasswordResetRecord,
  SessionRecord,
  UserRecord,
  VerificationRecord,
} from '../domain/auth.models';
import type { AuthRepository } from '../domain/auth.ports';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email } }) as Promise<UserRecord | null>;
  }

  async findUserByIdentifier(identifier: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    }) as Promise<UserRecord | null>;
  }

  async findAccount(userId: string): Promise<AccountRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { take: 1, include: { organization: true } } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) return null;
    return {
      ...user,
      status: user.status as UserStatus,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role as OrganizationRole,
      },
    };
  }

  async registerPersonalAccount(input: {
    email: string;
    username: string;
    passwordHash: string;
    organizationName: string;
    organizationSlug: string;
    verificationCodeHash: string;
    verificationExpiresAt: Date;
  }): Promise<UserRecord> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email: input.email,
            username: input.username,
            passwordHash: input.passwordHash,
            status: PrismaUserStatus.UNVERIFIED,
          },
        });
        const organization = await transaction.organization.create({
          data: { name: input.organizationName, slug: input.organizationSlug },
        });
        await transaction.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: PrismaOrganizationRole.OWNER,
          },
        });
        await transaction.emailVerification.create({
          data: {
            userId: user.id,
            codeHash: input.verificationCodeHash,
            expiresAt: input.verificationExpiresAt,
          },
        });
        return user;
      })) as UserRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw errors.conflict();
      }
      throw error;
    }
  }

  async latestVerification(userId: string): Promise<VerificationRecord | null> {
    return this.prisma.emailVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async incrementVerificationAttempt(id: string): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  async replaceVerification(input: {
    id: string;
    codeHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id: input.id },
      data: {
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        lastSentAt: input.sentAt,
        attemptCount: 0,
        resendCount: { increment: 1 },
      },
    });
  }

  async verifyEmail(userId: string, verificationId: string, verifiedAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: verificationId },
        data: { usedAt: verifiedAt },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { status: PrismaUserStatus.ACTIVE, emailVerifiedAt: verifiedAt },
      }),
    ]);
  }

  async createSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return this.prisma.authSession.create({ data: input });
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    return this.prisma.authSession.findUnique({ where: { id } });
  }

  async rotateSession(
    id: string,
    expectedHash: string,
    replacementHash: string,
    usedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { id, refreshTokenHash: expectedHash, revokedAt: null, expiresAt: { gt: usedAt } },
      data: { refreshTokenHash: replacementHash, lastUsedAt: usedAt },
    });
    return result.count === 1;
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeAllSessions(userId: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async createPasswordReset(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const invalidatedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: invalidatedAt },
      }),
      this.prisma.passwordReset.create({ data: input }),
    ]);
  }

  async findPasswordReset(id: string): Promise<PasswordResetRecord | null> {
    return this.prisma.passwordReset.findUnique({ where: { id } });
  }

  async resetPassword(input: {
    resetId: string;
    userId: string;
    passwordHash: string;
    usedAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: input.resetId },
        data: { usedAt: input.usedAt },
      }),
      this.prisma.passwordReset.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: input.usedAt },
      }),
      this.prisma.user.update({
        where: { id: input.userId },
        data: { passwordHash: input.passwordHash },
      }),
    ]);
  }
}
