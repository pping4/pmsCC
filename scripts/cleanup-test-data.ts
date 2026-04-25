/**
 * scripts/cleanup-test-data.ts
 *
 * Wipes all transactional / test data, keeps master + config data so the app
 * continues to work (login, room plan, settings, rate plans, HK team).
 *
 * KEEPS:   User, Room, RoomType, RoomRate, RatePlan-ish, HotelSettings,
 *          MaidTeam, Maid, MaidTeamMember, FinancialAccount, FiscalPeriod,
 *          OtaAgent, CashBox, Product
 *
 * DELETES: Everything else (bookings, folios, payments, invoices,
 *          housekeeping tasks, schedules, activity logs, maintenance,
 *          inspections, ledger entries, ota statements, security deposits,
 *          transfers, refunds, idempotency, saved views, guests, payouts,
 *          utility readings, rate audits, cash sessions).
 *
 * Run with:  npx tsx scripts/cleanup-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Starting cleanup of test/transactional data...\n');

  await prisma.$transaction(async (tx) => {
    // ------ deepest children first ------

    // Payment / allocation / audit
    await tx.paymentAuditLog.deleteMany({});
    await tx.paymentAllocation.deleteMany({});

    // City ledger
    await tx.cityLedgerAllocation.deleteMany({});
    await tx.cityLedgerTransaction.deleteMany({});
    await tx.cityLedgerPayment.deleteMany({});
    await tx.cityLedgerAccount.deleteMany({});

    // OTA statements
    await tx.otaStatementLine.deleteMany({});
    await tx.otaStatement.deleteMany({});

    // Invoices
    await tx.invoiceItem.deleteMany({});
    await tx.invoice.deleteMany({});

    // Folio
    await tx.folioLineItem.deleteMany({});
    await tx.folio.deleteMany({});

    // Payments / deposits / refunds / transfers
    await tx.refundRecord.deleteMany({});
    await tx.transferRecord.deleteMany({});
    await tx.securityDeposit.deleteMany({});
    await tx.payment.deleteMany({});

    // Ledger
    await tx.ledgerEntry.deleteMany({});

    // Housekeeping
    await tx.roomInspectionPhoto.deleteMany({});
    await tx.roomInspection.deleteMany({});
    await tx.housekeepingTask.deleteMany({});
    await tx.cleaningSchedule.deleteMany({});
    await tx.maidPayout.deleteMany({});

    // Maintenance
    await tx.maintenanceTask.deleteMany({});

    // Booking children
    await tx.bookingCompanionPhoto.deleteMany({});
    await tx.bookingCompanion.deleteMany({});
    await tx.bookingRoomSegment.deleteMany({});
    await tx.roomMoveHistory.deleteMany({});
    await tx.rateAudit.deleteMany({});

    // Bookings
    await tx.booking.deleteMany({});

    // Guests
    await tx.guest.deleteMany({});

    // Utility / cash session (ops data)
    await tx.utilityReading.deleteMany({});
    await tx.cashSession.deleteMany({});

    // Audit / logs / ephemeral
    await tx.activityLog.deleteMany({});
    await tx.idempotencyRecord.deleteMany({});
    await tx.savedView.deleteMany({});

    console.log('✅ Transactional data wiped.');
  }, { timeout: 60000 });

  // ------ sanity check: what remains ------
  const [users, rooms, roomTypes, settings, teams, maids, agents] = await Promise.all([
    prisma.user.count(),
    prisma.room.count(),
    prisma.roomType.count(),
    prisma.hotelSettings.count(),
    prisma.maidTeam.count(),
    prisma.maid.count(),
    prisma.otaAgent.count(),
  ]);

  console.log('\n📊 Master data preserved:');
  console.log(`   Users:          ${users}`);
  console.log(`   Rooms:          ${rooms}`);
  console.log(`   Room Types:     ${roomTypes}`);
  console.log(`   Hotel Settings: ${settings}`);
  console.log(`   Maid Teams:     ${teams}`);
  console.log(`   Maids:          ${maids}`);
  console.log(`   OTA Agents:     ${agents}`);
  console.log('\n🎉 Cleanup complete. System ready.');
}

main()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
