/**
 * contract-en.tsx — English-language rental contract template.
 *
 * React Server Component (no 'use client'). Consumed by
 * `renderContractHTML` which runs `renderToStaticMarkup` on the server.
 *
 * Every static English clause below is transcribed verbatim from
 * `docs/contract_EN_template.docx` (items 1 – 11 + Mansion's Regulation 1-21).
 * Variables appear underlined (<u>) or bolded (<strong>) to visually match
 * the docx's filled-blank style.
 *
 * Date helper: `fmtDate` from `@/lib/date-format` returns ISO-style dates
 * (`YYYY-MM-DD`) in keeping with the global CLAUDE.md date rule. The English
 * template never uses Buddhist era or Thai locale formatting.
 *
 * Rules fallback: if `ctx.hotel.rulesMarkdownEN` is provided, those rules are
 * rendered as plain text (one paragraph per line). Otherwise the hardcoded
 * 21-item list below is used — copied verbatim from the docx so new
 * properties can render a valid contract without configuring
 * `HotelSettings.contractRulesEN`.
 */

import type { ContractRenderContext } from '@/types/contract';
import { fmtBaht, fmtDate } from '@/lib/date-format';

// ─── Small presentational helpers ────────────────────────────────────────────

/** Renders an underlined "filled blank" — shows "-" if empty, matches the docx. */
function Blank({ value }: { value: string | number | null | undefined }) {
  const str =
    value === null || value === undefined || value === ''
      ? '-'
      : String(value);
  return <u>{str}</u>;
}

/** Baht value as "<strong>1,234.50</strong> THB" — no ฿ symbol (printed doc). */
function Baht({ n }: { n: number | null | undefined }) {
  return (
    <>
      <strong>{fmtBaht(n ?? 0)}</strong> THB
    </>
  );
}

// ─── Fallback rules (verbatim from docs/contract_EN_template.docx) ───────────

const DEFAULT_RULES_EN: string[] = [
  'The tenant is not allowed to add, correct or adjust the asset or every appliance, both involving electrical or furniture within the room. If infringement, the tenant will be fined 500 THB per damage point.',
  'The tenant is not allowed to nail or glue anything on the wall or any part of the room, otherwise the tenant will be fined 500 THB per damage point.',
  'The tenant is not allowed to play gambling, drink alcohol, bring any illegal thing, inflammable object, hazardous thing, all kinds of narcotic drugs or any disgusting thing into the room, or create any annoyance to the other tenants.',
  'The tenant is not allowed to place shoes or anything along the pathway, otherwise it will be confiscated and the tenant will be fined 100 THB per piece.',
  'The tenant is not allowed to throw out garbage or dust along the pathway or outside the terrace, otherwise the tenant will be fined 200 THB per time.',
  'The tenant is not allowed to hang clothes beyond the terrace edge, otherwise the tenant will be fined 200 THB per time.',
  'If the toilet or water drainage is clogged for any reason, the tenant will be fined 700 THB per time.',
  'The tenant is not allowed to use a brazier, gas stove or mortar in the room or anywhere in the building.',
  'The tenant is not allowed to make loud noise or host a party in the room.',
  'If the tenant has already rented a room but wishes to move to another room or check out, the tenant will be charged 500 THB per room for the final cleaning service.',
  'Outside persons and relatives are not allowed to enter the mansion except with permission from the landlord or the mansion staff.',
  'The tenant is not allowed to keep any kind of animal in the room.',
  'If the tenant does not close the water before leaving the room, or in any case of emergency, the tenant allows the landlord to open the room in order to close the water or take other appropriate action. The tenant shall pay a damage cost of 100 THB per time. The landlord will carry out the action with 2 witnesses throughout, re-lock the room, and inform the tenant afterwards.',
  'There are 3 methods for paying the room rent: pay by cash; pay by credit card with a 3% service charge; or pay by bank transfer.',
  'The tenant shall pay any outstanding room rent, electricity and other service costs without deducting from the deposit amount.',
  'In case of late payment, if payment is made after the 5th of the month the tenant will be fined 100 THB per day; from the 10th onwards the fine is 300 THB per day, and the company may cut off water and electricity.',
  'The tenant must pay the room rent in advance. Failing to use the room so that payment is made later than the due date (1st-5th) is considered a breach of the lease contract.',
  'The tenant shall live in the room for the full period of the contract. If the tenant does not complete the contract term, the full deposit will be forfeited.',
  'Move-out in every case must be notified in writing (forms are available at the reception counter) at least 1 month in advance from the date of the written notice; otherwise 30% of the deposit will be deducted.',
  'The deposit will be returned after deducting any expenses and damage in the room, and after a final cleaning fee of 500 THB (single room) or 1,000 THB (double room). The company will refund by bank transfer within 7 days, or in cash within 7 days after the tenant leaves the mansion.',
  'During the removal of belongings, the tenant must inform the landlord or staff. Moving property out of the room between 17:00 and 08:00 is not allowed.',
];

// ─── Main template ───────────────────────────────────────────────────────────

export function ContractTemplateEN({ ctx }: { ctx: ContractRenderContext }) {
  const { hotel, contract, guest, room } = ctx;

  // Build the full English address line from split fields; each blank shows "-".
  const addr = [
    guest.addressHouseNo,
    guest.addressMoo,
    guest.addressSoi,
    guest.addressRoad,
    guest.addressSubdistrict,
    guest.addressDistrict,
    guest.addressProvince,
    guest.addressPostalCode,
  ];

  const rulesList =
    hotel.rulesMarkdownEN && hotel.rulesMarkdownEN.trim().length > 0
      ? hotel.rulesMarkdownEN
          .split(/\r?\n/)
          .map((s) => s.replace(/^\s*[-*\d.]+\s*/, '').trim())
          .filter((s) => s.length > 0)
      : DEFAULT_RULES_EN;

  const tenantDisplayName = guest.fullName || guest.fullNameTH || '.'.repeat(40);

  return (
    <article className="contract-doc lang-en">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <header>
        <h1>{hotel.nameEn}</h1>
        <h2>{hotel.nameTH}</h2>
        <h3>Room Leasing Contract in {hotel.nameEn}</h3>
        <p className="contract-number no-indent">
          Contract No. <strong>{contract.contractNumber}</strong>
        </p>
        <p className="no-indent">
          This contract is made at {hotel.address}
          {'  '}
          {fmtDate(contract.signedAt)}
        </p>
      </header>

      {/* ─── Recital ──────────────────────────────────────────────── */}
      <section className="clause">
        <p>
          This contract is made between <strong>{hotel.nameEn}</strong>
          {' '}located at {hotel.address}
          {hotel.taxId ? <> (Tax ID {hotel.taxId})</> : null}
          {' '}by <strong>{hotel.authorizedRep}</strong>, the managing director,
          {' '}hereby called &ldquo;The Landlord&rdquo; as one party, and
          {' '}<strong>{guest.fullName || guest.fullNameTH}</strong>
          {' '}age <Blank value={guest.age} /> years
          {' '}nationality <Blank value={guest.nationality} />
          {' '}holding
          {guest.idType === 'passport'
            ? ' passport no. '
            : ' ID card no. '}
          <Blank value={guest.idNumber} />
          {' '}issued on <Blank value={guest.idIssueDate ? fmtDate(guest.idIssueDate) : null} />
          {' '}at <Blank value={guest.idIssuePlace} />
          {' '}with home address no. <Blank value={addr[0]} />
          {' '}Moo <Blank value={addr[1]} />
          {' '}Soi <Blank value={addr[2]} />
          {' '}Road <Blank value={addr[3]} />
          {' '}Sub-District <Blank value={addr[4]} />
          {' '}District <Blank value={addr[5]} />
          {' '}Province <Blank value={addr[6]} />
          {' '}Postcode <Blank value={addr[7]} />
          {' '}Tel. <Blank value={guest.phone} />
          {' '}Line ID <Blank value={guest.lineId} />
          {guest.email ? (
            <>
              {' '}Email <Blank value={guest.email} />
            </>
          ) : null}
          {' '}hereby called &ldquo;The Tenant&rdquo; as another party.
        </p>
        <p>
          Both parties agree to make this contract with the following terms.
        </p>
      </section>

      {/* ─── 1. The Leasing Property ─────────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">1. The Leasing Property</h4>
        <p>
          The Landlord agrees to lease and the Tenant agrees to rent room no.{' '}
          <u>{room.number}</u> on floor <u>{room.floor}</u>,{' '}
          which is a <u>{room.typeName}</u> of {hotel.nameEn},
          {' '}located at {hotel.address}, owned by the Landlord.
        </p>
        <p>
          The Landlord agrees to provide service and to lease, while the
          Tenant agrees to accept the service and to rent the furniture and
          other appliances in the room as listed below. The below items are
          considered part of this contract.
        </p>
        <p className="no-indent">
          <strong>List of furniture and appliances in the room, and services provided:</strong>
        </p>
        <p className="no-indent" style={{ whiteSpace: 'pre-wrap' }}>
          {room.furnitureList || '-'}
        </p>
      </section>

      {/* ─── 2. Purpose of Leasing and Service ───────────────────── */}
      <section className="clause">
        <h4 className="clause-title">2. Purpose of Leasing and Service</h4>
        <p>
          The Tenant agrees to rent the property in item 1 for the purpose of
          living only.
        </p>
        <p>
          The purpose of leasing the furniture and other appliances is for
          use inside the room. The Tenant agrees not to remove the leased
          property, including any furniture or appliances leased afterwards,
          from the rented room under any circumstances.
        </p>
      </section>

      {/* ─── 3. Rate and Period of Leasing ───────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">3. The Rate of Leasing &amp; The Period of Leasing</h4>
        <p>
          The Tenant agrees to rent the property in item 1 for a term of{' '}
          <strong>{contract.durationMonths}</strong> months, from{' '}
          {fmtDate(contract.startDate)} to {fmtDate(contract.endDate)}.
          For this residence the Tenant agrees to pay the Landlord as follows:
        </p>
        <p className="no-indent">
          3.1 Room rent: <Baht n={contract.monthlyRoomRent} /> per month.
        </p>
        {contract.monthlyFurnitureRent > 0 && (
          <p className="no-indent">
            3.2 Rent for appliances in the room:{' '}
            <Baht n={contract.monthlyFurnitureRent} /> per month.
          </p>
        )}
        <p className="no-indent">
          3.3 Electricity according to the meter at{' '}
          <Baht n={contract.electricRate} /> per unit.
          {'  '}Water according to the meter at a minimum of{' '}
          <Baht n={contract.waterRateMin} />, with any excess charged at{' '}
          <Baht n={contract.waterRateExcess} /> per unit.
          {contract.phoneRate != null && contract.phoneRate > 0 && (
            <>
              {' '}Telephone at <Baht n={contract.phoneRate} /> per call,
              excluding long-distance charges.
            </>
          )}
        </p>
        <p className="no-indent">
          3.3.1 The Landlord will notify the Tenant between the 25th and 30th
          of each month, and the Tenant shall pay the amount due together
          with the advance payment for each month.
        </p>
        <p>
          The Tenant agrees to pay the room rent, appliance rent,
          electricity, water and telephone charges to the Landlord within
          day <u>{contract.paymentDueWindow}</u> of the following calendar
          month, every month, until the contract term is completed. If the
          Tenant fails to pay within this period, the Tenant consents that
          this contract will be terminated immediately, without the Landlord
          being required to give any prior notice, whether verbal or written.
        </p>
        <p>
          Upon expiry of the initial term as stated above, if the Tenant
          does not notify the Landlord of move-out, the Tenant shall be
          deemed to have agreed to continue renting the property in item 1.
        </p>
        <p>
          The Landlord reserves the right to change the above rental rate
          after 1 year of the lease term from the date of signing, or as the
          Landlord sees appropriate, without being considered a breach of
          this contract. The Landlord will give the Tenant at least 15 days'
          prior notice of such change.
        </p>
      </section>

      {/* ─── 4. Deposit ──────────────────────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">4. Deposit</h4>
        <p>
          On the date of this contract, the Tenant places a deposit of{' '}
          <Baht n={contract.securityDeposit} /> with the Landlord.
          The Landlord shall return this deposit to the Tenant in full when
          the contract ends, provided that the Tenant has removed all of
          the Tenant's belongings from the room; otherwise the Landlord has
          the right to withhold the deposit.
        </p>
        <p>
          The deposit will be returned to the Tenant only when the contract
          has terminated and the Tenant has completed the full term of the
          lease, without breach of any clause of this contract, without any
          outstanding debt owed to the Landlord, and without any damage to,
          or breakage of, any item or appliance in the rented room; otherwise
          the Landlord shall not return the deposit.
        </p>
        <p>
          Should the deposit be insufficient to cover such damage, the
          Tenant shall be responsible for paying the remaining amount in
          full. If the Tenant does not have sufficient cash to pay the
          shortfall, the Tenant agrees to pledge one of the Tenant's assets
          to the Landlord until such shortfall is fully paid.
        </p>
        {contract.keyFrontDeposit > 0 && (
          <p className="no-indent">
            Front-door key deposit: <Baht n={contract.keyFrontDeposit} /> per key.
          </p>
        )}
        {contract.keyLockDeposit > 0 && (
          <p className="no-indent">
            Lock key deposit: <Baht n={contract.keyLockDeposit} /> per key.
          </p>
        )}
        {contract.keycardDeposit > 0 && (
          <p className="no-indent">
            Key-card deposit: <Baht n={contract.keycardDeposit} /> per card.
          </p>
        )}
        {contract.keycardServiceFee > 0 && (
          <p className="no-indent">
            Key-card service fee: <Baht n={contract.keycardServiceFee} /> per card.
          </p>
        )}
        {contract.parkingStickerFee != null && contract.parkingStickerFee > 0 && (
          <p className="no-indent">
            Car sticker (if any): <Baht n={contract.parkingStickerFee} /> per sticker.
          </p>
        )}
        {contract.parkingMonthly != null && contract.parkingMonthly > 0 && (
          <p className="no-indent">
            Car parking: <Baht n={contract.parkingMonthly} /> per month.
          </p>
        )}
      </section>

      {/* ─── 5. Forsaking the Room / Outstanding Amounts ─────────── */}
      <section className="clause">
        <h4 className="clause-title">5. Forsaking the Room or Outstanding Amounts</h4>
        <p>
          If the Tenant forsakes the rented room for more than 30 days, or
          fails to pay the room rent by the date specified in item 3, the
          Tenant agrees as follows:
        </p>
        <p className="no-indent">
          5.1 The Tenant allows the Landlord to repossess the leased
          property and the Tenant's belongings immediately, and grants the
          Landlord the right to lock the rented room. The Tenant and the
          Tenant's associates shall no longer have access to the rented
          room, and the Landlord may immediately re-lease the room to
          another party.
        </p>
        <p className="no-indent">
          5.2 The Landlord shall collect all items from the rented room and
          store them at a location designated by the Landlord. If within 30
          days the Tenant does not contact the Landlord to retrieve these
          items, the Tenant consents that the Landlord may sell or auction
          the items to recover the outstanding amount.
        </p>
        <p className="no-indent">
          5.3 If the Landlord or the Landlord's representative moves the
          Tenant's belongings and any items are damaged, broken or lost,
          the Tenant shall not make any claim whatsoever.
        </p>
        <p>
          The Tenant acknowledges and clearly understands that water,
          electricity and telephone services are provided by the Landlord
          throughout the term of this lease, on condition that the Tenant
          does not have any outstanding room rent, electricity or telephone
          charges, and that the Tenant does not breach any clause of this
          contract. If the Tenant fails to comply, the Tenant allows the
          Landlord to immediately suspend water and electricity supply and
          cut the telephone line, without any claim for damages by the
          Tenant.
        </p>
      </section>

      {/* ─── 6. Mansion Regulation ───────────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">6. Mansion Regulation</h4>
        <p>
          The Tenant agrees to comply with the regulations the Landlord
          has set or will set or announce from time to time, for good order,
          and such regulations and announcements shall be considered part
          of this contract. If there is any infringement after a warning
          has been given, the Landlord has the right to terminate the
          contract.
        </p>
      </section>

      {/* ─── 7. Maintain the Leasing Property ────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">7. Maintain the Leasing Property</h4>
        <p>
          The Tenant agrees to keep the rented room, including the paint on
          the walls and all appliances inside, clean and in good condition
          at all times. If there is any damage, defect or breakage, the
          Tenant shall be responsible for compensating the Landlord in full.
        </p>
        <p>
          Furthermore, if the Tenant wishes to alter or add anything within
          the rented area, the Tenant must first obtain written permission
          from the Landlord.
        </p>
        <p>
          Any construction, alteration, repair or addition made within the
          rented area shall not be removed or destroyed when the Tenant
          moves out, and shall become the sole property of the Landlord,
          without the Tenant being entitled to claim any damages or expenses.
        </p>
      </section>

      {/* ─── 8. Inspect the Leasing Asset ────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">8. Inspect the Leasing Asset</h4>
        <p>
          The Tenant allows the Landlord or the Landlord's representative
          to inspect the rented room at any time.
        </p>
      </section>

      {/* ─── 9. Tenant Performance ───────────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">9. Tenant Performance</h4>
        <p>
          The Tenant certifies that the Tenant will not sublet the rented
          room to others or allow others to possess the rented room during
          the term of the lease.
        </p>
        <p className="no-indent">
          9.1 The Landlord permits the Tenant to have up to 3 persons
          residing in the room for any single-room type, and up to 5
          persons for any double-room type.
        </p>
        <p className="no-indent">
          9.2 If the Tenant wishes to bring relatives or associates to
          reside in the room beyond the number permitted in 9.1, or to
          substitute another person for the Tenant previously declared,
          the Tenant must obtain prior written permission from the Landlord
          and pay the additional residence fee before such person may
          reside in the room.
        </p>
        <p className="no-indent">
          9.3 The Tenant shall keep the rented room free of dirt and
          malodor, shall not create noise that disturbs other residents,
          and shall not do anything frightening or dangerous to neighbours.
          The Tenant shall not place personal belongings or others'
          belongings outside the rented room in a way that obstructs
          others. The Tenant shall dispose of garbage only at the
          designated area on the ground floor provided by the Landlord.
        </p>
        <p className="no-indent">
          9.4 All belongings brought by the Tenant into the rented room,
          including cars or other assets of the Tenant or others parked or
          kept by the Tenant in the car park or anywhere within the rented
          area, are the sole responsibility of the Tenant in the event of
          damage, loss or breakage.
        </p>
        <p className="no-indent">
          9.5 If any illegal item or illegal act occurs within room no.{' '}
          <u>{room.number}</u>, whether committed by the Tenant, the
          Tenant's associates, or any other person brought in by the
          Tenant, the Tenant shall be fully responsible.
        </p>
        <p className="no-indent">
          9.6 In the case of a fire, this contract shall terminate
          immediately and the Tenant shall have no right to claim any
          damages from the Landlord under any circumstance.
        </p>
      </section>

      {/* ─── 10. Denounce the Contract ───────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">10. Denounce the Contract</h4>
        <p>
          When the Tenant wishes to move out of the rented room or return
          the room to the Landlord, the Tenant shall give written notice
          at least{' '}
          <strong>{contract.noticePeriodDays}</strong> days in advance.
          The Tenant agrees that the Landlord may forfeit the deposit as
          previously agreed, and the Tenant shall pay for any damage
          incurred in the room, as well as water, electricity, telephone,
          cleaning and any other additional service charges.
        </p>
      </section>

      {/* ─── 11. Renege the Contract ─────────────────────────────── */}
      <section className="clause">
        <h4 className="clause-title">11. Renege the Contract</h4>
        <p>
          If the Tenant does not perform according to this contract, the
          Tenant allows the Landlord to claim damages from the Tenant. The
          Tenant agrees that if the Tenant breaches even a single clause,
          this contract shall be deemed terminated, and the Tenant agrees
          to move the Tenant's belongings out of the rented room within
          the time specified by the Landlord.
        </p>
        <p>
          This document is made in two counterparts of identical content.
          The Landlord and the Tenant each retain one counterpart. Both
          parties have read and understood the terms of this contract, and
          therefore sign and affix their seals in the presence of
          witnesses on the date of this contract.
        </p>
      </section>

      {/* ─── Signature block ─────────────────────────────────────── */}
      <section className="signature-grid">
        <div className="signature-block">
          <p className="no-indent">
            Signature <span className="signature-line" /> Lessor
          </p>
          <p className="no-indent">( {hotel.authorizedRep} )</p>
        </div>
        <div className="signature-block">
          <p className="no-indent">
            Signature <span className="signature-line" /> Lessee
          </p>
          <p className="no-indent">( {tenantDisplayName} )</p>
        </div>
        <div className="signature-block">
          <p className="no-indent">
            Signature <span className="signature-line" /> Witness
          </p>
          <p className="no-indent">( .................................................. )</p>
        </div>
        <div className="signature-block">
          <p className="no-indent">
            Signature <span className="signature-line" /> Witness
          </p>
          <p className="no-indent">( .................................................. )</p>
        </div>
      </section>

      {/* ─── Page break ─────────────────────────────────────────── */}
      <div className="page-break-before" />

      {/* ─── Mansion's Regulation ────────────────────────────────── */}
      <section className="clause">
        <header style={{ textAlign: 'center', marginBottom: '8pt' }}>
          <h2>{hotel.nameEn}</h2>
          <h3>Mansion's Regulation (part of the lease contract)</h3>
        </header>
        <ol className="rules-list">
          {rulesList.map((r, idx) => (
            <li key={idx}>{r}</li>
          ))}
        </ol>
        <p>
          The Tenant has read and clearly understood the above regulations
          and acknowledges that these regulations are part of the contract.
          The Tenant is willing to follow them in every respect and has
          signed below as evidence.
        </p>
        <div className="signature-grid">
          <div className="signature-block">
            <p className="no-indent">
              Signature <span className="signature-line" /> Lessee
            </p>
            <p className="no-indent">( {tenantDisplayName} )</p>
            <p className="no-indent">
              Room <u>{room.number}</u>{'  '}
              {fmtDate(contract.signedAt)}
            </p>
          </div>
        </div>
      </section>
    </article>
  );
}
