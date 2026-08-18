import { PrismaClient, Role } from '@prisma/client';
import { PasswordUtility } from '../src/auth/utils/password.utility';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial admin users...');

  const superAdminPasswordHash = await PasswordUtility.hash('SuperAdmin123!');
  const moderatorPasswordHash = await PasswordUtility.hash('Moderator123!');

  // Seed Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@unitedunion.com' },
    update: {
      role: Role.SUPERADMIN,
      emailVerified: true,
    },
    create: {
      email: 'superadmin@unitedunion.com',
      passwordHash: superAdminPasswordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.SUPERADMIN,
      emailVerified: true,
    },
  });
  console.log('Super Admin created:', superAdmin.email);

  // Seed Moderator
  const moderator = await prisma.user.upsert({
    where: { email: 'moderator@unitedunion.com' },
    update: {
      role: Role.ADMIN,
      emailVerified: true,
    },
    create: {
      email: 'moderator@unitedunion.com',
      passwordHash: moderatorPasswordHash,
      firstName: 'Support',
      lastName: 'Moderator',
      role: Role.ADMIN,
      emailVerified: true,
    },
  });
  console.log('Moderator created:', moderator.email);

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
