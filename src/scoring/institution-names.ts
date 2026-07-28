const INSTITUTION_NAMES: Readonly<Record<string, string>> = {
  "001": "Banco do Brasil S.A.",
  "003": "Banco da Amazônia S.A.",
  "004": "Banco do Nordeste do Brasil S.A.",
  "021": "Banestes S.A.",
  "033": "Banco Santander (Brasil) S.A.",
  "037": "Banco do Estado do Pará S.A.",
  "041": "Banco do Estado do Rio Grande do Sul S.A.",
  "047": "Banco do Estado de Sergipe S.A.",
  "070": "BRB - Banco de Brasília S.A.",
  "077": "Banco Inter S.A.",
  "104": "Caixa Econômica Federal",
  "208": "Banco BTG Pactual S.A.",
  "212": "Banco Original S.A.",
  "237": "Banco Bradesco S.A.",
  "246": "Banco ABC Brasil S.A.",
  "260": "Nu Pagamentos S.A.",
  "336": "Banco C6 S.A.",
  "341": "Itaú Unibanco S.A.",
  "389": "Banco Mercantil do Brasil S.A.",
  "422": "Banco Safra S.A.",
  "623": "Banco Pan S.A.",
  "655": "Banco Votorantim S.A.",
  "707": "Banco Daycoval S.A.",
  "745": "Banco Citibank S.A.",
  "748": "Banco Cooperativo Sicredi S.A.",
  "756": "Banco Cooperativo Sicoob S.A.",
};

/**
 * Resolves a supported FEBRABAN bank code to the institution's display name.
 *
 * @param {string} code - The three-digit bank code to resolve.
 * @returns {string|null} The institution name, or `null` when the code is not in the maintained catalog.
 */
export function institutionNameForBankCode(code: string): string | null {
  return INSTITUTION_NAMES[code] ?? null;
}
