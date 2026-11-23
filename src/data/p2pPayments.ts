import type { P2PCountryConfig, P2PPaymentMethodDef } from '../types/p2p.ts';

export const GLOBAL_CROSS_BORDER_METHODS: P2PPaymentMethodDef[] = [
  {
    id: 'wise',
    name: 'Wise (TransferWise)',
    category: 'instant_app',
    fieldsHint: 'Wise email, @wisetag, or local receiving IBAN/routing',
  },
  {
    id: 'revolut',
    name: 'Revolut',
    category: 'instant_app',
    fieldsHint: 'Revolut @revtag or phone number',
  },
  {
    id: 'paypal',
    name: 'PayPal (Friends & Family / Goods)',
    category: 'card_wallet',
    fieldsHint: 'PayPal email or @paypal.me handle',
  },
  {
    id: 'remitly',
    name: 'Remitly Mobile / Cash Pickup',
    category: 'cash_remittance',
    fieldsHint: 'Recipient full legal name + mobile wallet / pickup city',
  },
  {
    id: 'worldremit',
    name: 'WorldRemit',
    category: 'cash_remittance',
    fieldsHint: 'Recipient legal name + phone number',
  },
  {
    id: 'western_union',
    name: 'Western Union (MTCN)',
    category: 'cash_remittance',
    fieldsHint: 'Full legal ID name, country & city',
  },
  {
    id: 'moneygram',
    name: 'MoneyGram',
    category: 'cash_remittance',
    fieldsHint: 'Full legal ID name + receiving country',
  },
  {
    id: 'skrill',
    name: 'Skrill',
    category: 'card_wallet',
    fieldsHint: 'Skrill account email',
  },
  {
    id: 'neteller',
    name: 'Neteller',
    category: 'card_wallet',
    fieldsHint: 'Neteller account email / ID',
  },
  {
    id: 'swift_wire',
    name: 'International SWIFT Bank Wire',
    category: 'bank_transfer',
    fieldsHint: 'IBAN / Account #, SWIFT/BIC code, Bank Name & Beneficiary',
  },
];

export const P2P_COUNTRIES: P2PCountryConfig[] = [
  // --- AFRICA ---
  {
    code: 'KE',
    name: 'Kenya',
    currency: 'KES',
    currencySymbol: 'KSh',
    region: 'Africa',
    ratePerUsd: 129.5,
    methods: [
      { id: 'ke_mpesa', name: 'M-Pesa (Safaricom)', category: 'mobile_money', fieldsHint: 'M-Pesa Phone (07xx/01xx) + Registered Name' },
      { id: 'ke_mpesa_paybill', name: 'M-Pesa Till / Paybill', category: 'mobile_money', fieldsHint: 'Paybill/Till Number + Account Reference' },
      { id: 'ke_airtel_money', name: 'Airtel Money Kenya', category: 'mobile_money', fieldsHint: 'Airtel Phone Number + Full Name' },
      { id: 'ke_pesalink', name: 'PesaLink / KCB / Equity Bank', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Account Holder' },
      { id: 'ke_tala_branch', name: 'Co-op / NCBA Loop Transfer', category: 'bank_transfer', fieldsHint: 'Account / Loop Phone + Holder Name' },
    ],
  },
  {
    code: 'NG',
    name: 'Nigeria',
    currency: 'NGN',
    currencySymbol: '₦',
    region: 'Africa',
    ratePerUsd: 1620,
    methods: [
      { id: 'ng_bank_nip', name: 'Nigerian Bank Transfer (NIP Instant)', category: 'bank_transfer', fieldsHint: '10-Digit NUBAN Account # + Bank Name + Holder' },
      { id: 'ng_opay', name: 'OPay', category: 'instant_app', fieldsHint: 'OPay Account # (Phone) + Verified Name' },
      { id: 'ng_palmpay', name: 'PalmPay', category: 'instant_app', fieldsHint: 'PalmPay Account # + Holder Name' },
      { id: 'ng_kuda', name: 'Kuda Microfinance Bank', category: 'instant_app', fieldsHint: 'Kuda Account # or @username' },
      { id: 'ng_moniepoint', name: 'Moniepoint', category: 'bank_transfer', fieldsHint: 'Moniepoint Account # + Name' },
      { id: 'ng_chipper', name: 'Chipper Cash Nigeria', category: 'instant_app', fieldsHint: 'Chipper @tag' },
    ],
  },
  {
    code: 'GH',
    name: 'Ghana',
    currency: 'GHS',
    currencySymbol: '₵',
    region: 'Africa',
    ratePerUsd: 15.8,
    methods: [
      { id: 'gh_mtn_momo', name: 'MTN Mobile Money (MoMo)', category: 'mobile_money', fieldsHint: 'MTN MoMo Number + Registered Name' },
      { id: 'gh_telecel', name: 'Telecel Cash (Vodafone Cash)', category: 'mobile_money', fieldsHint: 'Telecel Number + Registered Name' },
      { id: 'gh_at_money', name: 'AT Money (AirtelTigo)', category: 'mobile_money', fieldsHint: 'AT Number + Registered Name' },
      { id: 'gh_ghipss', name: 'GhIPSS / Ecobank / GCB Instant', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # + Account Holder' },
    ],
  },
  {
    code: 'ZA',
    name: 'South Africa',
    currency: 'ZAR',
    currencySymbol: 'R',
    region: 'Africa',
    ratePerUsd: 18.2,
    methods: [
      { id: 'za_payshap', name: 'PayShap / Instant EFT', category: 'bank_transfer', fieldsHint: 'ShapID or Bank Account + Branch Code' },
      { id: 'za_capitec', name: 'Capitec Pay / Transfer', category: 'bank_transfer', fieldsHint: 'Capitec Account # or Cellphone' },
      { id: 'za_fnb', name: 'FNB GeoPay / eWallet', category: 'instant_app', fieldsHint: 'FNB Account or eWallet Cellphone' },
      { id: 'za_tyme', name: 'TymeBank / Standard / Nedbank / Absa', category: 'bank_transfer', fieldsHint: 'Bank, Account #, Branch Code' },
    ],
  },
  {
    code: 'UG',
    name: 'Uganda',
    currency: 'UGX',
    currencySymbol: 'USh',
    region: 'Africa',
    ratePerUsd: 3720,
    methods: [
      { id: 'ug_mtn_momo', name: 'MTN MoMo Uganda', category: 'mobile_money', fieldsHint: 'MTN Number + Registered Name' },
      { id: 'ug_airtel', name: 'Airtel Money Uganda', category: 'mobile_money', fieldsHint: 'Airtel Number + Registered Name' },
      { id: 'ug_bank', name: 'Stanbic / Centenary Bank Transfer', category: 'bank_transfer', fieldsHint: 'Bank, Account # & Name' },
    ],
  },
  {
    code: 'TZ',
    name: 'Tanzania',
    currency: 'TZS',
    currencySymbol: 'TSh',
    region: 'Africa',
    ratePerUsd: 2680,
    methods: [
      { id: 'tz_mpesa', name: 'Vodacom M-Pesa Tanzania', category: 'mobile_money', fieldsHint: 'M-Pesa Number + Registered Name' },
      { id: 'tz_tigopesa', name: 'Mixx by Yas (Tigo Pesa)', category: 'mobile_money', fieldsHint: 'Tigo Number + Name' },
      { id: 'tz_airtel', name: 'Airtel Money Tanzania', category: 'mobile_money', fieldsHint: 'Airtel Number + Name' },
      { id: 'tz_crdb_nmb', name: 'CRDB / NMB Bank Transfer', category: 'bank_transfer', fieldsHint: 'Bank, Account # & Holder Name' },
    ],
  },
  {
    code: 'RW',
    name: 'Rwanda',
    currency: 'RWF',
    currencySymbol: 'FRw',
    region: 'Africa',
    ratePerUsd: 1365,
    methods: [
      { id: 'rw_mtn_momo', name: 'MTN MoMo Rwanda', category: 'mobile_money', fieldsHint: 'MTN Phone / MoMo Code + Name' },
      { id: 'rw_airtel', name: 'Airtel Money Rwanda', category: 'mobile_money', fieldsHint: 'Airtel Phone + Name' },
      { id: 'rw_bk', name: 'Bank of Kigali / Equity Rwanda', category: 'bank_transfer', fieldsHint: 'Bank & Account #' },
    ],
  },
  {
    code: 'EG',
    name: 'Egypt',
    currency: 'EGP',
    currencySymbol: 'E£',
    region: 'Africa',
    ratePerUsd: 49.5,
    methods: [
      { id: 'eg_instapay', name: 'InstaPay Egypt', category: 'instant_app', fieldsHint: 'InstaPay IPA (@instapay) or Linked Phone' },
      { id: 'eg_vodafone_cash', name: 'Vodafone Cash', category: 'mobile_money', fieldsHint: 'Vodafone Wallet Number' },
      { id: 'eg_orange_etisalat', name: 'Orange Cash / Etisalat Cash', category: 'mobile_money', fieldsHint: 'Mobile Wallet Number' },
      { id: 'eg_cib_nbe', name: 'CIB / NBE / Banque Misr Transfer', category: 'bank_transfer', fieldsHint: 'Bank, IBAN / Account #' },
    ],
  },
  {
    code: 'MA',
    name: 'Morocco',
    currency: 'MAD',
    currencySymbol: 'DH',
    region: 'Africa',
    ratePerUsd: 9.95,
    methods: [
      { id: 'ma_cih', name: 'CIH Bank Instant Transfer', category: 'bank_transfer', fieldsHint: 'CIH RIB / Account # + Full Name' },
      { id: 'ma_attijari', name: 'Attijariwafa / BMCE Bank of Africa', category: 'bank_transfer', fieldsHint: '24-Digit RIB + Holder Name' },
      { id: 'ma_cashplus', name: 'Cash Plus / Wafacash', category: 'cash_remittance', fieldsHint: 'Cash Plus App Phone or Legal ID Name' },
    ],
  },
  {
    code: 'ET',
    name: 'Ethiopia',
    currency: 'ETB',
    currencySymbol: 'Br',
    region: 'Africa',
    ratePerUsd: 124.5,
    methods: [
      { id: 'et_telebirr', name: 'Telebirr', category: 'mobile_money', fieldsHint: 'Telebirr Phone + Full Name' },
      { id: 'et_cbe', name: 'Commercial Bank of Ethiopia (CBE Birr)', category: 'bank_transfer', fieldsHint: 'CBE Account # + Full Name' },
      { id: 'et_awash_abyssinia', name: 'Awash / Abyssinia / Dashen Bank', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Holder' },
    ],
  },
  {
    code: 'CI',
    name: 'Ivory Coast / WAEMU',
    currency: 'XOF',
    currencySymbol: 'CFA',
    region: 'Africa',
    ratePerUsd: 615,
    methods: [
      { id: 'ci_wave', name: 'Wave Mobile Money', category: 'mobile_money', fieldsHint: 'Wave Phone Number + Name' },
      { id: 'ci_orange', name: 'Orange Money', category: 'mobile_money', fieldsHint: 'Orange Money Phone + Name' },
      { id: 'ci_mtn_moov', name: 'MTN MoMo / Moov Money', category: 'mobile_money', fieldsHint: 'Mobile Money Number + Name' },
    ],
  },
  {
    code: 'CM',
    name: 'Cameroon / CEMAC',
    currency: 'XAF',
    currencySymbol: 'FCFA',
    region: 'Africa',
    ratePerUsd: 615,
    methods: [
      { id: 'cm_mtn', name: 'MTN Mobile Money Cameroon', category: 'mobile_money', fieldsHint: 'MTN Number + Registered Name' },
      { id: 'cm_orange', name: 'Orange Money Cameroon', category: 'mobile_money', fieldsHint: 'Orange Number + Registered Name' },
      { id: 'cm_afriland', name: 'Afriland / UBA / Ecobank CEMAC', category: 'bank_transfer', fieldsHint: 'Bank, RIB / Account #' },
    ],
  },

  // --- NORTH AMERICA ---
  {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    currencySymbol: '$',
    region: 'North America',
    ratePerUsd: 1.0,
    methods: [
      { id: 'us_zelle', name: 'Zelle', category: 'instant_app', fieldsHint: 'Zelle Email or US Mobile Number + Enrolled Name' },
      { id: 'us_venmo', name: 'Venmo', category: 'instant_app', fieldsHint: 'Venmo @handle + Last 4 digits' },
      { id: 'us_cashapp', name: 'Cash App', category: 'instant_app', fieldsHint: '$Cashtag + Display Name' },
      { id: 'us_ach_wire', name: 'ACH / FedNow / Domestic Wire', category: 'bank_transfer', fieldsHint: 'Routing #, Account #, Bank Name & Beneficiary' },
      { id: 'us_apple_cash', name: 'Apple Cash / Chime Pay', category: 'instant_app', fieldsHint: 'Chime $tag or Apple Cash Phone' },
    ],
  },
  {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    currencySymbol: 'C$',
    region: 'North America',
    ratePerUsd: 1.39,
    methods: [
      { id: 'ca_interac', name: 'Interac e-Transfer', category: 'instant_app', fieldsHint: 'Autodeposit Email or Phone (or Security Q&A)' },
      { id: 'ca_eft', name: 'RBC / TD / Scotiabank / BMO Direct', category: 'bank_transfer', fieldsHint: 'Institution #, Transit #, Account #' },
      { id: 'ca_wealthsimple', name: 'Wealthsimple Cash / EQ Bank', category: 'instant_app', fieldsHint: 'Wealthsimple $tag or Email' },
    ],
  },
  {
    code: 'MX',
    name: 'Mexico',
    currency: 'MXN',
    currencySymbol: 'MX$',
    region: 'North America',
    ratePerUsd: 20.1,
    methods: [
      { id: 'mx_spei', name: 'SPEI (18-Digit CLABE)', category: 'bank_transfer', fieldsHint: '18-Digit CLABE, Bank Name & Beneficiary' },
      { id: 'mx_codi_dimo', name: 'DiMo / CoDi Transfer', category: 'instant_app', fieldsHint: 'Linked Mobile Number + Bank' },
      { id: 'mx_mercado_pago', name: 'Mercado Pago / Nu Mexico / OXXO Spin', category: 'instant_app', fieldsHint: 'CLABE or Phone + Holder Name' },
    ],
  },

  // --- EUROPE ---
  {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    currencySymbol: '£',
    region: 'Europe',
    ratePerUsd: 0.79,
    methods: [
      { id: 'gb_fps', name: 'Faster Payments (UK Sort Code)', category: 'bank_transfer', fieldsHint: 'Sort Code (xx-xx-xx), 8-Digit Account # & Name' },
      { id: 'gb_monzo', name: 'Monzo / Starling Bank', category: 'instant_app', fieldsHint: 'Sort Code + Account # or Monzo.me' },
      { id: 'gb_wise_revolut', name: 'Revolut UK / Wise UK', category: 'instant_app', fieldsHint: 'UK Sort Code + Account # or @tag' },
    ],
  },
  {
    code: 'EU',
    name: 'Eurozone (DE, FR, ES, IT, NL, PT, BE, IE, AT, FI, GR)',
    currency: 'EUR',
    currencySymbol: '€',
    region: 'Europe',
    ratePerUsd: 0.93,
    methods: [
      { id: 'eu_sepa_instant', name: 'SEPA Instant Credit Transfer', category: 'bank_transfer', fieldsHint: 'IBAN, BIC/SWIFT & Beneficiary Name' },
      { id: 'eu_sepa', name: 'Standard SEPA Bank Transfer', category: 'bank_transfer', fieldsHint: 'IBAN & Beneficiary Name' },
      { id: 'eu_bizum', name: 'Bizum (Spain)', category: 'instant_app', fieldsHint: 'Spanish Mobile Phone + Name' },
      { id: 'eu_ideal_wero', name: 'Wero / Lydia / Satispay / MB WAY', category: 'instant_app', fieldsHint: 'App Phone / Tag + Country' },
      { id: 'eu_n26_bunq', name: 'N26 / Bunq Instant', category: 'instant_app', fieldsHint: 'IBAN or MoneyBeam / bunq.me link' },
    ],
  },
  {
    code: 'CH',
    name: 'Switzerland',
    currency: 'CHF',
    currencySymbol: 'CHF ',
    region: 'Europe',
    ratePerUsd: 0.88,
    methods: [
      { id: 'ch_twint', name: 'TWINT', category: 'instant_app', fieldsHint: 'Swiss Mobile Number + Full Name' },
      { id: 'ch_sic', name: 'Swiss IBAN / SIC Instant (UBS, PostFinance)', category: 'bank_transfer', fieldsHint: 'CH IBAN + Account Holder' },
    ],
  },
  {
    code: 'PL',
    name: 'Poland',
    currency: 'PLN',
    currencySymbol: 'zł',
    region: 'Europe',
    ratePerUsd: 4.05,
    methods: [
      { id: 'pl_blik', name: 'BLIK Phone Transfer (Przelew na telefon)', category: 'instant_app', fieldsHint: 'Polish Phone + Name' },
      { id: 'pl_elixir', name: 'Express Elixir / Bank Transfer', category: 'bank_transfer', fieldsHint: '26-Digit Polish NRB/IBAN + Holder' },
    ],
  },
  {
    code: 'SE',
    name: 'Sweden',
    currency: 'SEK',
    currencySymbol: 'kr',
    region: 'Europe',
    ratePerUsd: 10.75,
    methods: [
      { id: 'se_swish', name: 'Swish', category: 'instant_app', fieldsHint: 'Swish Phone Number + Name' },
      { id: 'se_bankgiro', name: 'Swedish Bank Transfer (Clearing + Account)', category: 'bank_transfer', fieldsHint: 'Clearing #, Account # & Holder' },
    ],
  },
  {
    code: 'NO',
    name: 'Norway',
    currency: 'NOK',
    currencySymbol: 'kr',
    region: 'Europe',
    ratePerUsd: 10.95,
    methods: [
      { id: 'no_vipps', name: 'Vipps', category: 'instant_app', fieldsHint: 'Vipps Phone Number + Name' },
      { id: 'no_bank', name: 'Norwegian Bank Transfer', category: 'bank_transfer', fieldsHint: '11-Digit Norwegian Account #' },
    ],
  },
  {
    code: 'DK',
    name: 'Denmark',
    currency: 'DKK',
    currencySymbol: 'kr',
    region: 'Europe',
    ratePerUsd: 6.94,
    methods: [
      { id: 'dk_mobilepay', name: 'MobilePay', category: 'instant_app', fieldsHint: 'MobilePay Phone + Name' },
      { id: 'dk_bank', name: 'Danish Reg.nr + Kontonr', category: 'bank_transfer', fieldsHint: 'Reg.nr + Kontonr' },
    ],
  },
  {
    code: 'CZ',
    name: 'Czechia',
    currency: 'CZK',
    currencySymbol: 'Kč',
    region: 'Europe',
    ratePerUsd: 23.6,
    methods: [
      { id: 'cz_instant', name: 'Czech Instant Bank Transfer', category: 'bank_transfer', fieldsHint: 'Account # / Bank Code + Name' },
      { id: 'cz_airbank', name: 'Air Bank / Raiffeisen / Fio', category: 'bank_transfer', fieldsHint: 'Account # / Bank Code' },
    ],
  },
  {
    code: 'HU',
    name: 'Hungary',
    currency: 'HUF',
    currencySymbol: 'Ft',
    region: 'Europe',
    ratePerUsd: 382,
    methods: [
      { id: 'hu_giro', name: 'Hungarian Instant Bank (GIRO / Qvik)', category: 'bank_transfer', fieldsHint: '24-Digit Account # + Holder Name' },
    ],
  },
  {
    code: 'RO',
    name: 'Romania',
    currency: 'RON',
    currencySymbol: 'lei',
    region: 'Europe',
    ratePerUsd: 4.63,
    methods: [
      { id: 'ro_btpay', name: 'BT Pay / Banca Transilvania / BCR / ING RO', category: 'bank_transfer', fieldsHint: 'RO IBAN or BT Pay Phone + Name' },
    ],
  },
  {
    code: 'TR',
    name: 'Turkey',
    currency: 'TRY',
    currencySymbol: '₺',
    region: 'Europe',
    ratePerUsd: 34.4,
    methods: [
      { id: 'tr_fast_iban', name: 'FAST / EFT / Havale (TR IBAN)', category: 'bank_transfer', fieldsHint: '26-Char TR IBAN + Full Legal Name' },
      { id: 'tr_papara', name: 'Papara', category: 'instant_app', fieldsHint: 'Papara Account # + Name' },
      { id: 'tr_ziraat_garanti', name: 'Ziraat / Garanti BBVA / Enpara / Akbank', category: 'bank_transfer', fieldsHint: 'TR IBAN + Bank Name' },
    ],
  },
  {
    code: 'UA',
    name: 'Ukraine',
    currency: 'UAH',
    currencySymbol: '₴',
    region: 'Europe',
    ratePerUsd: 41.4,
    methods: [
      { id: 'ua_privat24', name: 'PrivatBank / Privat24', category: 'bank_transfer', fieldsHint: 'Card # or UA IBAN + Recipient Name' },
      { id: 'ua_monobank', name: 'Monobank', category: 'instant_app', fieldsHint: 'Monobank Card # or Jar Link' },
      { id: 'ua_pumb_oschad', name: 'PUMB / Oschadbank / A-Bank', category: 'bank_transfer', fieldsHint: 'Card # / IBAN + Name' },
    ],
  },

  // --- MIDDLE EAST ---
  {
    code: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
    currencySymbol: 'AED ',
    region: 'Middle East',
    ratePerUsd: 3.6725,
    methods: [
      { id: 'ae_aani', name: 'Aani Instant Payment (IPP)', category: 'instant_app', fieldsHint: 'Aani Mobile/Email or UAE IBAN' },
      { id: 'ae_enbd_adcb', name: 'Emirates NBD / ADCB / FAB / Mashreq / Wio', category: 'bank_transfer', fieldsHint: 'AE IBAN (23 chars) + Account Holder' },
      { id: 'ae_alansari', name: 'Al Ansari / Botim Pay', category: 'cash_remittance', fieldsHint: 'Emirates ID Name + Mobile' },
    ],
  },
  {
    code: 'SA',
    name: 'Saudi Arabia',
    currency: 'SAR',
    currencySymbol: 'SAR ',
    region: 'Middle East',
    ratePerUsd: 3.75,
    methods: [
      { id: 'sa_sarie', name: 'Sarie Instant Transfer', category: 'bank_transfer', fieldsHint: 'SA IBAN or Mobile ID + Beneficiary' },
      { id: 'sa_stcpay', name: 'STC Pay', category: 'instant_app', fieldsHint: 'STC Pay Mobile Number + Name' },
      { id: 'sa_rajhi_snb', name: 'Al Rajhi / SNB / Riyad / Alinma Bank', category: 'bank_transfer', fieldsHint: 'SA IBAN + Account Holder' },
      { id: 'sa_urpay', name: 'urpay / Barq', category: 'instant_app', fieldsHint: 'urpay Mobile Number' },
    ],
  },
  {
    code: 'QA',
    name: 'Qatar',
    currency: 'QAR',
    currencySymbol: 'QAR ',
    region: 'Middle East',
    ratePerUsd: 3.64,
    methods: [
      { id: 'qa_fawran', name: 'Fawran Instant Payment / QNB / CBQ', category: 'bank_transfer', fieldsHint: 'Fawran Alias or QA IBAN + Name' },
    ],
  },
  {
    code: 'KW',
    name: 'Kuwait',
    currency: 'KWD',
    currencySymbol: 'KWD ',
    region: 'Middle East',
    ratePerUsd: 0.307,
    methods: [
      { id: 'kw_wamd', name: 'WAMD / KNET Link / NBK / KFH', category: 'bank_transfer', fieldsHint: 'WAMD Mobile or KW IBAN + Holder' },
    ],
  },
  {
    code: 'BH',
    name: 'Bahrain',
    currency: 'BHD',
    currencySymbol: 'BHD ',
    region: 'Middle East',
    ratePerUsd: 0.376,
    methods: [
      { id: 'bh_benefitpay', name: 'BenefitPay (Fawri+)', category: 'instant_app', fieldsHint: 'BenefitPay Mobile or BH IBAN' },
    ],
  },
  {
    code: 'OM',
    name: 'Oman',
    currency: 'OMR',
    currencySymbol: 'OMR ',
    region: 'Middle East',
    ratePerUsd: 0.385,
    methods: [
      { id: 'om_bank_muscat', name: 'Bank Muscat / Dhofar Mobile Pay', category: 'bank_transfer', fieldsHint: 'Mobile Alias or Account # + Name' },
    ],
  },
  {
    code: 'IL',
    name: 'Israel',
    currency: 'ILS',
    currencySymbol: '₪',
    region: 'Middle East',
    ratePerUsd: 3.73,
    methods: [
      { id: 'il_bit', name: 'Bit / PayBox', category: 'instant_app', fieldsHint: 'Israeli Mobile Number + Name' },
      { id: 'il_bank', name: 'Leumi / Hapoalim / Discount Bank Transfer', category: 'bank_transfer', fieldsHint: 'Bank #, Branch #, Account #' },
    ],
  },
  {
    code: 'JO',
    name: 'Jordan',
    currency: 'JOD',
    currencySymbol: 'JOD ',
    region: 'Middle East',
    ratePerUsd: 0.709,
    methods: [
      { id: 'jo_cliq', name: 'CliQ Instant Payment', category: 'instant_app', fieldsHint: 'CliQ Alias / Phone + Bank Name' },
      { id: 'jo_zain_orange', name: 'Zain Cash / Orange Money / UWallet', category: 'mobile_money', fieldsHint: 'Wallet Phone + Name' },
    ],
  },

  // --- ASIA-PACIFIC ---
  {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    region: 'Asia-Pacific',
    ratePerUsd: 84.4,
    methods: [
      { id: 'in_upi', name: 'UPI (GPay / PhonePe / Paytm / BHIM)', category: 'instant_app', fieldsHint: 'UPI ID (name@bank) + Verified Name' },
      { id: 'in_imps', name: 'IMPS Instant Bank Transfer', category: 'bank_transfer', fieldsHint: 'Account #, IFSC Code & Beneficiary Name' },
      { id: 'in_neft_rtgs', name: 'NEFT / RTGS Bank Transfer', category: 'bank_transfer', fieldsHint: 'Account #, IFSC Code, Bank Name' },
      { id: 'in_digital_erupee', name: 'Digital eRupee (CBDC Wallet)', category: 'instant_app', fieldsHint: 'eRupee Wallet ID / Phone' },
    ],
  },
  {
    code: 'PK',
    name: 'Pakistan',
    currency: 'PKR',
    currencySymbol: 'Rs',
    region: 'Asia-Pacific',
    ratePerUsd: 278,
    methods: [
      { id: 'pk_raast', name: 'Raast / IBFT Bank Transfer (Meezan, HBL, UBL)', category: 'bank_transfer', fieldsHint: 'PK IBAN / Raast ID + Account Title' },
      { id: 'pk_easypaisa', name: 'Easypaisa', category: 'mobile_money', fieldsHint: 'Easypaisa Mobile # + Account Title' },
      { id: 'pk_jazzcash', name: 'JazzCash', category: 'mobile_money', fieldsHint: 'JazzCash Mobile # + Account Title' },
      { id: 'pk_sadapay_nayapay', name: 'SadaPay / NayaPay', category: 'instant_app', fieldsHint: 'Account Mobile # / IBAN + Name' },
    ],
  },
  {
    code: 'BD',
    name: 'Bangladesh',
    currency: 'BDT',
    currencySymbol: '৳',
    region: 'Asia-Pacific',
    ratePerUsd: 119.5,
    methods: [
      { id: 'bd_bkash', name: 'bKash', category: 'mobile_money', fieldsHint: 'bKash Personal Number + Name' },
      { id: 'bd_nagad', name: 'Nagad', category: 'mobile_money', fieldsHint: 'Nagad Number + Name' },
      { id: 'bd_rocket', name: 'Rocket (DBBL)', category: 'mobile_money', fieldsHint: 'Rocket Number + Name' },
      { id: 'bd_npsb_beftn', name: 'NPSB / City / BRAC / DBBL Bank', category: 'bank_transfer', fieldsHint: 'Bank, Branch, Account # & Name' },
    ],
  },
  {
    code: 'PH',
    name: 'Philippines',
    currency: 'PHP',
    currencySymbol: '₱',
    region: 'Asia-Pacific',
    ratePerUsd: 58.6,
    methods: [
      { id: 'ph_gcash', name: 'GCash', category: 'mobile_money', fieldsHint: 'GCash Mobile Number + Verified Name' },
      { id: 'ph_maya', name: 'Maya (PayMaya)', category: 'mobile_money', fieldsHint: 'Maya Number / @username' },
      { id: 'ph_instapay', name: 'InstaPay / BDO / BPI / UnionBank / SeaBank', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Holder' },
      { id: 'ph_gotyme', name: 'GoTyme Bank', category: 'instant_app', fieldsHint: 'GoTyme Account #' },
    ],
  },
  {
    code: 'ID',
    name: 'Indonesia',
    currency: 'IDR',
    currencySymbol: 'Rp',
    region: 'Asia-Pacific',
    ratePerUsd: 15850,
    methods: [
      { id: 'id_bca_mandiri', name: 'BI-FAST (BCA, Mandiri, BRI, BNI, SeaBank)', category: 'bank_transfer', fieldsHint: 'Bank Name, Rekening # & Nama Pemilik' },
      { id: 'id_qris_gopay', name: 'GoPay / OVO / DANA / ShopeePay', category: 'instant_app', fieldsHint: 'E-Wallet Phone Number + Name' },
    ],
  },
  {
    code: 'VN',
    name: 'Vietnam',
    currency: 'VND',
    currencySymbol: '₫',
    region: 'Asia-Pacific',
    ratePerUsd: 25350,
    methods: [
      { id: 'vn_vietqr', name: 'VietQR / NAPAS 24/7 (VCB, Techcombank, MB, ACB)', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Full Name' },
      { id: 'vn_momo_zalopay', name: 'MoMo Vietnam / ZaloPay / VNPay', category: 'instant_app', fieldsHint: 'Phone Number + Registered Name' },
    ],
  },
  {
    code: 'TH',
    name: 'Thailand',
    currency: 'THB',
    currencySymbol: '฿',
    region: 'Asia-Pacific',
    ratePerUsd: 34.4,
    methods: [
      { id: 'th_promptpay', name: 'PromptPay', category: 'instant_app', fieldsHint: 'PromptPay Phone / ID + Account Name' },
      { id: 'th_bank', name: 'Kasikorn (KBank) / SCB / Bangkok Bank / Krungthai', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Name' },
      { id: 'th_truemoney', name: 'TrueMoney Wallet', category: 'instant_app', fieldsHint: 'TrueMoney Phone + Name' },
    ],
  },
  {
    code: 'MY',
    name: 'Malaysia',
    currency: 'MYR',
    currencySymbol: 'RM',
    region: 'Asia-Pacific',
    ratePerUsd: 4.44,
    methods: [
      { id: 'my_duitnow', name: 'DuitNow Instant Transfer', category: 'instant_app', fieldsHint: 'DuitNow ID/Phone or Bank Account #' },
      { id: 'my_maybank_cimb', name: 'Maybank / CIMB / Public Bank / TNG eWallet', category: 'bank_transfer', fieldsHint: 'Bank / TNG # + Account Holder' },
    ],
  },
  {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    currencySymbol: 'S$',
    region: 'Asia-Pacific',
    ratePerUsd: 1.34,
    methods: [
      { id: 'sg_paynow', name: 'PayNow', category: 'instant_app', fieldsHint: 'PayNow Phone / UEN / NRIC + Registered Name' },
      { id: 'sg_fast', name: 'FAST Bank Transfer (DBS, OCBC, UOB)', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Holder' },
    ],
  },
  {
    code: 'CN',
    name: 'China',
    currency: 'CNY',
    currencySymbol: '¥',
    region: 'Asia-Pacific',
    ratePerUsd: 7.22,
    methods: [
      { id: 'cn_alipay', name: 'Alipay (支付宝)', category: 'instant_app', fieldsHint: 'Alipay Phone / Email + Real Name' },
      { id: 'cn_wechat', name: 'WeChat Pay (微信支付)', category: 'instant_app', fieldsHint: 'WeChat ID + Real Name' },
      { id: 'cn_unionpay', name: 'Bank Card / UnionPay (ICBC, CMB, BOC, CCB)', category: 'bank_transfer', fieldsHint: 'Card #, Bank Name & Sub-branch + Real Name' },
    ],
  },
  {
    code: 'HK',
    name: 'Hong Kong',
    currency: 'HKD',
    currencySymbol: 'HK$',
    region: 'Asia-Pacific',
    ratePerUsd: 7.78,
    methods: [
      { id: 'hk_fps', name: 'FPS (Faster Payment System)', category: 'instant_app', fieldsHint: 'FPS ID / Phone / Email + Name' },
      { id: 'hk_payme_alipayhk', name: 'PayMe / AlipayHK / HSBC / ZA Bank', category: 'instant_app', fieldsHint: 'PayMe Link or Bank Account #' },
    ],
  },
  {
    code: 'TW',
    name: 'Taiwan',
    currency: 'TWD',
    currencySymbol: 'NT$',
    region: 'Asia-Pacific',
    ratePerUsd: 32.3,
    methods: [
      { id: 'tw_bank', name: 'Taiwan Bank Transfer (CTBC, Cathay, E.SUN)', category: 'bank_transfer', fieldsHint: '3-Digit Bank Code + Account #' },
      { id: 'tw_line_jkopay', name: 'LINE Pay / iPASS / JKOPay', category: 'instant_app', fieldsHint: 'Account ID / Phone' },
    ],
  },
  {
    code: 'JP',
    name: 'Japan',
    currency: 'JPY',
    currencySymbol: '¥',
    region: 'Asia-Pacific',
    ratePerUsd: 153.5,
    methods: [
      { id: 'jp_zengin', name: 'Domestic Bank Transfer (MUFG, SMBC, Mizuho, Rakuten)', category: 'bank_transfer', fieldsHint: 'Bank, Branch Code, Account Type/Number & Katakana Name' },
      { id: 'jp_paypay', name: 'PayPay / LINE Pay', category: 'instant_app', fieldsHint: 'PayPay ID / Link' },
    ],
  },
  {
    code: 'KR',
    name: 'South Korea',
    currency: 'KRW',
    currencySymbol: '₩',
    region: 'Asia-Pacific',
    ratePerUsd: 1395,
    methods: [
      { id: 'kr_bank', name: 'Korean Bank Transfer (KB, Shinhan, Hana, KakaoBank)', category: 'bank_transfer', fieldsHint: 'Bank Name, Account # & Korean Legal Name' },
      { id: 'kr_kakaopay_toss', name: 'KakaoPay / Toss', category: 'instant_app', fieldsHint: 'Toss ID or KakaoPay Link' },
    ],
  },
  {
    code: 'AU',
    name: 'Australia',
    currency: 'AUD',
    currencySymbol: 'A$',
    region: 'Asia-Pacific',
    ratePerUsd: 1.53,
    methods: [
      { id: 'au_payid', name: 'PayID / Osko (NPP Instant)', category: 'instant_app', fieldsHint: 'PayID Email/Phone + Account Name' },
      { id: 'au_bsb', name: 'Australian BSB & Account (CBA, ANZ, NAB, Westpac)', category: 'bank_transfer', fieldsHint: 'BSB (6 digits) + Account #' },
    ],
  },
  {
    code: 'NZ',
    name: 'New Zealand',
    currency: 'NZD',
    currencySymbol: 'NZ$',
    region: 'Asia-Pacific',
    ratePerUsd: 1.69,
    methods: [
      { id: 'nz_bank', name: 'NZ Bank Transfer (ANZ, ASB, BNZ, Westpac, Kiwibank)', category: 'bank_transfer', fieldsHint: '16-Digit NZ Account # + Name' },
    ],
  },

  // --- LATIN AMERICA ---
  {
    code: 'BR',
    name: 'Brazil',
    currency: 'BRL',
    currencySymbol: 'R$',
    region: 'Latin America',
    ratePerUsd: 5.78,
    methods: [
      { id: 'br_pix', name: 'PIX Instant Transfer', category: 'instant_app', fieldsHint: 'PIX Key (CPF, Email, Phone or Random Key) + Full Name' },
      { id: 'br_ted_nubank', name: 'Nubank / Inter / Itaú / Bradesco / Banco do Brasil', category: 'bank_transfer', fieldsHint: 'Agência, Conta & CPF/Holder' },
      { id: 'br_picpay_mp', name: 'PicPay / Mercado Pago BR', category: 'instant_app', fieldsHint: '@username or PIX Key' },
    ],
  },
  {
    code: 'AR',
    name: 'Argentina',
    currency: 'ARS',
    currencySymbol: 'ARS ',
    region: 'Latin America',
    ratePerUsd: 1095,
    methods: [
      { id: 'ar_cvu_cbu', name: 'Mercado Pago / CBU / CVU Alias Transfer', category: 'instant_app', fieldsHint: 'Alias or 22-Digit CBU/CVU + CUIL/Name' },
      { id: 'ar_uala_brubank', name: 'Ualá / Brubank / Lemon / Santander AR', category: 'bank_transfer', fieldsHint: 'Alias / CVU + Full Name' },
    ],
  },
  {
    code: 'CO',
    name: 'Colombia',
    currency: 'COP',
    currencySymbol: 'COL$',
    region: 'Latin America',
    ratePerUsd: 4380,
    methods: [
      { id: 'co_nequi', name: 'Nequi', category: 'instant_app', fieldsHint: 'Nequi Phone (3xx...) + Holder Name' },
      { id: 'co_daviplata', name: 'Daviplata', category: 'instant_app', fieldsHint: 'Daviplata Phone + Name' },
      { id: 'co_bancolombia', name: 'Bancolombia / Davivienda / Transfiya', category: 'bank_transfer', fieldsHint: 'Account # (Ahorros/Corriente) + Cédula/Name' },
    ],
  },
  {
    code: 'PE',
    name: 'Peru',
    currency: 'PEN',
    currencySymbol: 'S/',
    region: 'Latin America',
    ratePerUsd: 3.77,
    methods: [
      { id: 'pe_yape', name: 'Yape (BCP)', category: 'instant_app', fieldsHint: 'Yape Phone Number + Name' },
      { id: 'pe_plin', name: 'Plin (Interbank / BBVA / Scotiabank)', category: 'instant_app', fieldsHint: 'Plin Phone Number + Name' },
      { id: 'pe_cci', name: 'BCP / Interbank / BBVA CCI Transfer', category: 'bank_transfer', fieldsHint: 'Account # or 20-Digit CCI + Holder' },
    ],
  },
  {
    code: 'CL',
    name: 'Chile',
    currency: 'CLP',
    currencySymbol: 'CLP$',
    region: 'Latin America',
    ratePerUsd: 970,
    methods: [
      { id: 'cl_cuentarut', name: 'BancoEstado CuentaRUT / Transfer', category: 'bank_transfer', fieldsHint: 'RUT, Bank, Account Type & Number' },
      { id: 'cl_mach_tenpo', name: 'MACH / Tenpo / Mercado Pago CL', category: 'instant_app', fieldsHint: 'Phone / MACH Link / RUT' },
    ],
  },

  // --- GLOBAL CROSS-BORDER ---
  {
    code: 'GLOBAL',
    name: 'Global / Cross-Border Remittance',
    currency: 'USD',
    currencySymbol: '$',
    region: 'Global',
    ratePerUsd: 1.0,
    methods: GLOBAL_CROSS_BORDER_METHODS,
  },
];

export function getCountryByCode(code: string): P2PCountryConfig {
  const upper = (code || '').trim().toUpperCase();
  return P2P_COUNTRIES.find((c) => c.code === upper) || P2P_COUNTRIES[0];
}

export function getPaymentMethodsForCountry(countryCode: string): P2PPaymentMethodDef[] {
  const country = getCountryByCode(countryCode);
  if (country.code === 'GLOBAL') return GLOBAL_CROSS_BORDER_METHODS;
  return [...country.methods, ...GLOBAL_CROSS_BORDER_METHODS];
}

export function getPaymentMethodById(methodId: string, countryCode?: string): P2PPaymentMethodDef | undefined {
  if (countryCode) {
    const local = getPaymentMethodsForCountry(countryCode).find((m) => m.id === methodId);
    if (local) return local;
  }
  for (const c of P2P_COUNTRIES) {
    const found = c.methods.find((m) => m.id === methodId);
    if (found) return found;
  }
  return GLOBAL_CROSS_BORDER_METHODS.find((m) => m.id === methodId);
}

export function formatFiatAmount(amount: number, currency: string): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const zeroDec = new Set(['NGN', 'KES', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF', 'IDR', 'VND', 'KRW', 'JPY', 'COP', 'CLP', 'ARS', 'HUF', 'PKR']);
  const digits = zeroDec.has(currency) && safe >= 100 ? 0 : 2;
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe)} ${currency}`;
}

export function getAllPaymentMethodsCount(): number {
  const localCount = P2P_COUNTRIES.filter((c) => c.code !== 'GLOBAL').reduce(
    (sum, c) => sum + c.methods.length,
    0
  );
  return localCount + GLOBAL_CROSS_BORDER_METHODS.length;
}
