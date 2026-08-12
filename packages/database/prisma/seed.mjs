import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The development account seed is disabled in production.');
}

const email = required('DEV_ADMIN_EMAIL').trim().toLowerCase();
const username = required('DEV_ADMIN_USERNAME').trim().toLowerCase();
const password = required('DEV_ADMIN_PASSWORD');
if (password.length < 12)
  throw new Error('DEV_ADMIN_PASSWORD must contain at least 12 characters.');

const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    include: { memberships: true },
  });

  if (existing) {
    if (existing.email !== email || existing.username !== username) {
      throw new Error('The development email or username belongs to a different account.');
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      },
    });
  } else {
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { email, username, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      const organization = await transaction.organization.create({
        data: { name: `${username} workspace`, slug: await availableSlug(transaction, username) },
      });
      await transaction.organizationMember.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          organizationId: organization.id,
          action: 'DEVELOPMENT_ACCOUNT_SEEDED',
          resourceType: 'User',
          resourceId: user.id,
        },
      });
    });
  }
  process.stdout.write(`Development account ready: ${email}\n`);
} finally {
  await prisma.$disconnect();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function availableSlug(transaction, base) {
  for (const candidate of [`${base}-dev`, `${base}-local`, `${base}-workspace`]) {
    if (!(await transaction.organization.findUnique({ where: { slug: candidate } }))) {
      return candidate;
    }
  }
  throw new Error('Unable to reserve a development organization slug.');
}
