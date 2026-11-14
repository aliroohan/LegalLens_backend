import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { ENV } from '../config/env.ts';
import { UserModel } from '../models/user.model.ts';
import { OrganizationModel } from '../models/organization.model.ts';
import { USER_ROLES, BAR_ID_STATUS, ORG_STATUS, type UserRole, type BarIdStatus } from '../config/constants.ts';

const DEMO_PASSWORD = 'LegalLens123!';

async function upsertUser(input: {
  email: string;
  name: string;
  role: UserRole;
  orgId?: string;
  isIndependent?: boolean;
  barId?: string;
  barIdStatus: BarIdStatus;
}) {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing) {
    console.log(`exists  ${input.email}`);
    return existing;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await UserModel.create({
    userId: crypto.randomUUID(),
    email: input.email,
    passwordHash,
    name: input.name,
    role: input.role,
    orgId: input.orgId,
    firmId: input.orgId,
    isIndependent: input.isIndependent ?? false,
    barId: input.barId,
    barIdStatus: input.barIdStatus,
    isActive: true
  });
  console.log(`created ${input.email}`);
  return user;
}

async function main() {
  await mongoose.connect(ENV.MONGO_URI);

  await upsertUser({
    email: 'super@legallens.test',
    name: 'Platform Admin',
    role: USER_ROLES.SUPER_ADMIN,
    barIdStatus: BAR_ID_STATUS.VERIFIED
  });

  let org = await OrganizationModel.findOne({ adminEmail: 'admin@northfirm.test' });
  if (!org) {
    const orgId = crypto.randomUUID();
    const admin = await upsertUser({
      email: 'admin@northfirm.test',
      name: 'North Firm Admin',
      role: USER_ROLES.ORG_ADMIN,
      orgId,
      barId: 'ORG-ADMIN',
      barIdStatus: BAR_ID_STATUS.VERIFIED
    });
    org = await OrganizationModel.create({
      orgId,
      name: 'North Firm',
      adminEmail: 'admin@northfirm.test',
      adminUserId: admin.userId,
      status: ORG_STATUS.ACTIVE
    });
    console.log('created organization North Firm');
  } else {
    await upsertUser({
      email: 'admin@northfirm.test',
      name: 'North Firm Admin',
      role: USER_ROLES.ORG_ADMIN,
      orgId: org.orgId,
      barId: 'ORG-ADMIN',
      barIdStatus: BAR_ID_STATUS.VERIFIED
    });
  }

  await upsertUser({
    email: 'lawyer@northfirm.test',
    name: 'Ayesha Khan',
    role: USER_ROLES.LAWYER,
    orgId: org.orgId,
    barId: 'BAR-1001',
    barIdStatus: BAR_ID_STATUS.VERIFIED
  });

  await upsertUser({
    email: 'solo@legallens.test',
    name: 'Independent Counsel',
    role: USER_ROLES.LAWYER,
    isIndependent: true,
    barId: 'BAR-2002',
    barIdStatus: BAR_ID_STATUS.VERIFIED
  });

  await upsertUser({
    email: 'pending@legallens.test',
    name: 'Pending Counsel',
    role: USER_ROLES.LAWYER,
    isIndependent: true,
    barId: 'BAR-3003',
    barIdStatus: BAR_ID_STATUS.PENDING
  });

  console.log(`Demo password for every seeded account: ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
