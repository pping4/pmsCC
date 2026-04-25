export type NavItem = {
  href: string;
  label: string;
  icon: string;
  keywords?: string;
  /**
   * Optional RBAC guard. If present, the sidebar hides this item when the
   * current user lacks the permission. When omitted, the item is visible
   * to any authenticated user (server routes still enforce their own
   * checks, so this is a UX filter only).
   *
   * Use `canAny: [...]` when any one of several perms should show the item.
   */
  permission?: string;
  canAny?: string[];
};

export type NavCategory = {
  key: string;
  title: string;
  items: NavItem[];
};

export const NAV_CATEGORIES: NavCategory[] = [
  {
    key: 'operations',
    title: 'หน้างาน / เคาน์เตอร์',
    items: [
      { href: '/dashboard',   label: 'Dashboard',             icon: '📊', keywords: 'home หน้าแรก overview' },
      { href: '/reservation', label: 'ตารางการจอง',             icon: '📋', keywords: 'reservation tape chart checkin checkout arrival departure', permission: 'reservation.view' },
      { href: '/rooms',       label: 'ห้องพัก',                  icon: '🏠', keywords: 'room status', canAny: ['reservation.view', 'housekeeping.view'] },
      { href: '/guests',      label: 'ลูกค้า',                   icon: '👥', keywords: 'guest customer profile', permission: 'reservation.view' },
      { href: '/utilities',   label: 'มิเตอร์น้ำ-ไฟ',            icon: '⚡', keywords: 'utility meter water electric', permission: 'reservation.view' },
    ],
  },
  {
    key: 'finance',
    title: 'การเงิน / บัญชี',
    items: [
      { href: '/finance/money-overview', label: 'ภาพรวมเงิน',       icon: '💰', keywords: 'money overview balance cash bank ภาพรวม ยอดคงเหลือ', permission: 'finance.view_reports' },
      { href: '/finance/statements',     label: 'งบการเงิน',        icon: '📈', keywords: 'statement pl bs balance sheet profit loss งบดุล กำไรขาดทุน', permission: 'finance.view_reports' },
      { href: '/cashier',       label: 'แคชเชียร์ / กะ',         icon: '🏧', keywords: 'cashier session shift', canAny: ['cashier.open_shift', 'cashier.record_payment', 'cashier.view_other_shifts'] },
      { href: '/cashier/batch-close', label: 'ส่งยอด EDC / ปิด batch', icon: '💳', keywords: 'edc batch close card terminal ส่งยอด ปิดบัตร', permission: 'cashier.close_shift' },
      { href: '/billing',       label: 'Billing',                icon: '💰', keywords: 'invoice ใบแจ้งหนี้', canAny: ['finance.view_reports', 'finance.post_invoice'] },
      { href: '/accounting/tax-invoices', label: 'ใบกำกับภาษี',    icon: '🧾', keywords: 'tax invoice vat ใบกำกับภาษี ภาษีมูลค่าเพิ่ม', permission: 'finance.post_invoice' },
      { href: '/billing/folio', label: 'Guest Folio',            icon: '📒', keywords: 'folio', canAny: ['reservation.view', 'finance.view_reports'] },
      { href: '/billing-cycle', label: 'รอบบิล / ค่าปรับ',        icon: '📅', keywords: 'cycle penalty renewal', canAny: ['contracts.view', 'finance.view_reports'] },
      { href: '/finance',       label: 'การเงิน / บัญชี',         icon: '📈', keywords: 'accounting finance ledger', permission: 'finance.view_reports' },
      { href: '/city-ledger',   label: 'City Ledger / AR',       icon: '🏢', keywords: 'ar account receivable', permission: 'finance.view_reports' },
      { href: '/bad-debt',      label: 'หนี้เสีย / Bad Debt',     icon: '⚠️', keywords: 'bad debt', permission: 'finance.view_reports' },
      { href: '/refunds',       label: 'คืนเงิน / Refunds',        icon: '💸', keywords: 'refund pending คืนเงิน', canAny: ['cashier.refund', 'finance.approve_refund'] },
    ],
  },
  {
    key: 'sales',
    title: 'การขาย / สินค้า',
    items: [
      { href: '/products', label: 'สินค้า/บริการ',    icon: '📦', keywords: 'product service inventory' },
    ],
  },
  {
    key: 'services',
    title: 'บริการห้องพัก',
    items: [
      { href: '/housekeeping', label: 'แม่บ้าน',   icon: '🧹', keywords: 'housekeeping cleaning maid', permission: 'housekeeping.view' },
      { href: '/maintenance',  label: 'ซ่อมบำรุง', icon: '🔧', keywords: 'maintenance repair', canAny: ['maintenance.view', 'maintenance.create_ticket'] },
    ],
  },
  {
    key: 'admin',
    title: 'รายงาน / ตั้งค่า',
    items: [
      { href: '/tm30',           label: 'รายงาน ตม.30',     icon: '🛂', keywords: 'tm30 immigration', permission: 'reservation.view' },
      { href: '/nightaudit',     label: 'Night Audit',      icon: '🌙', keywords: 'night audit close day', canAny: ['finance.view_reports', 'finance.manage_fiscal_period'] },
      { href: '/ota-reconciliation',    label: 'OTA Reconciliation',  icon: '🌐', keywords: 'ota commission agoda booking expedia reconciliation statement คอมมิชชั่น', permission: 'finance.view_reports' },
      { href: '/reports/vat-sales',     label: 'รายงานภาษีขาย VAT',   icon: '🧾', keywords: 'vat sales report tax ภาษีขาย ภพ30 pp30', permission: 'finance.view_reports' },
      { href: '/settings/hotel',        label: 'ตั้งค่าโรงแรม / VAT', icon: '⚙️', keywords: 'hotel settings vat service charge ภาษี ค่าบริการ ตั้งค่า', permission: 'admin.manage_settings' },
      { href: '/settings/period-close', label: 'ปิดงวดบัญชี',     icon: '📅', keywords: 'period close fiscal month ปิดงวด บัญชี', permission: 'finance.manage_fiscal_period' },
      { href: '/settings/rates',    label: 'กำหนดราคาห้องพัก',   icon: '🏷️', keywords: 'rate price setting', permission: 'admin.manage_settings' },
      { href: '/settings/accounts',   label: 'บัญชีการเงิน / ลิ้นชัก', icon: '🏦', keywords: 'bank cash account accounts ledger บัญชี ลิ้นชัก เงินสด ธนาคาร', permission: 'admin.manage_settings' },
      { href: '/settings/cash-boxes', label: 'เคาน์เตอร์แคชเชียร์',     icon: '🏧', keywords: 'cash box counter cashier drawer เคาน์เตอร์ ลิ้นชัก แคชเชียร์', permission: 'admin.manage_settings' },
      { href: '/settings/users',    label: 'จัดการผู้ใช้',         icon: '👤', keywords: 'user management role permission จัดการผู้ใช้ สิทธิ์', permission: 'admin.manage_users' },
      { href: '/settings/roles',    label: 'Role reference',      icon: '🔐', keywords: 'role permission reference รายการสิทธิ์', permission: 'admin.manage_users' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_CATEGORIES.flatMap(c => c.items);

export const MOBILE_PRIMARY_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'หน้าแรก', icon: '📊' },
  { href: '/reservation', label: 'จอง',     icon: '📋' },
  { href: '/rooms',     label: 'ห้องพัก',  icon: '🏠' },
];
