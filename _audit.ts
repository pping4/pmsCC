import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const issues: string[] = [];
  const ok: string[] = [];

  const banks = await p.financialAccount.findMany({
    where: { subKind: 'BANK' },
    select: { code: true, name: true, ownerType: true, bankName: true, bankAccountName: true, isActive: true, isSystem: true, isDefault: true },
    orderBy: { code: 'asc' },
  });
  console.log('- BANK ACCOUNTS ---');
  for (const b of banks) console.log(`  ${b.code}  ${b.name.padEnd(30)} owner=${b.ownerType}  bank=${b.bankName ?? '-'}  default=${b.isDefault}`);
  const co = banks.filter(b => b.ownerType === 'COMPANY').length;
  const pe = banks.filter(b => b.ownerType === 'PERSONAL').length;
  (co === 2 ? ok : issues).push(`COMPANY bank accts = ${co} (expected 2)`);
  (pe === 1 ? ok : issues).push(`PERSONAL bank accts = ${pe} (expected 1)`);

  const cc = await p.financialAccount.findMany({ where: { subKind: 'CARD_CLEARING' }, select: { code: true, name: true }, orderBy: { code: 'asc' } });
  console.log('\n- CARD CLEARING ACCOUNTS ---');
  for (const c of cc) console.log(`  ${c.code}  ${c.name}`);
  (cc.length >= 2 ? ok : issues).push(`CARD_CLEARING >= 2 (got ${cc.length})`);

  const terms = await p.edcTerminal.findMany({
    select: { code: true, name: true, acquirerBank: true, allowedBrands: true, isActive: true, clearingAccount: { select: { code: true } } },
    orderBy: { code: 'asc' },
  });
  console.log('\n- EDC TERMINALS ---');
  for (const t of terms) console.log(`  ${t.code}  ${t.name.padEnd(30)} acquirer=${t.acquirerBank}  clearing=${t.clearingAccount.code}  brands=[${t.allowedBrands.join(',') || 'all'}]`);
  (terms.length === 2 ? ok : issues).push(`edcTerminal.count() = ${terms.length} (expected 2)`);
  (terms.every(t => t.allowedBrands.length === 0) ? ok : issues).push('all terminals accept all brands');

  const rates = await p.cardFeeRate.findMany({ where: { terminalId: null, cardType: null }, orderBy: { brand: 'asc' } });
  console.log('\n- DEFAULT MDR RATES ---');
  for (const r of rates) console.log(`  ${r.brand.padEnd(10)} ${r.ratePercent.toString()}%`);
  const want: Record<string, number> = { VISA: 1.75, MASTER: 1.75, JCB: 2.00, UNIONPAY: 1.60, AMEX: 3.00 };
  for (const [b, v] of Object.entries(want)) {
    const r = rates.find(x => x.brand === (b as any));
    if (!r) issues.push(`MDR missing: ${b}`);
    else if (Number(r.ratePercent) !== v) issues.push(`MDR ${b} = ${r.ratePercent} (expected ${v})`);
    else ok.push(`MDR ${b} = ${v}`);
  }

  const seqs = await p.numberSequence.findMany({ orderBy: { kind: 'asc' } });
  console.log('\n- NUMBER SEQUENCES ---');
  for (const s of seqs) console.log(`  ${s.kind.padEnd(12)} prefix=${s.prefix}  next=${s.nextSeq}  reset=${s.resetEvery}`);
  (seqs.find(s => s.kind === 'TAX_INVOICE')?.resetEvery === 'MONTHLY' ? ok : issues).push('TAX_INVOICE resetEvery=MONTHLY');
  (seqs.find(s => s.kind === 'RECEIPT')?.resetEvery === 'YEARLY' ? ok : issues).push('RECEIPT resetEvery=YEARLY');
  (seqs.find(s => s.kind === 'TAX_INVOICE')?.prefix === 'TI' ? ok : issues).push('TAX_INVOICE prefix=TI');
  (seqs.find(s => s.kind === 'RECEIPT')?.prefix === 'RC' ? ok : issues).push('RECEIPT prefix=RC');

  const cols: any[] = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
    FROM information_schema.columns
    WHERE table_name='payments'
      AND column_name IN ('receiving_account_id','slip_image_url','slip_ref_no','card_brand','card_type','card_last4','auth_code','terminal_id','batch_no','recon_status','cleared_at','cleared_by')
    ORDER BY column_name
  `);
  console.log('\n- PAYMENT TABLE NEW COLUMNS ---');
  for (const c of cols) console.log(`  ${c.column_name.padEnd(22)} ${String(c.data_type).padEnd(20)} null=${c.is_nullable}  default=${c.column_default ?? '-'}  len=${c.character_maximum_length ?? '-'}`);
  const expected = ['auth_code','batch_no','card_brand','card_last4','card_type','cleared_at','cleared_by','receiving_account_id','recon_status','slip_image_url','slip_ref_no','terminal_id'];
  const got = cols.map(c => c.column_name).sort();
  (JSON.stringify(got) === JSON.stringify(expected) ? ok : issues).push(`Payment new columns = ${got.length}/12`);
  (cols.find(c => c.column_name === 'recon_status')?.column_default?.toString().includes('RECEIVED') ? ok : issues).push('recon_status default=RECEIVED');
  (cols.find(c => c.column_name === 'card_type')?.column_default?.toString().includes('NORMAL') ? ok : issues).push('card_type default=NORMAL');
  (cols.find(c => c.column_name === 'recon_status')?.is_nullable === 'NO' ? ok : issues).push('recon_status NOT NULL');
  (cols.find(c => c.column_name === 'slip_ref_no')?.is_nullable === 'YES' ? ok : issues).push('slip_ref_no nullable');
  (cols.find(c => c.column_name === 'card_last4')?.character_maximum_length === 4 ? ok : issues).push('card_last4 varchar(4)');
  (cols.find(c => c.column_name === 'auth_code')?.character_maximum_length === 12 ? ok : issues).push('auth_code varchar(12)');

  const idx: any[] = await p.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename='payments' ORDER BY indexname`);
  console.log('\n- PAYMENT INDEXES ---');
  for (const i of idx) console.log(`  ${i.indexname}`);
  const wantIdx = [
    'payments_amount_payment_date_idx',
    'payments_batch_no_idx',
    'payments_receiving_account_id_idx',
    'payments_recon_status_created_at_idx',
    'payments_recon_status_idx',
    'payments_slip_ref_no_key',
    'payments_terminal_id_idx',
  ];
  for (const w of wantIdx) (idx.find(i => i.indexname === w) ? ok : issues).push(`index ${w}`);

  const ownerCol: any[] = await p.$queryRawUnsafe(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='financial_accounts' AND column_name='owner_type'`);
  (ownerCol.length === 1 && ownerCol[0].is_nullable === 'YES' ? ok : issues).push(`financial_accounts.owner_type (nullable)`);

  const tables: any[] = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('edc_terminals','card_fee_rates','card_batch_reports','number_sequences','tax_invoices')
    ORDER BY table_name
  `);
  console.log('\n- NEW TABLES ---');
  for (const t of tables) console.log(`  ${t.table_name}`);
  (tables.length === 5 ? ok : issues).push(`new tables count = ${tables.length}/5`);

  const fks: any[] = await p.$queryRawUnsafe(`
    SELECT c.conname, c.conrelid::regclass::text AS src, c.confrelid::regclass::text AS tgt, c.confdeltype AS del
    FROM pg_constraint c
    WHERE c.contype='f'
      AND c.conrelid::regclass::text IN ('payments','edc_terminals','card_fee_rates','card_batch_reports')
    ORDER BY c.conname
  `);
  console.log('\n- FOREIGN KEYS (payments + new tables) ---');
  for (const f of fks) {
    const del = f.del === 'n' ? 'SET NULL' : f.del === 'r' ? 'RESTRICT' : f.del === 'c' ? 'CASCADE' : f.del === 'a' ? 'NO ACTION' : f.del;
    console.log(`  ${String(f.conname).padEnd(55)} ${f.src} -> ${f.tgt}  on_delete=${del}`);
  }

  const pay = await p.payment.findMany({ select: { id: true, reconStatus: true, paymentMethod: true, cardType: true }, take: 5 });
  console.log(`\n- EXISTING PAYMENTS (sample ${pay.length}) ---`);
  for (const x of pay) console.log(`  ${x.id.slice(0,8)}  method=${x.paymentMethod.padEnd(12)} recon=${x.reconStatus}  cardType=${x.cardType ?? '-'}`);
  (pay.every(x => x.reconStatus === 'RECEIVED') ? ok : issues).push('existing payments default recon=RECEIVED');
  (pay.every(x => x.cardType === 'NORMAL') ? ok : issues).push('existing payments default cardType=NORMAL');

  const decPrec: any[] = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE (table_name='card_fee_rates' AND column_name='rate_percent')
       OR (table_name='card_batch_reports' AND column_name IN ('total_amount','variance_amount'))
       OR (table_name='tax_invoices' AND column_name IN ('subtotal','vat_amount','grand_total'))
    ORDER BY table_name, column_name
  `);
  console.log('\n- DECIMAL PRECISION ---');
  for (const d of decPrec) {
    const p_ = `${d.numeric_precision},${d.numeric_scale}`;
    const want_ = d.column_name === 'rate_percent' ? '6,4' : '14,2';
    const pass = p_ === want_;
    console.log(`  ${d.table_name}.${d.column_name} = (${p_}) ${pass ? 'OK' : `FAIL want (${want_})`}`);
    (pass ? ok : issues).push(`${d.table_name}.${d.column_name} = (${p_})`);
  }

  const uniqIdx: any[] = await p.$queryRawUnsafe(`
    SELECT t.relname AS table, i.relname AS index
    FROM pg_class t
    JOIN pg_index x ON x.indrelid=t.oid
    JOIN pg_class i ON i.oid=x.indexrelid
    WHERE x.indisunique AND t.relname IN ('edc_terminals','card_batch_reports','number_sequences','tax_invoices')
    ORDER BY t.relname, i.relname
  `);
  console.log('\n- UNIQUE INDEXES (new tables) ---');
  for (const u of uniqIdx) console.log(`  ${u.table}.${u.index}`);

  console.log('\n============================================');
  console.log(`OK:     ${ok.length}`);
  console.log(`ISSUES: ${issues.length}`);
  for (const i of issues) console.log(`  FAIL - ${i}`);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
